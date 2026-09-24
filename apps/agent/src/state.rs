use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StateError {
    #[error("sync state I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("sync state database failed: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("artifact path is outside the watched root")]
    OutsideRoot,
    #[error("artifact path must be a valid artifact slug followed by a file path")]
    InvalidArtifactPath,
    #[error("sync state is unsafe: {0}")]
    Unsafe(String),
}

#[derive(Debug, Clone)]
pub struct PendingItem {
    pub relative_path: PathBuf,
    pub content_hash: String,
    pub attempts: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactFilePath {
    pub slug: String,
    pub path: String,
}

pub struct SyncState {
    connection: Mutex<Connection>,
}

impl SyncState {
    pub fn pending_count_default() -> Result<usize, StateError> {
        let home = dirs::home_dir().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "home directory unavailable")
        })?;
        let home = fs::canonicalize(home)?;
        let directory = home.join(".local/state/artifact-sync");
        let mut current = PathBuf::new();
        for component in directory.components() {
            current.push(component);
            match fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                    return Err(StateError::Unsafe(format!(
                        "state directory contains a symlink or non-directory: {}",
                        current.display()
                    )));
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
                Err(error) => return Err(error.into()),
            }
        }
        let metadata = fs::symlink_metadata(&directory)?;
        if metadata.uid() != unsafe { libc::geteuid() }
            || metadata.permissions().mode() & 0o777 != 0o700
        {
            return Err(StateError::Unsafe(
                "state directory must be owned by the current user with mode 0700".into(),
            ));
        }
        pending_count_from_path(&directory.join("state.sqlite3"))
    }

    pub fn open_default() -> Result<Self, StateError> {
        let home = dirs::home_dir().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "home directory unavailable")
        })?;
        let directory = home.join(".local/state/artifact-sync");
        fs::create_dir_all(&directory)?;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        let database = directory.join("state.sqlite3");
        if !database.exists() {
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&database)?;
        }
        let connection = Connection::open(&database)?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=FULL;
             CREATE TABLE IF NOT EXISTS uploaded (
               path TEXT PRIMARY KEY,
               content_hash TEXT NOT NULL,
               uploaded_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS pending (
               path TEXT PRIMARY KEY,
               content_hash TEXT NOT NULL,
               attempts INTEGER NOT NULL DEFAULT 0,
               next_attempt_at INTEGER NOT NULL DEFAULT 0
             );",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    #[cfg(test)]
    pub fn open(path: &Path) -> Result<Self, StateError> {
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS uploaded (path TEXT PRIMARY KEY, content_hash TEXT NOT NULL, uploaded_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS pending (path TEXT PRIMARY KEY, content_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0);",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn observe_file(
        &self,
        root: &Path,
        path: &Path,
    ) -> Result<Option<PendingItem>, StateError> {
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                self.remove_pending(root, path)?;
                return Ok(None);
            }
            Err(error) => return Err(error.into()),
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() || should_ignore(root, path) {
            return Ok(None);
        }
        let relative = normalized_relative_path(root, path)?;
        if split_artifact_relative_path(&relative).is_none() {
            return Ok(None);
        }
        let bytes = fs::read(path)?;
        let hash = hex::encode(Sha256::digest(bytes));
        let connection = self.connection.lock().expect("state mutex poisoned");
        let uploaded: Option<String> = connection
            .query_row(
                "SELECT content_hash FROM uploaded WHERE path = ?1",
                params![relative],
                |row| row.get(0),
            )
            .optional()?;
        if uploaded.as_deref() == Some(hash.as_str()) {
            return Ok(None);
        }
        connection.execute(
            "INSERT INTO pending(path, content_hash, attempts, next_attempt_at) VALUES (?1, ?2, 0, 0)
             ON CONFLICT(path) DO UPDATE SET content_hash=excluded.content_hash, attempts=0, next_attempt_at=0
             WHERE pending.content_hash != excluded.content_hash",
            params![relative, hash],
        )?;
        Ok(Some(PendingItem {
            relative_path: PathBuf::from(relative),
            content_hash: hash,
            attempts: 0,
        }))
    }

    pub fn remove_pending(&self, root: &Path, path: &Path) -> Result<(), StateError> {
        let relative = normalized_relative_path(root, path)?;
        self.connection
            .lock()
            .expect("state mutex poisoned")
            .execute("DELETE FROM pending WHERE path = ?1", params![relative])?;
        Ok(())
    }

    pub fn pending_due(&self, now: i64, limit: usize) -> Result<Vec<PendingItem>, StateError> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        let mut statement = connection.prepare(
            "SELECT path, content_hash, attempts FROM pending WHERE next_attempt_at <= ?1 ORDER BY path LIMIT ?2",
        )?;
        let rows = statement.query_map(params![now, limit as i64], |row| {
            Ok(PendingItem {
                relative_path: PathBuf::from(row.get::<_, String>(0)?),
                content_hash: row.get(1)?,
                attempts: row.get::<_, i64>(2)? as u32,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StateError::from)
    }

    pub fn pending_count(&self) -> Result<usize, StateError> {
        self.connection
            .lock()
            .expect("state mutex poisoned")
            .query_row("SELECT COUNT(*) FROM pending", [], |row| row.get(0))
            .map_err(StateError::from)
    }

    pub fn mark_uploaded(&self, item: &PendingItem) -> Result<(), StateError> {
        let now = chrono::Utc::now().timestamp();
        let mut connection = self.connection.lock().expect("state mutex poisoned");
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO uploaded(path, content_hash, uploaded_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET content_hash=excluded.content_hash, uploaded_at=excluded.uploaded_at",
            params![item.relative_path.to_string_lossy(), item.content_hash, now],
        )?;
        transaction.execute(
            "DELETE FROM pending WHERE path = ?1 AND content_hash = ?2",
            params![item.relative_path.to_string_lossy(), item.content_hash],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn retry_later(&self, item: &PendingItem, delay_seconds: u64) -> Result<(), StateError> {
        let next = chrono::Utc::now().timestamp() + delay_seconds as i64;
        self.connection.lock().expect("state mutex poisoned").execute(
            "UPDATE pending SET attempts = attempts + 1, next_attempt_at = ?3 WHERE path = ?1 AND content_hash = ?2",
            params![item.relative_path.to_string_lossy(), item.content_hash, next],
        )?;
        Ok(())
    }

    pub fn reconcile(&self, root: &Path) -> Result<(), StateError> {
        walk_artifacts(root, &mut |path| {
            let _ = self.observe_file(root, path)?;
            Ok(())
        })?;
        self.prune_unscoped_pending()
    }

    fn prune_unscoped_pending(&self) -> Result<(), StateError> {
        let connection = self.connection.lock().expect("state mutex poisoned");
        let pending_paths = {
            let mut statement = connection.prepare("SELECT path FROM pending")?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        for path in pending_paths {
            if split_artifact_relative_path(&path).is_none() {
                connection.execute("DELETE FROM pending WHERE path = ?1", params![path])?;
            }
        }
        Ok(())
    }
}

fn pending_count_from_path(path: &Path) -> Result<usize, StateError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(StateError::Unsafe(
            "state database must be a regular file, not a symlink".into(),
        ));
    }
    if metadata.uid() != unsafe { libc::geteuid() } || metadata.permissions().mode() & 0o077 != 0 {
        return Err(StateError::Unsafe(
            "state database must be owned by the current user and not group/world accessible"
                .into(),
        ));
    }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    connection
        .query_row("SELECT COUNT(*) FROM pending", [], |row| row.get(0))
        .map_err(StateError::from)
}

pub fn hash_file(path: &Path) -> Result<String, StateError> {
    Ok(hex::encode(Sha256::digest(fs::read(path)?)))
}

pub fn normalized_relative_path(root: &Path, path: &Path) -> Result<String, StateError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| StateError::OutsideRoot)?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => {
                let text = part.to_str().ok_or(StateError::OutsideRoot)?;
                if text.is_empty()
                    || text == "."
                    || text == ".."
                    || text.contains('\\')
                    || text.contains('\0')
                {
                    return Err(StateError::OutsideRoot);
                }
                parts.push(text.to_string());
            }
            _ => return Err(StateError::OutsideRoot),
        }
    }
    if parts.is_empty() {
        return Err(StateError::OutsideRoot);
    }
    Ok(parts.join("/"))
}

pub fn artifact_file_path(root: &Path, path: &Path) -> Result<ArtifactFilePath, StateError> {
    let relative = normalized_relative_path(root, path)?;
    split_artifact_relative_path(&relative).ok_or(StateError::InvalidArtifactPath)
}

pub fn split_artifact_relative_path(relative: &str) -> Option<ArtifactFilePath> {
    let (slug, path) = relative.split_once('/')?;
    if !is_valid_artifact_slug(slug) || path.is_empty() {
        return None;
    }
    if path.split('/').any(|part| {
        part.is_empty() || part == "." || part == ".." || part.contains('\\') || part.contains('\0')
    }) {
        return None;
    }
    Some(ArtifactFilePath {
        slug: slug.to_string(),
        path: path.to_string(),
    })
}

pub fn is_valid_artifact_slug(value: &str) -> bool {
    if value.is_empty() || value.len() > 63 {
        return false;
    }
    let bytes = value.as_bytes();
    if !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit() {
        return false;
    }
    if !bytes[bytes.len() - 1].is_ascii_lowercase() && !bytes[bytes.len() - 1].is_ascii_digit() {
        return false;
    }
    bytes
        .iter()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

fn should_ignore(root: &Path, path: &Path) -> bool {
    if path == root.join("config.json") {
        return true;
    }
    path.strip_prefix(root).ok().is_some_and(|relative| {
        relative
            .components()
            .any(|part| part.as_os_str() == ".artifact-sync")
    })
}

fn walk_artifacts(
    root: &Path,
    visit: &mut dyn FnMut(&Path) -> Result<(), StateError>,
) -> Result<(), StateError> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_symlink() || should_ignore(root, &path) {
            continue;
        }
        if file_type.is_dir() {
            let slug = entry.file_name();
            let Some(slug) = slug.to_str() else {
                tracing::warn!(artifact = %slug.to_string_lossy(), "artifact directory ignored because its name is not a valid URL slug");
                continue;
            };
            if !is_valid_artifact_slug(slug) {
                tracing::warn!(artifact = %slug, "artifact directory ignored because its name is not a valid URL slug");
                continue;
            }
            walk_files(root, &path, visit)?;
        }
    }
    Ok(())
}

fn walk_files(
    root: &Path,
    directory: &Path,
    visit: &mut dyn FnMut(&Path) -> Result<(), StateError>,
) -> Result<(), StateError> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_symlink() || should_ignore(root, &path) {
            continue;
        }
        if file_type.is_dir() {
            walk_files(root, &path, visit)?;
        } else if file_type.is_file() {
            visit(&path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queues_files_under_each_artifact_but_ignores_loose_root_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("artifacts");
        fs::create_dir(&root).unwrap();
        let database = temp.path().join("state.sqlite3");
        let state = SyncState::open(&database).unwrap();
        fs::write(root.join("config.json"), r#"{"team":"w3dev"}"#).unwrap();
        fs::write(root.join("loose.txt"), "ignored").unwrap();
        let artifact = root.join("abc");
        fs::create_dir_all(artifact.join("nested")).unwrap();
        fs::write(artifact.join("report.txt"), "one").unwrap();
        fs::write(artifact.join("nested/summary.md"), "nested").unwrap();
        fs::create_dir_all(root.join("notes")).unwrap();
        fs::write(root.join("notes/README.md"), "another artifact").unwrap();
        fs::create_dir(root.join("empty")).unwrap();
        state.reconcile(&root).unwrap();
        let pending = state.pending_due(i64::MAX, 10).unwrap();
        assert_eq!(pending.len(), 3);
        assert_eq!(state.pending_count().unwrap(), 3);
        assert_eq!(
            pending[0].relative_path,
            PathBuf::from("abc/nested/summary.md")
        );
        assert_eq!(pending[1].relative_path, PathBuf::from("abc/report.txt"));
        assert_eq!(pending[2].relative_path, PathBuf::from("notes/README.md"));
        state.mark_uploaded(&pending[0]).unwrap();
        state.reconcile(&root).unwrap();
        assert_eq!(state.pending_due(i64::MAX, 10).unwrap().len(), 2);
        fs::write(artifact.join("report.txt"), "two").unwrap();
        state.reconcile(&root).unwrap();
        assert_eq!(state.pending_due(i64::MAX, 10).unwrap().len(), 2);
    }

    #[test]
    fn reconciliation_drops_legacy_pending_root_files_and_ignores_invalid_slugs() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("artifacts");
        fs::create_dir_all(root.join("UpperCase")).unwrap();
        fs::write(root.join("UpperCase/secret.txt"), "ignored").unwrap();
        fs::write(root.join("loose.txt"), "ignored").unwrap();
        let database = temp.path().join("state.sqlite3");
        let state = SyncState::open(&database).unwrap();
        state
            .connection
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO pending(path, content_hash, attempts, next_attempt_at) VALUES ('loose.txt', 'old', 0, 0)",
                [],
            )
            .unwrap();

        state.reconcile(&root).unwrap();

        assert!(state.pending_due(i64::MAX, 10).unwrap().is_empty());
        assert!(!is_valid_artifact_slug("UpperCase"));
        assert!(!is_valid_artifact_slug("with_underbar"));
        assert!(!is_valid_artifact_slug("-starts-wrong"));
        assert!(is_valid_artifact_slug("abc-123"));
    }

    #[test]
    fn splits_artifact_slug_from_nested_file_path() {
        assert_eq!(
            split_artifact_relative_path("abc/reports/today.json"),
            Some(ArtifactFilePath {
                slug: "abc".into(),
                path: "reports/today.json".into(),
            })
        );
        assert!(split_artifact_relative_path("loose.txt").is_none());
        assert!(split_artifact_relative_path("abc/../secret").is_none());
    }

    #[test]
    fn rejects_parent_traversal_and_outside_paths() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("artifacts");
        fs::create_dir(&root).unwrap();
        assert!(normalized_relative_path(&root, &root.join("../secret")).is_err());
        assert!(normalized_relative_path(&root, &temp.path().join("outside")).is_err());
    }

    #[test]
    fn read_only_pending_count_handles_missing_and_existing_databases() {
        let temp = tempfile::tempdir().unwrap();
        let database = temp.path().join("state.sqlite3");
        assert_eq!(pending_count_from_path(&database).unwrap(), 0);

        let state = SyncState::open(&database).unwrap();
        fs::set_permissions(&database, fs::Permissions::from_mode(0o600)).unwrap();
        state
            .connection
            .lock()
            .unwrap()
            .execute_batch("PRAGMA journal_mode=WAL;")
            .unwrap();
        state
            .connection
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO pending(path, content_hash, attempts, next_attempt_at) VALUES ('report.txt', 'hash', 0, 0)",
                [],
            )
            .unwrap();
        assert_eq!(pending_count_from_path(&database).unwrap(), 1);
    }
}
