use super::credentials::{AuthFile, SavedAuth, is_access_token, is_refresh_credential};
use crate::windows::{self, PrivateDirectory};
use serde_json::{Map, Value};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use thiserror::Error;
use zeroize::Zeroizing;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("authentication configuration is unsafe: {0}")]
    Unsafe(String),
    #[error("authentication configuration is malformed: {0}")]
    Malformed(String),
    #[error("authentication configuration I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("authentication configuration serialization failed: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Clone)]
pub struct CredentialStore {
    path: PathBuf,
}

impl CredentialStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<Option<AuthFile>, StoreError> {
        let _parent = self.open_parent()?;
        let Some(value) = self.read_value()? else {
            return Ok(None);
        };
        let config: AuthFile = serde_json::from_value(value)
            .map_err(|error| StoreError::Malformed(error.to_string()))?;
        if config.version != 1 {
            return Err(StoreError::Malformed("unsupported version".into()));
        }
        if let Some(auth) = &config.auth {
            validate_auth(auth)?;
        }
        Ok(Some(config))
    }

    pub fn save_login(&self, server_origin: &str, auth: &SavedAuth) -> Result<(), StoreError> {
        validate_auth(auth)?;
        self.with_lock(|| {
            let mut root = self.read_value()?.unwrap_or_else(|| {
                let mut map = Map::new();
                map.insert("version".into(), Value::from(1));
                Value::Object(map)
            });
            let map = root.as_object_mut().ok_or_else(|| {
                StoreError::Malformed("configuration root must be an object".into())
            })?;
            map.insert("version".into(), Value::from(1));
            map.insert("serverUrl".into(), Value::from(server_origin));
            map.insert("auth".into(), serde_json::to_value(auth)?);
            self.write_value(&root)
        })
    }

    pub fn logout(&self) -> Result<bool, StoreError> {
        self.with_lock(|| {
            let Some(mut root) = self.read_value()? else {
                return Ok(false);
            };
            let map = root.as_object_mut().ok_or_else(|| {
                StoreError::Malformed("configuration root must be an object".into())
            })?;
            let removed = map.remove("auth").is_some();
            if removed {
                self.write_value(&root)?;
            }
            Ok(removed)
        })
    }

    fn open_parent(&self) -> Result<PrivateDirectory, StoreError> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| StoreError::Unsafe("configuration path has no parent".into()))?;
        open_private_directory(parent)
    }

    fn with_lock<T>(
        &self,
        update: impl FnOnce() -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let _parent = self.open_parent()?;
        let mut name = self.path.as_os_str().to_os_string();
        name.push(".lock");
        let lock = windows::open_private_file(Path::new(&name), true, false)?;
        windows::lock(&lock)?;
        update()
    }

    fn read_value(&self) -> Result<Option<Value>, StoreError> {
        let mut file = match windows::open_private_file(&self.path, false, false) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let mut bytes = Zeroizing::new(Vec::new());
        file.read_to_end(&mut bytes)?;
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| StoreError::Malformed(error.to_string()))
    }

    fn write_value(&self, value: &Value) -> Result<(), StoreError> {
        let parent = self.open_parent()?;
        match windows::open_private_file(&self.path, false, false) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let temporary = parent.path.join(format!(
            ".artifact-sync-{}-{}.tmp",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let mut bytes = Zeroizing::new(serde_json::to_vec_pretty(value)?);
        bytes.push(b'\n');
        let result = (|| {
            let mut file = windows::open_private_file(&temporary, true, true)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            windows::replace(&temporary, &self.path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result.map_err(StoreError::from)
    }
}

fn validate_auth(auth: &SavedAuth) -> Result<(), StoreError> {
    if auth.auth_type != "team_token"
        || !is_access_token(auth.access_token.expose())
        || !is_refresh_credential(auth.refresh_token.expose())
    {
        return Err(StoreError::Malformed(
            "access or refresh credential has an invalid format".into(),
        ));
    }
    Ok(())
}

pub(crate) fn open_private_directory(path: &Path) -> Result<PrivateDirectory, StoreError> {
    windows::open_private_directory(path).map_err(StoreError::from)
}
