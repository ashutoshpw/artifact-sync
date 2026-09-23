use super::client::{AuthClient, AuthClientError, normalize_server_origin};
use super::credentials::{
    ActiveCredential, CachedIdentity, CredentialSource, SavedAuth, SecretString, is_publisher_token,
};
use super::store::{CredentialStore, StoreError};
use crate::config::{
    ConfigError, default_auth_config_path, load_publishing_config, path_is_inside,
};
use std::io::{IsTerminal, Read};
use std::path::{Path, PathBuf};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use zeroize::Zeroizing;

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("{0}")]
    Auth(#[from] AuthClientError),
    #[error("could not read publisher token from standard input")]
    TokenInput,
}

pub fn validate_auth_path(auth_path: &Path, publishing_path: &Path) -> Result<(), CommandError> {
    if let Some(root) = publishing_path.parent() {
        if path_is_inside(auth_path, root).map_err(|_| {
            CommandError::Message("could not resolve configuration paths safely".into())
        })? {
            return Err(CommandError::Message(
                "authentication configuration must be outside the watched artifact root".into(),
            ));
        }
    }
    Ok(())
}

pub async fn login(
    server: &str,
    token_stdin: bool,
    auth_path: PathBuf,
    publishing_path: PathBuf,
) -> Result<(), CommandError> {
    validate_auth_path(&auth_path, &publishing_path)?;
    let origin = normalize_server_origin(server).map_err(CommandError::Message)?;
    println!("Destination server: {origin}");
    let token = read_publisher_token(token_stdin)?;
    let client = AuthClient::new(origin.clone())?;
    let identity = client.whoami(&token).await.map_err(auth_command_error)?;

    if publishing_path.exists() {
        let publishing = load_publishing_config(&publishing_path)?;
        if identity.team != publishing.team {
            return Err(CommandError::Message(format!(
                "publisher is authorized for team '{}' but publishing configuration selects '{}'; no credential was saved",
                identity.team, publishing.team
            )));
        }
    }

    let auth = SavedAuth {
        auth_type: "publisher_token".into(),
        token,
        token_id: Some(identity.token_id.clone()),
        expires_at: Some(identity.expires_at),
        cached_identity: Some(CachedIdentity {
            publisher_id: identity.publisher_id.clone(),
            team: identity.team.clone(),
            permissions: identity.permissions.clone(),
        }),
    };
    CredentialStore::new(&auth_path).save_login(&origin, &auth)?;

    println!(
        "Authenticated publisher {} for team {}.",
        identity.publisher_id, identity.team
    );
    println!(
        "Saved authentication configuration: {}",
        auth_path.display()
    );
    if std::env::var_os("ARTIFACTS_PUBLISH_TOKEN").is_some() {
        println!(
            "Note: ARTIFACTS_PUBLISH_TOKEN is set and will take precedence over this saved credential."
        );
    }
    Ok(())
}

pub async fn whoami(auth_path: PathBuf, publishing_path: PathBuf) -> Result<(), CommandError> {
    validate_auth_path(&auth_path, &publishing_path)?;
    let store = CredentialStore::new(auth_path);
    let active = resolve_active_credential(&store)?
        .ok_or_else(|| CommandError::Message("no publisher credential is configured; run `artifact-sync login` or configure ARTIFACTS_PUBLISH_TOKEN with ARTIFACT_SYNC_SERVER_URL".into()))?;
    let identity = AuthClient::new(active.server_origin.clone())?
        .whoami(&active.token)
        .await
        .map_err(auth_command_error)?;
    println!("Server: {}", active.server_origin);
    print_identity(&identity);
    println!("Credential source: {}", active.source.label());
    Ok(())
}

pub async fn logout(auth_path: PathBuf, publishing_path: PathBuf) -> Result<(), CommandError> {
    validate_auth_path(&auth_path, &publishing_path)?;
    let removed = CredentialStore::new(auth_path.clone()).logout()?;
    if removed {
        println!("Removed the locally stored publisher credential.");
    } else {
        println!("No locally stored publisher credential was present.");
    }
    println!(
        "Local logout does not revoke the token on the server. Ask an operator to revoke and deploy the updated token registry."
    );

    match notify_daemon_auth_changed().await {
        Ok(true) => println!("The running daemon was notified that authentication changed."),
        Ok(false) => {}
        Err(_) => eprintln!(
            "Warning: could not notify the running daemon; it will observe the credential-file change when available."
        ),
    }
    if std::env::var_os("ARTIFACTS_PUBLISH_TOKEN").is_some() {
        println!(
            "ARTIFACTS_PUBLISH_TOKEN remains active; logout cannot remove it from the parent shell or service configuration, and it takes precedence over the auth file."
        );
    }
    Ok(())
}

pub fn resolve_active_credential(
    store: &CredentialStore,
) -> Result<Option<ActiveCredential>, CommandError> {
    let env_token = optional_environment_value("ARTIFACTS_PUBLISH_TOKEN")?;
    let env_server = optional_environment_value("ARTIFACT_SYNC_SERVER_URL")?;
    if let Some(token) = env_token {
        if token.is_empty() {
            return Err(CommandError::Message(
                "ARTIFACTS_PUBLISH_TOKEN is set but empty; remove it or provide a publisher token"
                    .into(),
            ));
        }
        let server = env_server.filter(|value| !value.is_empty()).ok_or_else(|| {
            CommandError::Message(
                "ARTIFACTS_PUBLISH_TOKEN is set but ARTIFACT_SYNC_SERVER_URL is missing or empty; set both explicitly".into(),
            )
        })?;
        let origin = normalize_server_origin(&server).map_err(CommandError::Message)?;
        return Ok(Some(ActiveCredential {
            token: SecretString::new(token),
            server_origin: origin,
            source: CredentialSource::Environment,
            cached_auth: None,
        }));
    }

    let Some(file) = store.load()? else {
        return Ok(None);
    };
    let Some(auth) = file.auth.clone() else {
        return Ok(None);
    };
    let saved_origin = normalize_server_origin(&file.server_url).map_err(CommandError::Message)?;
    if let Some(selected) = env_server {
        if selected.is_empty() {
            return Err(CommandError::Message(
                "ARTIFACT_SYNC_SERVER_URL is set but empty; remove it or provide a server origin"
                    .into(),
            ));
        }
        let selected_origin = normalize_server_origin(&selected).map_err(CommandError::Message)?;
        if selected_origin != saved_origin {
            return Err(CommandError::Message("selected server differs from the saved credential destination; run `artifact-sync login --server ...` for the new destination".into()));
        }
    }
    Ok(Some(ActiveCredential {
        token: auth.token.clone(),
        server_origin: saved_origin,
        source: CredentialSource::AuthFile,
        cached_auth: Some(auth),
    }))
}

fn optional_environment_value(name: &str) -> Result<Option<String>, CommandError> {
    std::env::var_os(name)
        .map(|value| {
            value
                .into_string()
                .map_err(|_| CommandError::Message(format!("{name} must contain valid UTF-8")))
        })
        .transpose()
}

pub fn print_identity(identity: &super::credentials::PublisherIdentity) {
    println!("Publisher ID: {}", identity.publisher_id);
    println!("Authorized team: {}", identity.team);
    println!(
        "Permissions: {}",
        if identity.permissions.is_empty() {
            "(none)".to_string()
        } else {
            identity.permissions.join(", ")
        }
    );
    println!("Expires: {}", identity.expires_at.to_rfc3339());
}

fn read_publisher_token(token_stdin: bool) -> Result<SecretString, CommandError> {
    let value = if token_stdin {
        let mut input = Zeroizing::new(String::new());
        std::io::stdin()
            .read_to_string(&mut input)
            .map_err(|_| CommandError::TokenInput)?;
        input.trim().to_owned()
    } else {
        if !std::io::stdin().is_terminal() {
            return Err(CommandError::Message("login needs an interactive terminal or `--token-stdin`; secrets are not accepted as command arguments".into()));
        }
        rpassword::prompt_password("Publisher token: ").map_err(|_| CommandError::TokenInput)?
    };
    let mut value = Zeroizing::new(value);
    if value.is_empty() {
        return Err(CommandError::Message(if token_stdin {
            "no publisher token was supplied on standard input".into()
        } else {
            "no publisher token was entered".into()
        }));
    }
    if !is_publisher_token(&value) {
        return Err(CommandError::Message(
            "publisher token has an invalid format".into(),
        ));
    }
    Ok(SecretString::new(std::mem::take(&mut *value)))
}

fn auth_command_error(error: AuthClientError) -> CommandError {
    match error {
        AuthClientError::InvalidCredential => CommandError::Message(
            "publisher credential is invalid, expired, or revoked; no credential was saved".into(),
        ),
        AuthClientError::Forbidden => CommandError::Message(
            "publisher is authenticated but lacks permission for this operation".into(),
        ),
        AuthClientError::Unavailable => CommandError::Message(
            "authentication server is unreachable; the credential was not verified".into(),
        ),
        other => CommandError::Auth(other),
    }
}

async fn notify_daemon_auth_changed() -> Result<bool, std::io::Error> {
    let socket_path = default_auth_config_path()
        .map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "home directory unavailable")
        })?
        .parent()
        .unwrap()
        .join("daemon.sock");
    match UnixStream::connect(socket_path).await {
        Ok(mut stream) => {
            stream.write_all(b"AUTH_CHANGED\n").await?;
            let mut response = [0u8; 8];
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                stream.read(&mut response),
            )
            .await;
            Ok(true)
        }
        Err(error)
            if error.kind() == std::io::ErrorKind::NotFound
                || error.kind() == std::io::ErrorKind::ConnectionRefused =>
        {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    const SAVED_TOKEN: &str = "as_pub_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

    fn lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn environment_token_requires_an_explicit_destination_and_wins() {
        let _guard = lock().lock().unwrap();
        unsafe {
            std::env::set_var("ARTIFACTS_PUBLISH_TOKEN", "as_pub_environment-token");
        }
        unsafe {
            std::env::remove_var("ARTIFACT_SYNC_SERVER_URL");
        }
        let temp = tempfile::tempdir().unwrap();
        let store = CredentialStore::new(temp.path().join("private/config.json"));
        store
            .save_login(
                "https://saved.example",
                &SavedAuth {
                    auth_type: "publisher_token".into(),
                    token: SecretString::new(SAVED_TOKEN),
                    token_id: None,
                    expires_at: None,
                    cached_identity: None,
                },
            )
            .unwrap();
        assert!(
            resolve_active_credential(&store)
                .unwrap_err()
                .to_string()
                .contains("ARTIFACT_SYNC_SERVER_URL")
        );
        unsafe {
            std::env::set_var("ARTIFACT_SYNC_SERVER_URL", "https://env.example");
        }
        let credential = resolve_active_credential(&store).unwrap().unwrap();
        assert_eq!(credential.source, CredentialSource::Environment);
        assert_eq!(credential.server_origin, "https://env.example");
        assert_eq!(credential.token.expose(), "as_pub_environment-token");
        assert_eq!(
            store.load().unwrap().unwrap().auth.unwrap().token.expose(),
            SAVED_TOKEN,
            "environment credentials must not replace or persist over the saved login"
        );
        unsafe {
            std::env::remove_var("ARTIFACTS_PUBLISH_TOKEN");
        }
        unsafe {
            std::env::remove_var("ARTIFACT_SYNC_SERVER_URL");
        }
    }

    #[test]
    fn empty_environment_override_does_not_fall_back_to_a_saved_login() {
        let _guard = lock().lock().unwrap();
        unsafe {
            std::env::set_var("ARTIFACTS_PUBLISH_TOKEN", "");
            std::env::set_var("ARTIFACT_SYNC_SERVER_URL", "https://env.example");
        }
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("private/config.json");
        let store = CredentialStore::new(&path);
        store
            .save_login(
                "https://saved.example",
                &SavedAuth {
                    auth_type: "publisher_token".into(),
                    token: SecretString::new(SAVED_TOKEN),
                    token_id: None,
                    expires_at: None,
                    cached_identity: None,
                },
            )
            .unwrap();
        assert!(
            resolve_active_credential(&store)
                .unwrap_err()
                .to_string()
                .contains("set but empty")
        );
        unsafe {
            std::env::remove_var("ARTIFACTS_PUBLISH_TOKEN");
            std::env::remove_var("ARTIFACT_SYNC_SERVER_URL");
        }
    }

    #[test]
    fn environment_selected_destination_cannot_reuse_a_saved_credential() {
        let _guard = lock().lock().unwrap();
        unsafe {
            std::env::remove_var("ARTIFACTS_PUBLISH_TOKEN");
            std::env::set_var("ARTIFACT_SYNC_SERVER_URL", "https://different.example");
        }
        let temp = tempfile::tempdir().unwrap();
        let store = CredentialStore::new(temp.path().join("private/config.json"));
        store
            .save_login(
                "https://saved.example",
                &SavedAuth {
                    auth_type: "publisher_token".into(),
                    token: SecretString::new(SAVED_TOKEN),
                    token_id: None,
                    expires_at: None,
                    cached_identity: None,
                },
            )
            .unwrap();
        assert!(
            resolve_active_credential(&store)
                .unwrap_err()
                .to_string()
                .contains("selected server differs")
        );
        unsafe {
            std::env::remove_var("ARTIFACT_SYNC_SERVER_URL");
        }
    }
}
