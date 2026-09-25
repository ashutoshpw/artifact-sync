use super::client::{AuthClient, AuthClientError, normalize_server_origin};
use super::credentials::{
    ActiveCredential, CachedIdentity, CredentialSource, PublisherIdentity, SavedAuth, SecretString,
    TokenExchange, is_access_token, is_refresh_credential,
};
use super::store::{CredentialStore, StoreError};
use crate::config::{ConfigError, default_auth_config_path, path_is_inside};
use std::io::{IsTerminal, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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
    #[error(transparent)]
    Auth(#[from] AuthClientError),
    #[error("could not read the API token from standard input")]
    TokenInput,
}

pub fn validate_auth_path(auth_path: &Path, artifact_root: &Path) -> Result<(), CommandError> {
    if path_is_inside(auth_path, artifact_root)
        .map_err(|_| CommandError::Message("could not resolve configuration paths safely".into()))?
    {
        return Err(CommandError::Message(
            "authentication configuration must be outside the watched artifact root".into(),
        ));
    }
    Ok(())
}

pub async fn login(
    server: &str,
    token_stdin: bool,
    auth_path: PathBuf,
    artifact_root: PathBuf,
) -> Result<(), CommandError> {
    validate_auth_path(&auth_path, &artifact_root)?;
    let origin = normalize_server_origin(server).map_err(CommandError::Message)?;
    println!("Destination server: {origin}");
    let client = AuthClient::new(origin.clone())?;
    let exchange = if token_stdin {
        let token = read_api_token()?;
        client
            .refresh(&token, true)
            .await
            .map_err(auth_command_error)?
    } else {
        complete_device_login(&client).await?
    };
    let identity = client
        .whoami(&exchange.access_token)
        .await
        .map_err(auth_command_error)?;
    if identity != exchange.identity {
        return Err(CommandError::Message(
            "gateway returned inconsistent identity data; no credential was saved".into(),
        ));
    }

    let auth = saved_auth_for_upload(&exchange);
    CredentialStore::new(&auth_path).save_login(&origin, &auth)?;
    println!(
        "Authenticated {} ({}) for team {}.",
        identity.name, identity.email, identity.team
    );
    println!(
        "Saved authentication configuration: {}",
        auth_path.display()
    );
    if std::env::var_os("ARTIFACTS_PUBLISH_TOKEN").is_some() {
        println!(
            "Note: ARTIFACTS_PUBLISH_TOKEN is set and takes precedence over this saved login."
        );
    }
    Ok(())
}

async fn complete_device_login(client: &AuthClient) -> Result<TokenExchange, CommandError> {
    if !std::io::stdin().is_terminal() {
        return Err(CommandError::Message(
            "login requires a terminal for browser device approval; use `--token-stdin` to read a team API token from standard input".into(),
        ));
    }
    let authorization = client
        .start_device(&device_name())
        .await
        .map_err(auth_command_error)?;
    let grouped_code = format!(
        "{}-{}",
        &authorization.user_code[..4],
        &authorization.user_code[4..]
    );
    println!(
        "Open this URL to approve the device: {}",
        authorization.verification_url
    );
    println!("Device code: {grouped_code}");
    open_browser_best_effort(&authorization.verification_url);
    println!("Waiting for approval. Keep this terminal open; press Ctrl-C to cancel.");

    loop {
        if chrono::Utc::now() >= authorization.expires_at {
            return Err(CommandError::Auth(AuthClientError::DeviceExpired));
        }
        match client
            .poll_device(&authorization.device_code)
            .await
            .map_err(auth_command_error)?
        {
            Some(exchange) => return Ok(exchange),
            None => {
                tokio::time::sleep(std::time::Duration::from_secs(
                    authorization.interval_seconds.clamp(1, 30),
                ))
                .await
            }
        }
    }
}

fn device_name() -> String {
    let candidate = std::env::var("ARTIFACT_SYNC_DEVICE_NAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "Artifact Sync CLI".into());
    let normalized: String = candidate
        .chars()
        .filter(|character| !character.is_control())
        .take(80)
        .collect();
    if normalized.trim().is_empty() {
        "Artifact Sync CLI".into()
    } else {
        normalized.trim().into()
    }
}

fn open_browser_best_effort(url: &str) {
    #[cfg(target_os = "macos")]
    let command = "open";
    #[cfg(target_os = "linux")]
    let command = "xdg-open";
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let command = return;

    let _ = Command::new(command)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

pub async fn whoami(auth_path: PathBuf, artifact_root: PathBuf) -> Result<(), CommandError> {
    validate_auth_path(&auth_path, &artifact_root)?;
    let store = CredentialStore::new(auth_path);
    let mut active = resolve_active_credential(&store)?.ok_or_else(|| {
        CommandError::Message("no team credential is configured; run `artifact-sync login`".into())
    })?;
    let identity = validate_active_credential(&mut active, &store)
        .await
        .map_err(auth_command_error)?;
    println!("Server: {}", active.server_origin);
    print_identity(&identity);
    println!("Credential source: {}", active.source.label());
    Ok(())
}

pub async fn logout(auth_path: PathBuf, artifact_root: PathBuf) -> Result<(), CommandError> {
    validate_auth_path(&auth_path, &artifact_root)?;
    let removed = CredentialStore::new(auth_path.clone()).logout()?;
    if removed {
        println!("Removed the locally stored team credential.");
    } else {
        println!("No locally stored team credential was present.");
    }
    println!(
        "Local logout is not server-side revocation. Revoke this device in Settings → API tokens to stop future refreshes; an already-issued access JWT can remain valid for up to seven days."
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
    resolve_credential(store, true)
}

pub fn resolve_saved_credential(
    store: &CredentialStore,
) -> Result<Option<ActiveCredential>, CommandError> {
    resolve_credential(store, false)
}

fn resolve_credential(
    store: &CredentialStore,
    allow_environment: bool,
) -> Result<Option<ActiveCredential>, CommandError> {
    let env_token = if allow_environment {
        optional_environment_value("ARTIFACTS_PUBLISH_TOKEN")?
    } else {
        None
    };
    let env_server = if allow_environment {
        optional_environment_value("ARTIFACT_SYNC_SERVER_URL")?
    } else {
        None
    };
    if let Some(token) = env_token {
        if token.is_empty() {
            return Err(CommandError::Message(
                "ARTIFACTS_PUBLISH_TOKEN is set but empty; remove it or configure a team API token"
                    .into(),
            ));
        }
        let is_api_token = token.starts_with("as_api_") && is_refresh_credential(&token);
        let is_jwt = is_access_token(&token);
        if !is_api_token && !is_jwt {
            return Err(CommandError::Message(
                "ARTIFACTS_PUBLISH_TOKEN must be a team API token or access JWT; rotating refresh and device secrets belong in the auth file".into(),
            ));
        }
        let server = env_server.filter(|value| !value.is_empty()).ok_or_else(|| {
            CommandError::Message(
                "ARTIFACTS_PUBLISH_TOKEN is set but ARTIFACT_SYNC_SERVER_URL is missing or empty; set both explicitly".into(),
            )
        })?;
        let origin = normalize_server_origin(&server).map_err(CommandError::Message)?;
        return Ok(Some(ActiveCredential {
            access_token: SecretString::new(token.clone()),
            refresh_token: is_api_token.then(|| SecretString::new(token)),
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
        access_token: auth.access_token.clone(),
        refresh_token: Some(auth.refresh_token.clone()),
        server_origin: saved_origin,
        source: CredentialSource::AuthFile,
        cached_auth: Some(auth),
    }))
}

pub async fn validate_active_credential(
    active: &mut ActiveCredential,
    store: &CredentialStore,
) -> Result<PublisherIdentity, AuthClientError> {
    let client = AuthClient::new(active.server_origin.clone())?;

    if active.source == CredentialSource::Environment
        && is_refresh_credential(active.access_token.expose())
    {
        let exchange = client.refresh(&active.access_token, false).await?;
        let identity = client.whoami(&exchange.access_token).await?;
        if identity != exchange.identity {
            return Err(AuthClientError::MalformedResponse);
        }
        active.access_token = exchange.access_token;
        active.refresh_token = Some(exchange.refresh_token);
        return Ok(identity);
    }

    match client.whoami(&active.access_token).await {
        Ok(identity) => Ok(identity),
        Err(AuthClientError::InvalidCredential) => {
            let refresh = active
                .refresh_token
                .as_ref()
                .ok_or(AuthClientError::InvalidCredential)?;
            let exchange = client.refresh(refresh, true).await?;
            let identity = client.whoami(&exchange.access_token).await?;
            if identity != exchange.identity {
                return Err(AuthClientError::MalformedResponse);
            }
            active.access_token = exchange.access_token.clone();
            active.refresh_token = Some(exchange.refresh_token.clone());
            if active.source == CredentialSource::AuthFile {
                let auth = saved_auth_for_upload(&exchange);
                store
                    .save_login(&active.server_origin, &auth)
                    .map_err(|_| AuthClientError::UnexpectedResponse)?;
                active.cached_auth = Some(auth);
            }
            Ok(identity)
        }
        Err(error) => Err(error),
    }
}

pub(crate) fn saved_auth_for_upload(exchange: &TokenExchange) -> SavedAuth {
    SavedAuth {
        auth_type: "team_token".into(),
        access_token: exchange.access_token.clone(),
        refresh_token: exchange.refresh_token.clone(),
        token_id: exchange.identity.token_id.clone(),
        expires_at: exchange.expires_at,
        cached_identity: CachedIdentity {
            user_id: exchange.identity.user_id.clone(),
            email: exchange.identity.email.clone(),
            name: exchange.identity.name.clone(),
            team_id: exchange.identity.team_id.clone(),
            team: exchange.identity.team.clone(),
            permissions: exchange.identity.permissions.clone(),
        },
    }
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

pub fn print_identity(identity: &PublisherIdentity) {
    println!("User: {} ({})", identity.name, identity.email);
    println!("User ID: {}", identity.user_id);
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

fn read_api_token() -> Result<SecretString, CommandError> {
    let mut input = Zeroizing::new(String::new());
    std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|_| CommandError::TokenInput)?;
    let token = input.trim();
    if !is_refresh_credential(token) {
        return Err(CommandError::Message(
            "no valid team API token was supplied on standard input".into(),
        ));
    }
    Ok(SecretString::new(token.to_string()))
}

fn auth_command_error(error: AuthClientError) -> CommandError {
    match error {
        AuthClientError::InvalidCredential => CommandError::Message(
            "team credential is invalid, expired, or revoked; no credential was saved".into(),
        ),
        AuthClientError::Forbidden => CommandError::Message(
            "authenticated account lacks permission for this team operation".into(),
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

    const SAVED_ACCESS: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhcnRpZmFjdC1zeW5jIn0.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const SAVED_REFRESH: &str = "as_rf_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

    fn lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn saved_auth() -> SavedAuth {
        SavedAuth {
            auth_type: "team_token".into(),
            access_token: SecretString::new(SAVED_ACCESS),
            refresh_token: SecretString::new(SAVED_REFRESH),
            token_id: "api_saved".into(),
            expires_at: chrono::Utc::now(),
            cached_identity: CachedIdentity {
                user_id: "user-1".into(),
                email: "user@example.test".into(),
                name: "User".into(),
                team_id: "team-1".into(),
                team: "w3dev".into(),
                permissions: vec!["artifacts:publish".into(), "artifacts:read".into()],
            },
        }
    }

    #[test]
    fn device_name_uses_safe_explicit_metadata_with_a_fallback() {
        let _guard = lock().lock().unwrap();
        unsafe {
            std::env::set_var("ARTIFACT_SYNC_DEVICE_NAME", "Studio\n Workstation");
            std::env::set_var("HOSTNAME", "ignored-host");
        }
        assert_eq!(device_name(), "Studio Workstation");

        unsafe {
            std::env::set_var("ARTIFACT_SYNC_DEVICE_NAME", "   ");
            std::env::remove_var("HOSTNAME");
            std::env::remove_var("COMPUTERNAME");
        }
        assert_eq!(device_name(), "Artifact Sync CLI");
        unsafe {
            std::env::remove_var("ARTIFACT_SYNC_DEVICE_NAME");
        }
    }

    #[test]
    fn environment_api_token_requires_an_explicit_destination_and_wins_without_persistence() {
        let _guard = lock().lock().unwrap();
        let env_token = format!("as_api_{}", "A".repeat(43));
        unsafe {
            std::env::set_var("ARTIFACTS_PUBLISH_TOKEN", &env_token);
            std::env::remove_var("ARTIFACT_SYNC_SERVER_URL");
        }
        let temp = tempfile::tempdir().unwrap();
        let store = CredentialStore::new(temp.path().join("private/config.json"));
        store
            .save_login("https://saved.example", &saved_auth())
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
        let active = resolve_active_credential(&store).unwrap().unwrap();
        assert_eq!(active.source, CredentialSource::Environment);
        assert_eq!(active.server_origin, "https://env.example");
        assert_eq!(active.access_token.expose(), env_token);
        assert_eq!(
            store
                .load()
                .unwrap()
                .unwrap()
                .auth
                .unwrap()
                .access_token
                .expose(),
            SAVED_ACCESS
        );
        unsafe {
            std::env::remove_var("ARTIFACTS_PUBLISH_TOKEN");
            std::env::remove_var("ARTIFACT_SYNC_SERVER_URL");
        }
    }

    #[test]
    fn empty_environment_override_does_not_fall_back_and_destination_changes_require_login() {
        let _guard = lock().lock().unwrap();
        unsafe {
            std::env::set_var("ARTIFACTS_PUBLISH_TOKEN", "");
        }
        let temp = tempfile::tempdir().unwrap();
        let store = CredentialStore::new(temp.path().join("private/config.json"));
        store
            .save_login("https://saved.example", &saved_auth())
            .unwrap();
        assert!(
            resolve_active_credential(&store)
                .unwrap_err()
                .to_string()
                .contains("set but empty")
        );
        unsafe {
            std::env::remove_var("ARTIFACTS_PUBLISH_TOKEN");
            std::env::set_var("ARTIFACT_SYNC_SERVER_URL", "https://different.example");
        }
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

    #[test]
    fn file_only_service_credential_resolution_ignores_environment_tokens_and_destinations() {
        let _guard = lock().lock().unwrap();
        unsafe {
            std::env::set_var(
                "ARTIFACTS_PUBLISH_TOKEN",
                format!("as_api_{}", "C".repeat(43)),
            );
            std::env::set_var("ARTIFACT_SYNC_SERVER_URL", "https://environment.example");
        }
        let temp = tempfile::tempdir().unwrap();
        let store = CredentialStore::new(temp.path().join("private/config.json"));
        store
            .save_login("https://saved.example", &saved_auth())
            .unwrap();

        let active = resolve_saved_credential(&store).unwrap().unwrap();
        assert_eq!(active.source, CredentialSource::AuthFile);
        assert_eq!(active.server_origin, "https://saved.example");
        assert_eq!(active.access_token.expose(), SAVED_ACCESS);

        unsafe {
            std::env::remove_var("ARTIFACTS_PUBLISH_TOKEN");
            std::env::remove_var("ARTIFACT_SYNC_SERVER_URL");
        }
    }
}
