use crate::auth::client::{AuthClient, AuthClientError};
use crate::auth::commands::saved_auth_for_upload;
use crate::auth::credentials::{ActiveCredential, CredentialSource, SavedAuth, SecretString};
use crate::auth::store::{CredentialStore, StoreError};
use crate::state::normalized_relative_path;
use chrono::{DateTime, Duration, Utc};
use sha2::{Digest, Sha256};
use std::path::Path;
use thiserror::Error;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Error)]
pub enum UploadError {
    #[error(transparent)]
    Auth(#[from] AuthClientError),
    #[error("artifact file could not be read")]
    File,
    #[error("artifact changed while it was being read")]
    Changed,
    #[error("upload was cancelled after an authentication change")]
    Cancelled,
    #[error("authentication configuration could not be updated after token rotation")]
    CredentialStore(#[from] StoreError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadOutcome {
    Uploaded,
    Changed,
}

struct SessionCredentials {
    access_token: SecretString,
    refresh_token: Option<SecretString>,
    expires_at: DateTime<Utc>,
    saved_auth: Option<SavedAuth>,
}

pub struct UploadManager {
    auth_client: AuthClient,
    team: String,
    credentials: Mutex<SessionCredentials>,
    credential_store: Option<CredentialStore>,
    rotate_refresh: bool,
}

impl UploadManager {
    pub fn new(
        auth_client: AuthClient,
        active: &ActiveCredential,
        team: String,
        identity_expiry: DateTime<Utc>,
        store: &CredentialStore,
    ) -> Self {
        let saved_auth = active.cached_auth.clone();
        let credential_store = (active.source == CredentialSource::AuthFile).then(|| store.clone());
        Self {
            auth_client,
            team,
            credentials: Mutex::new(SessionCredentials {
                access_token: active.access_token.clone(),
                refresh_token: active.refresh_token.clone(),
                expires_at: identity_expiry,
                saved_auth,
            }),
            credential_store,
            rotate_refresh: active.source == CredentialSource::AuthFile,
        }
    }

    pub async fn clear_cached_credentials(&self) {
        let mut current = self.credentials.lock().await;
        current.access_token = SecretString::new(String::new());
        current.refresh_token = None;
        current.saved_auth = None;
        current.expires_at = DateTime::<Utc>::MIN_UTC;
    }

    pub async fn upload_file(
        &self,
        root: &Path,
        path: &Path,
        expected_hash: &str,
        cancellation: &CancellationToken,
    ) -> Result<UploadOutcome, UploadError> {
        let relative = normalized_relative_path(root, path).map_err(|_| UploadError::File)?;
        if relative == "config.json" || relative.split('/').any(|part| part == ".artifact-sync") {
            return Err(UploadError::File);
        }
        let bytes = tokio::fs::read(path).await.map_err(|_| UploadError::File)?;
        let content_hash = hex::encode(Sha256::digest(&bytes));
        if content_hash != expected_hash {
            return Ok(UploadOutcome::Changed);
        }

        for attempt in 0..2 {
            let (access_token, expiry) = self.access_token(cancellation).await?;
            if expiry <= Utc::now() {
                return Err(AuthClientError::InvalidCredential.into());
            }
            let upload = self
                .auth_client
                .upload(&access_token, &relative, bytes.clone());
            let result = tokio::select! {
                _ = cancellation.cancelled() => return Err(UploadError::Cancelled),
                result = upload => result,
            };
            match result {
                Ok(()) => return Ok(UploadOutcome::Uploaded),
                Err(AuthClientError::InvalidCredential) if attempt == 0 => {
                    self.refresh_after_rejection(&access_token, cancellation)
                        .await?;
                }
                Err(error) => return Err(error.into()),
            }
        }
        Err(AuthClientError::InvalidCredential.into())
    }

    async fn access_token(
        &self,
        cancellation: &CancellationToken,
    ) -> Result<(SecretString, DateTime<Utc>), UploadError> {
        let mut current = self.credentials.lock().await;
        if current.expires_at <= Utc::now() + Duration::minutes(2) {
            self.refresh_locked(&mut current, cancellation).await?;
        }
        Ok((current.access_token.clone(), current.expires_at))
    }

    async fn refresh_after_rejection(
        &self,
        rejected_access_token: &SecretString,
        cancellation: &CancellationToken,
    ) -> Result<(), UploadError> {
        let mut current = self.credentials.lock().await;
        if current.access_token.expose() != rejected_access_token.expose() {
            return Ok(());
        }
        self.refresh_locked(&mut current, cancellation).await
    }

    async fn refresh_locked(
        &self,
        current: &mut SessionCredentials,
        cancellation: &CancellationToken,
    ) -> Result<(), UploadError> {
        let refresh_token = current
            .refresh_token
            .as_ref()
            .ok_or(AuthClientError::InvalidCredential)?
            .clone();
        let refresh = self
            .auth_client
            .refresh(&refresh_token, self.rotate_refresh);
        let exchange = tokio::select! {
            _ = cancellation.cancelled() => return Err(UploadError::Cancelled),
            result = refresh => result?,
        };
        if exchange.identity.team != self.team
            || !exchange
                .identity
                .permissions
                .iter()
                .any(|permission| permission == "artifacts:publish")
        {
            return Err(AuthClientError::Forbidden.into());
        }

        if let Some(saved) = current.saved_auth.as_mut() {
            *saved = saved_auth_for_upload(&exchange);
            if let Some(store) = &self.credential_store {
                store.save_login(self.auth_client.origin(), saved)?;
            }
        }
        current.access_token = exchange.access_token;
        current.refresh_token = Some(exchange.refresh_token);
        current.expires_at = exchange.expires_at;
        Ok(())
    }
}
