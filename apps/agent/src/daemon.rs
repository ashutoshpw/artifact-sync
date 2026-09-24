use crate::auth::client::AuthClientError;
use crate::auth::commands::{
    resolve_active_credential, resolve_saved_credential, validate_active_credential,
    validate_auth_path,
};
use crate::auth::credentials::ActiveCredential;
use crate::auth::store::CredentialStore;
use crate::config::{SyncConfig, load_optional_publishing_config};
use crate::state::{PendingItem, StateError, SyncState, split_artifact_relative_path};
use crate::upload::{UploadError, UploadManager, UploadOutcome};
use chrono::Utc;
use notify::event::EventKind;
use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::task::JoinSet;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

const PUBLISH_PERMISSION: &str = "artifacts:publish";

struct DaemonConfig {
    selected_team: Option<String>,
    sync: SyncConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublishingState {
    Ready,
    Offline,
    Paused,
}

impl PublishingState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Offline => "offline",
            Self::Paused => "paused",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DaemonStatus {
    pub publishing_state: PublishingState,
    pub process_id: u32,
    pub artifact_root: String,
    pub team: Option<String>,
    pub identity_verified: bool,
    pub credential_source: Option<String>,
    pub pending_count: usize,
}

#[derive(Debug, Error)]
pub enum DaemonError {
    #[error("{0}")]
    Message(String),
    #[error("sync state failed: {0}")]
    State(#[from] StateError),
    #[error("filesystem watcher failed: {0}")]
    Watch(#[from] notify::Error),
    #[error("daemon I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("authentication configuration failed: {0}")]
    Store(#[from] crate::auth::store::StoreError),
    #[error("publishing configuration failed: {0}")]
    Config(#[from] crate::config::ConfigError),
}

type JobResult = (PendingItem, Result<UploadOutcome, UploadError>);

enum LoopEvent {
    Filesystem(Option<notify::Result<notify::Event>>),
    Control(std::io::Result<(UnixStream, tokio::net::unix::SocketAddr)>),
    Upload(Option<Result<JobResult, tokio::task::JoinError>>),
    AuthReload,
    Audit,
    Retry,
    Debounce,
    Shutdown,
}

pub async fn run(
    auth_path: PathBuf,
    publishing_path: PathBuf,
    auth_file_only: bool,
) -> Result<(), DaemonError> {
    validate_auth_path(&auth_path, &publishing_path)
        .map_err(|error| DaemonError::Message(error.to_string()))?;
    let publishing = load_optional_publishing_config(&publishing_path)?;
    let root = publishing_path
        .parent()
        .ok_or_else(|| DaemonError::Message("publishing config has no parent directory".into()))?
        .to_path_buf();
    fs::create_dir_all(&root)?;
    let config = DaemonConfig {
        selected_team: publishing
            .as_ref()
            .map(|publishing| publishing.team.clone()),
        sync: publishing
            .map(|publishing| publishing.sync)
            .unwrap_or_default(),
    };

    let state = Arc::new(SyncState::open_default()?);
    let store = Arc::new(CredentialStore::new(auth_path.clone()));

    // Watch before reconciling or contacting the gateway. Authentication can
    // take seconds (or fail offline); changes during that window must remain
    // observable and be queued once the event loop starts.
    let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
    let mut watcher = notify::recommended_watcher(move |event| {
        let _ = events_tx.send(event);
    })?;
    watcher.watch(&root, RecursiveMode::Recursive)?;
    let auth_parent = auth_path
        .parent()
        .ok_or_else(|| DaemonError::Message("authentication config has no parent".into()))?;
    let _auth_parent_handle = crate::auth::store::open_private_directory(auth_parent)?;
    watcher.watch(auth_parent, RecursiveMode::NonRecursive)?;
    state.reconcile(&root)?;

    let mut active = resolve_daemon_credential(&store, auth_file_only)?
        .ok_or_else(|| DaemonError::Message(missing_credential_message(auth_file_only).into()))?;
    let mut credential_source = Some(active.source.label().to_string());

    // Without a publishing config, the cached team is only a selection hint:
    // the gateway still verifies the credential and confirms this team before
    // any upload can be scheduled.
    let mut expected_team = config.selected_team.clone().or_else(|| {
        active
            .cached_auth
            .as_ref()
            .map(|auth| auth.cached_identity.team.clone())
    });
    let mut manager = authenticate_for_daemon(&mut active, &store, &mut expected_team).await?;
    let mut auth_paused = false;
    let mut auth_retry_delay = Duration::from_secs(1);
    let mut auth_retry_at = Instant::now() + auth_retry_delay;
    if manager.is_none() {
        warn!(
            "authentication server is unreachable; pending changes are retained while authentication retries with backoff"
        );
    }

    let (control_listener, _socket_guard) = bind_control_socket().await?;
    let mut jobs = JoinSet::<JobResult>::new();
    let mut in_flight = HashSet::<String>::new();
    let mut changed_paths = HashSet::<PathBuf>::new();
    let mut debounce_armed = false;
    let mut reconcile_after_debounce = false;
    let debounce_duration = Duration::from_millis(config.sync.debounce_ms.clamp(50, 10_000));
    let debounce_sleep = tokio::time::sleep(Duration::from_secs(24 * 60 * 60));
    tokio::pin!(debounce_sleep);
    let auth_reload_sleep = tokio::time::sleep(Duration::from_secs(24 * 60 * 60));
    tokio::pin!(auth_reload_sleep);
    let mut auth_reload_armed = false;
    let mut cancellation = CancellationToken::new();
    let mut retry_timer = tokio::time::interval(Duration::from_secs(1));
    retry_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut audit_timer = tokio::time::interval(Duration::from_secs(
        config.sync.audit_interval_seconds.max(1),
    ));
    audit_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let shutdown_signal = tokio::signal::ctrl_c();
    tokio::pin!(shutdown_signal);
    let mut terminate_signal =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    info!(team = expected_team.as_deref().unwrap_or("resolved from credential"), root = %root.display(), "artifact sync daemon started");

    loop {
        let event = tokio::select! {
            result = events_rx.recv() => LoopEvent::Filesystem(result),
            result = control_listener.accept() => LoopEvent::Control(result),
            joined = jobs.join_next(), if !jobs.is_empty() => LoopEvent::Upload(joined),
            _ = retry_timer.tick() => LoopEvent::Retry,
            _ = audit_timer.tick(), if config.sync.audit_interval_seconds > 0 => LoopEvent::Audit,
            _ = &mut debounce_sleep, if debounce_armed => LoopEvent::Debounce,
            _ = &mut auth_reload_sleep, if auth_reload_armed => LoopEvent::AuthReload,
            _ = &mut shutdown_signal => LoopEvent::Shutdown,
            _ = terminate_signal.recv() => LoopEvent::Shutdown,
        };

        match event {
            LoopEvent::Filesystem(Some(Ok(fs_event))) => {
                debug!(kind = ?fs_event.kind, paths = ?fs_event.paths, "filesystem watcher event received");
                if is_mutating_event_kind(&fs_event.kind) {
                    let auth_changed = fs_event.paths.iter().any(|path| path == &auth_path);
                    if auth_changed {
                        if !auth_reload_armed {
                            invalidate_current_manager(&mut manager, &mut cancellation).await;
                        }
                        auth_reload_sleep
                            .as_mut()
                            .reset(Instant::now() + Duration::from_millis(100));
                        auth_reload_armed = true;
                    }
                    for path in fs_event.paths {
                        if path == auth_path
                            || path == publishing_path
                            || !path.starts_with(&root)
                            || is_ignored_path(&root, &path)
                        {
                            continue;
                        }
                        if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_dir()) {
                            reconcile_after_debounce = true;
                            debounce_sleep
                                .as_mut()
                                .reset(Instant::now() + debounce_duration);
                            debounce_armed = true;
                            continue;
                        }
                        changed_paths.insert(path);
                        debounce_sleep
                            .as_mut()
                            .reset(Instant::now() + debounce_duration);
                        debounce_armed = true;
                    }
                }
            }
            LoopEvent::Filesystem(Some(Err(_))) => warn!(
                "filesystem watcher reported an error; periodic audit can reconcile missed changes"
            ),
            LoopEvent::Filesystem(None) => {
                return Err(DaemonError::Message(
                    "filesystem watcher stopped unexpectedly".into(),
                ));
            }
            LoopEvent::Control(Ok((mut stream, _))) => {
                let mut command = [0u8; 64];
                if let Ok(Ok(length)) =
                    tokio::time::timeout(Duration::from_secs(2), stream.read(&mut command)).await
                {
                    match std::str::from_utf8(&command[..length])
                        .unwrap_or_default()
                        .trim()
                    {
                        "AUTH_CHANGED" => {
                            auth_reload_armed = false;
                            auth_reload_sleep
                                .as_mut()
                                .reset(Instant::now() + Duration::from_secs(24 * 60 * 60));
                            reload_auth(
                                &store,
                                &mut expected_team,
                                auth_file_only,
                                &mut credential_source,
                                &mut manager,
                                &mut cancellation,
                                &mut auth_paused,
                            )
                            .await;
                            let _ = stream.write_all(b"OK\n").await;
                        }
                        "STATUS" => {
                            let status_result =
                                state.pending_count().map(|pending_count| DaemonStatus {
                                    publishing_state: if manager.is_some() {
                                        PublishingState::Ready
                                    } else if auth_paused {
                                        PublishingState::Paused
                                    } else {
                                        PublishingState::Offline
                                    },
                                    process_id: std::process::id(),
                                    artifact_root: root.to_string_lossy().into_owned(),
                                    team: expected_team.clone(),
                                    identity_verified: manager.is_some(),
                                    credential_source: credential_source.clone(),
                                    pending_count,
                                });
                            match status_result {
                                Ok(status) => match serde_json::to_vec(&status) {
                                    Ok(mut response) => {
                                        response.push(b'\n');
                                        let _ = stream.write_all(&response).await;
                                    }
                                    Err(error) => {
                                        warn!(error = %error, "could not serialize daemon status");
                                        let _ = stream
                                            .write_all(b"{\"error\":\"status unavailable\"}\n")
                                            .await;
                                    }
                                },
                                Err(error) => {
                                    warn!(error = %error, "could not read pending count for daemon status");
                                    let _ = stream
                                        .write_all(b"{\"error\":\"status unavailable\"}\n")
                                        .await;
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            LoopEvent::Control(Err(error)) => {
                warn!(error = %error, "could not accept daemon control connection")
            }
            LoopEvent::Upload(Some(Ok((item, result)))) => {
                in_flight.remove(&item.relative_path.to_string_lossy().to_string());
                match result {
                    Ok(UploadOutcome::Uploaded) => {
                        state.mark_uploaded(&item)?;
                        info!(path = %item.relative_path.display(), "artifact uploaded");
                    }
                    Ok(UploadOutcome::Changed) => {
                        let path = root.join(&item.relative_path);
                        let _ = state.observe_file(&root, &path)?;
                    }
                    Err(UploadError::Cancelled) => {}
                    Err(UploadError::Auth(
                        AuthClientError::InvalidCredential | AuthClientError::Forbidden,
                    )) => {
                        cancellation.cancel();
                        auth_paused = true;
                        if let Some(current) = manager.take() {
                            current.clear_cached_credentials().await;
                        }
                        error!(
                            "team credential was rejected or lacks permission; publishing is paused. Run artifact-sync whoami, then login again or revoke/recreate the team API token in Settings."
                        );
                    }
                    Err(UploadError::Auth(AuthClientError::Unavailable)) => {
                        retry_item(&state, &item)?;
                        warn!(path = %item.relative_path.display(), "upload server is unreachable; queued work will retry with backoff");
                    }
                    Err(UploadError::Auth(other)) => {
                        retry_item(&state, &item)?;
                        warn!(path = %item.relative_path.display(), error = %other, "publisher credential exchange failed; queued work will retry");
                    }
                    Err(other) => {
                        retry_item(&state, &item)?;
                        warn!(path = %item.relative_path.display(), error = %other, "gateway upload failed; queued work will retry");
                    }
                }
            }
            LoopEvent::Upload(Some(Err(_))) => {
                warn!("upload worker exited unexpectedly; pending work remains in local state")
            }
            LoopEvent::Upload(None) => {}
            LoopEvent::Audit => {
                if let Err(error) = state.reconcile(&root) {
                    warn!(error = %error, "artifact audit failed");
                }
            }
            LoopEvent::AuthReload => {
                auth_reload_armed = false;
                reload_auth(
                    &store,
                    &mut expected_team,
                    auth_file_only,
                    &mut credential_source,
                    &mut manager,
                    &mut cancellation,
                    &mut auth_paused,
                )
                .await;
            }
            LoopEvent::Retry => {
                if manager.is_none() && !auth_paused && Instant::now() >= auth_retry_at {
                    match resolve_daemon_credential(&store, auth_file_only) {
                        Ok(Some(mut active)) => {
                            credential_source = Some(active.source.label().to_string());
                            match authenticate_for_daemon(&mut active, &store, &mut expected_team)
                                .await
                            {
                                Ok(Some(next)) => {
                                    manager = Some(next);
                                    auth_retry_delay = Duration::from_secs(1);
                                    info!(
                                        source = active.source.label(),
                                        "team credentials are verified; queued uploads resumed"
                                    );
                                }
                                Ok(None) => {
                                    auth_retry_at = Instant::now() + auth_retry_delay;
                                    auth_retry_delay =
                                        (auth_retry_delay * 2).min(Duration::from_secs(300));
                                    warn!(
                                        "gateway is still unreachable; queued uploads remain pending"
                                    );
                                }
                                Err(error) => {
                                    auth_paused = true;
                                    error!(error = %error, "team credentials are definitively invalid; publishing is paused until credentials change");
                                }
                            }
                        }
                        Ok(None) => {
                            credential_source = None;
                            auth_paused = true;
                            warn!(
                                "team credentials were removed; queued uploads remain pending until login"
                            );
                        }
                        Err(error) => {
                            auth_paused = true;
                            error!(error = %error, "could not load team credentials; publishing is paused until the credential file changes");
                        }
                    }
                }
            }
            LoopEvent::Debounce => {
                debug!(
                    paths = changed_paths.len(),
                    reconcile_after_debounce, "debounced filesystem changes"
                );
                debounce_armed = false;
                if reconcile_after_debounce {
                    reconcile_after_debounce = false;
                    if let Err(error) = state.reconcile(&root) {
                        warn!(error = %error, "artifact directory reconciliation failed");
                    }
                }
                for path in changed_paths.drain() {
                    if let Err(error) = state.observe_file(&root, &path) {
                        warn!(error = %error, "could not queue changed artifact");
                    }
                }
            }
            LoopEvent::Shutdown => {
                cancellation.cancel();
                jobs.abort_all();
                while jobs.join_next().await.is_some() {}
                info!("artifact sync daemon stopped; pending work remains in local state");
                return Ok(());
            }
        }

        if let Some(current_manager) = manager.as_ref() {
            schedule_uploads(
                &state,
                current_manager,
                &root,
                &config,
                &cancellation,
                &mut jobs,
                &mut in_flight,
            )?;
        }
    }
}

async fn authenticate_for_daemon(
    active: &mut ActiveCredential,
    store: &CredentialStore,
    expected_team: &mut Option<String>,
) -> Result<Option<Arc<UploadManager>>, DaemonError> {
    match validate_active_credential(active, store).await {
        Ok(identity) => {
            if let Some(expected) = expected_team.as_deref() {
                if identity.team != expected {
                    return Err(DaemonError::Message(format!(
                        "credential is authorized for team '{}' but this daemon is bound to '{}'",
                        identity.team, expected
                    )));
                }
            } else {
                *expected_team = Some(identity.team.clone());
            }
            if !identity
                .permissions
                .iter()
                .any(|permission| permission == PUBLISH_PERMISSION)
            {
                return Err(DaemonError::Message(
                    "credential lacks artifacts:publish permission".into(),
                ));
            }
            Ok(Some(make_upload_manager(active, &identity, store)?))
        }
        Err(AuthClientError::Unavailable) => Ok(None),
        Err(AuthClientError::InvalidCredential) => Err(DaemonError::Message(
            "team credential is invalid, expired, or revoked; run artifact-sync login".into(),
        )),
        Err(AuthClientError::Forbidden) => Err(DaemonError::Message(
            "authenticated account lacks publishing permission for the authorized team".into(),
        )),
        Err(error) => Err(DaemonError::Message(format!(
            "authentication could not be validated: {error}"
        ))),
    }
}

fn make_upload_manager(
    active: &ActiveCredential,
    identity: &crate::auth::credentials::PublisherIdentity,
    store: &CredentialStore,
) -> Result<Arc<UploadManager>, DaemonError> {
    let client = crate::auth::client::AuthClient::new(active.server_origin.clone())
        .map_err(|error| DaemonError::Message(error.to_string()))?;
    Ok(Arc::new(UploadManager::new(
        client,
        active,
        identity.team.clone(),
        identity.expires_at,
        store,
    )))
}

fn resolve_daemon_credential(
    store: &CredentialStore,
    auth_file_only: bool,
) -> Result<Option<ActiveCredential>, DaemonError> {
    let result = if auth_file_only {
        resolve_saved_credential(store)
    } else {
        resolve_active_credential(store)
    };
    result.map_err(|error| DaemonError::Message(error.to_string()))
}

fn missing_credential_message(auth_file_only: bool) -> &'static str {
    if auth_file_only {
        "saved team credentials are missing; run `artifact-sync login` before installing the service"
    } else {
        "team credentials are missing; run `artifact-sync login` or configure ARTIFACTS_PUBLISH_TOKEN and ARTIFACT_SYNC_SERVER_URL"
    }
}

async fn reload_auth(
    store: &CredentialStore,
    expected_team: &mut Option<String>,
    auth_file_only: bool,
    credential_source: &mut Option<String>,
    manager: &mut Option<Arc<UploadManager>>,
    cancellation: &mut CancellationToken,
    auth_paused: &mut bool,
) {
    invalidate_current_manager(manager, cancellation).await;
    *auth_paused = false;

    let mut active = match resolve_daemon_credential(store, auth_file_only) {
        Ok(Some(active)) => active,
        Ok(None) => {
            *credential_source = None;
            *auth_paused = true;
            warn!("team credentials were removed; uploads are paused and queued work is preserved");
            return;
        }
        Err(error) => {
            *auth_paused = true;
            warn!(error = %error, "could not load team credentials; uploads are paused");
            return;
        }
    };
    *credential_source = Some(active.source.label().to_string());
    match authenticate_for_daemon(&mut active, store, expected_team).await {
        Ok(Some(next)) => {
            *manager = Some(next);
            info!(
                source = active.source.label(),
                "team credentials changed and were verified"
            );
        }
        Ok(None) => {
            warn!(
                "new credential destination is unreachable; changes remain queued until connectivity returns"
            );
        }
        Err(error) => {
            *auth_paused = true;
            warn!(error = %error, "new team credential could not be verified; publishing is paused")
        }
    }
}

async fn invalidate_current_manager(
    manager: &mut Option<Arc<UploadManager>>,
    cancellation: &mut CancellationToken,
) {
    cancellation.cancel();
    if let Some(current) = manager.take() {
        current.clear_cached_credentials().await;
    }
    *cancellation = CancellationToken::new();
}

fn schedule_uploads(
    state: &SyncState,
    manager: &Arc<UploadManager>,
    root: &Path,
    config: &DaemonConfig,
    cancellation: &CancellationToken,
    jobs: &mut JoinSet<JobResult>,
    in_flight: &mut HashSet<String>,
) -> Result<(), DaemonError> {
    let available = config
        .sync
        .max_concurrent_uploads
        .saturating_sub(in_flight.len());
    if available == 0 {
        return Ok(());
    }
    let due = state.pending_due(
        Utc::now().timestamp(),
        available.saturating_add(in_flight.len()),
    )?;
    let mut scheduled = 0usize;
    for item in due {
        if scheduled >= available {
            break;
        }
        let relative = item.relative_path.to_string_lossy().to_string();
        if split_artifact_relative_path(&relative).is_none() {
            state.remove_pending(root, &root.join(&item.relative_path))?;
            continue;
        }
        if in_flight.contains(&relative) {
            continue;
        }
        let path = root.join(&item.relative_path);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {}
            _ => {
                state.remove_pending(root, &path)?;
                continue;
            }
        }
        in_flight.insert(relative);
        scheduled += 1;
        let manager = manager.clone();
        let root = root.to_path_buf();
        let cancellation = cancellation.clone();
        jobs.spawn(async move {
            let result = manager
                .upload_file(&root, &path, &item.content_hash, &cancellation)
                .await;
            (item, result)
        });
    }
    Ok(())
}

fn retry_item(state: &SyncState, item: &PendingItem) -> Result<(), StateError> {
    let delay = 1u64
        .checked_shl(item.attempts.min(8))
        .unwrap_or(256)
        .min(300);
    state.retry_later(item, delay)
}

fn is_mutating_event_kind(kind: &EventKind) -> bool {
    !matches!(kind, EventKind::Access(_) | EventKind::Other)
}

fn is_ignored_path(root: &Path, path: &Path) -> bool {
    if path == root.join("config.json") {
        return true;
    }
    path.strip_prefix(root).ok().is_some_and(|relative| {
        relative
            .components()
            .any(|component| component.as_os_str() == ".artifact-sync")
    })
}

pub fn daemon_socket_path() -> Result<PathBuf, std::io::Error> {
    let home = dirs::home_dir().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "home directory unavailable")
    })?;
    Ok(home.join(".config/artifact-sync/daemon.sock"))
}

pub async fn daemon_is_running() -> Result<bool, std::io::Error> {
    let path = daemon_socket_path()?;
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_socket()
        || metadata.uid() != unsafe { libc::geteuid() }
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "daemon control path is not a safe user-owned socket",
        ));
    }
    match UnixStream::connect(path).await {
        Ok(_) => Ok(true),
        Err(error)
            if error.kind() == std::io::ErrorKind::ConnectionRefused
                || error.kind() == std::io::ErrorKind::NotFound =>
        {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

pub async fn query_status() -> Result<Option<DaemonStatus>, std::io::Error> {
    if !daemon_is_running().await? {
        return Ok(None);
    }
    let mut stream = UnixStream::connect(daemon_socket_path()?).await?;
    stream.write_all(b"STATUS\n").await?;
    stream.shutdown().await?;
    let mut response = Vec::new();
    tokio::time::timeout(Duration::from_secs(3), stream.read_to_end(&mut response))
        .await
        .map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::TimedOut, "daemon status timed out")
        })??;
    if response.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "running daemon does not support status requests",
        ));
    }
    serde_json::from_slice(&response)
        .map(Some)
        .map_err(|error| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("daemon returned invalid status data: {error}"),
            )
        })
}

async fn bind_control_socket() -> Result<(UnixListener, SocketGuard), DaemonError> {
    let directory = daemon_socket_path()?
        .parent()
        .ok_or_else(|| DaemonError::Message("daemon control path has no parent".into()))?
        .to_path_buf();
    let _directory_handle = crate::auth::store::open_private_directory(&directory)?;
    let path = directory.join("daemon.sock");
    match fs::symlink_metadata(&path) {
        Ok(existing) => {
            if existing.file_type().is_symlink()
                || !existing.file_type().is_socket()
                || existing.uid() != unsafe { libc::geteuid() }
            {
                return Err(DaemonError::Message(
                    "daemon control path exists and is not a safe socket".into(),
                ));
            }
            match UnixStream::connect(&path).await {
                Ok(_) => {
                    return Err(DaemonError::Message(
                        "artifact-sync daemon is already running".into(),
                    ));
                }
                Err(error)
                    if error.kind() == std::io::ErrorKind::ConnectionRefused
                        || error.kind() == std::io::ErrorKind::NotFound =>
                {
                    fs::remove_file(&path)?
                }
                Err(error) => return Err(error.into()),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let listener = UnixListener::bind(&path)?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    Ok((listener, SocketGuard(path)))
}

struct SocketGuard(PathBuf);
impl Drop for SocketGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_protocol_labels_cached_identity_unverified_while_offline() {
        let status = DaemonStatus {
            publishing_state: PublishingState::Offline,
            process_id: 42,
            artifact_root: "/tmp/artifacts".into(),
            team: Some("w3dev".into()),
            identity_verified: false,
            credential_source: Some("auth file".into()),
            pending_count: 3,
        };
        let encoded = serde_json::to_value(status).unwrap();
        assert_eq!(encoded["publishingState"], "offline");
        assert_eq!(encoded["identityVerified"], false);
        assert_eq!(encoded["pendingCount"], 3);
        assert_eq!(encoded["processId"], 42);
        assert_eq!(PublishingState::Ready.as_str(), "ready");
        assert_eq!(PublishingState::Paused.as_str(), "paused");
    }
}
