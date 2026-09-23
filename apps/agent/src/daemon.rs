use crate::auth::client::{AuthClient, AuthClientError};
use crate::auth::commands::{resolve_active_credential, validate_auth_path};
use crate::auth::credentials::ActiveCredential;
use crate::auth::store::CredentialStore;
use crate::config::{PublishingConfig, load_publishing_config};
use crate::state::{PendingItem, StateError, SyncState};
use crate::upload::{UploadError, UploadManager, UploadOutcome};
use chrono::Utc;
use notify::event::EventKind;
use notify::{RecursiveMode, Watcher};
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

pub async fn run(auth_path: PathBuf, publishing_path: PathBuf) -> Result<(), DaemonError> {
    validate_auth_path(&auth_path, &publishing_path)
        .map_err(|error| DaemonError::Message(error.to_string()))?;
    let config = load_publishing_config(&publishing_path)?;
    let root = publishing_path
        .parent()
        .ok_or_else(|| DaemonError::Message("publishing config has no parent directory".into()))?
        .to_path_buf();
    if !root.is_dir() {
        return Err(DaemonError::Message("artifact root does not exist".into()));
    }

    let state = Arc::new(SyncState::open_default()?);
    state.reconcile(&root)?;
    let store = Arc::new(CredentialStore::new(auth_path.clone()));
    let active = resolve_active_credential(&store)
        .map_err(|error| DaemonError::Message(error.to_string()))?
        .ok_or_else(|| DaemonError::Message("publisher credentials are missing; run `artifact-sync login` or configure ARTIFACTS_PUBLISH_TOKEN and ARTIFACT_SYNC_SERVER_URL".into()))?;

    let mut manager = authenticate_for_daemon(&active, &config).await?;
    if manager.is_none() {
        warn!("authentication server is unreachable; pending changes will be retained and retried");
        manager = Some(make_upload_manager(&active, &config)?);
    }

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

    let (control_listener, _socket_guard) = bind_control_socket().await?;
    let mut jobs = JoinSet::<JobResult>::new();
    let mut in_flight = HashSet::<String>::new();
    let mut changed_paths = HashSet::<PathBuf>::new();
    let mut debounce_armed = false;
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
    info!(team = %config.team, root = %root.display(), "artifact sync daemon started");

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
                if tokio::time::timeout(Duration::from_secs(2), stream.read(&mut command))
                    .await
                    .is_ok_and(|result| result.is_ok())
                    && command.starts_with(b"AUTH_CHANGED")
                {
                    auth_reload_armed = false;
                    auth_reload_sleep
                        .as_mut()
                        .reset(Instant::now() + Duration::from_secs(24 * 60 * 60));
                    reload_auth(&store, &config, &mut manager, &mut cancellation).await;
                    stream.write_all(b"OK\n").await?;
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
                        if let Some(current) = manager.take() {
                            current.clear_cached_credentials().await;
                        }
                        error!(
                            "publisher credential was rejected; publishing is paused. Run artifact-sync whoami, then login again or ask an operator to restore permission."
                        );
                    }
                    Err(UploadError::Auth(AuthClientError::Unavailable))
                    | Err(UploadError::Network) => {
                        retry_item(&state, &item)?;
                        warn!(path = %item.relative_path.display(), "upload server is unreachable; queued work will retry with backoff");
                    }
                    Err(UploadError::Auth(other)) => {
                        retry_item(&state, &item)?;
                        warn!(path = %item.relative_path.display(), error = %other, "publisher credential exchange failed; queued work will retry");
                    }
                    Err(other) => {
                        retry_item(&state, &item)?;
                        warn!(path = %item.relative_path.display(), error = %other, "R2 upload failed; queued work will retry");
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
                reload_auth(&store, &config, &mut manager, &mut cancellation).await;
            }
            LoopEvent::Retry => {}
            LoopEvent::Debounce => {
                debug!(paths = changed_paths.len(), "debounced filesystem changes");
                debounce_armed = false;
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
    active: &ActiveCredential,
    config: &PublishingConfig,
) -> Result<Option<Arc<UploadManager>>, DaemonError> {
    let client = AuthClient::new(active.server_origin.clone())
        .map_err(|error| DaemonError::Message(error.to_string()))?;
    match client.whoami(&active.token).await {
        Ok(identity) => {
            if identity.team != config.team {
                return Err(DaemonError::Message(format!(
                    "publisher is authorized for team '{}' but publishing config selects '{}'",
                    identity.team, config.team
                )));
            }
            if !identity
                .permissions
                .iter()
                .any(|permission| permission == PUBLISH_PERMISSION)
            {
                return Err(DaemonError::Message(
                    "publisher credential lacks artifacts:publish permission".into(),
                ));
            }
            Ok(Some(make_upload_manager(active, config)?))
        }
        Err(AuthClientError::Unavailable) => Ok(None),
        Err(AuthClientError::InvalidCredential) => Err(DaemonError::Message(
            "publisher credential is invalid, expired, or revoked; run artifact-sync login".into(),
        )),
        Err(AuthClientError::Forbidden) => Err(DaemonError::Message(
            "publisher is authenticated but lacks publishing permission".into(),
        )),
        Err(error) => Err(DaemonError::Message(format!(
            "authentication could not be validated: {error}"
        ))),
    }
}

fn make_upload_manager(
    active: &ActiveCredential,
    config: &PublishingConfig,
) -> Result<Arc<UploadManager>, DaemonError> {
    let client = AuthClient::new(active.server_origin.clone())
        .map_err(|error| DaemonError::Message(error.to_string()))?;
    Ok(Arc::new(UploadManager::new(
        client,
        active.token.clone(),
        config.team.clone(),
    )))
}

async fn reload_auth(
    store: &CredentialStore,
    config: &PublishingConfig,
    manager: &mut Option<Arc<UploadManager>>,
    cancellation: &mut CancellationToken,
) {
    invalidate_current_manager(manager, cancellation).await;

    let active = match resolve_active_credential(store) {
        Ok(Some(active)) => active,
        Ok(None) => {
            warn!(
                "publisher credentials were removed; uploads are paused and queued work is preserved"
            );
            return;
        }
        Err(error) => {
            warn!(error = %error, "could not load publisher credentials; uploads are paused");
            return;
        }
    };
    match authenticate_for_daemon(&active, config).await {
        Ok(Some(next)) => {
            *manager = Some(next);
            info!(
                source = active.source.label(),
                "publisher credentials changed and were verified"
            );
        }
        Ok(None) => {
            *manager = make_upload_manager(&active, config).ok();
            warn!(
                "new credential destination is unreachable; changes remain queued until connectivity returns"
            );
        }
        Err(error) => {
            warn!(error = %error, "new publisher credential could not be verified; publishing is paused")
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
    config: &PublishingConfig,
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

async fn bind_control_socket() -> Result<(UnixListener, SocketGuard), DaemonError> {
    let home = dirs::home_dir()
        .ok_or_else(|| DaemonError::Message("home directory unavailable".into()))?;
    let directory = home.join(".config/artifact-sync");
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
