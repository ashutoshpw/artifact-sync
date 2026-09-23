use super::credentials::{AuthFile, SavedAuth, is_access_token, is_refresh_credential};
use serde_json::{Map, Value};
use std::ffi::CString;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
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
        let parent = self.open_parent()?;
        let Some(value) = self.read_value_at(&parent)? else {
            return Ok(None);
        };
        let config: AuthFile = serde_json::from_value(value)
            .map_err(|error| StoreError::Malformed(error.to_string()))?;
        if config.version != 1 {
            return Err(StoreError::Malformed("unsupported version".into()));
        }
        if config
            .auth
            .as_ref()
            .is_some_and(|auth| auth.auth_type != "team_token")
        {
            return Err(StoreError::Malformed("unsupported auth type".into()));
        }
        if config.auth.as_ref().is_some_and(|auth| {
            !is_access_token(auth.access_token.expose())
                || !is_refresh_credential(auth.refresh_token.expose())
        }) {
            return Err(StoreError::Malformed(
                "access or refresh credential has an invalid format".into(),
            ));
        }
        Ok(Some(config))
    }

    pub fn save_login(&self, server_origin: &str, auth: &SavedAuth) -> Result<(), StoreError> {
        if auth.auth_type != "team_token"
            || !is_access_token(auth.access_token.expose())
            || !is_refresh_credential(auth.refresh_token.expose())
        {
            return Err(StoreError::Malformed(
                "access or refresh credential has an invalid format".into(),
            ));
        }
        self.with_lock(|parent| {
            let mut root = self.read_value_at(parent)?.unwrap_or_else(|| {
                let mut map = Map::new();
                map.insert("version".into(), Value::from(1));
                Value::Object(map)
            });
            let object = root
                .as_object_mut()
                .ok_or_else(|| StoreError::Malformed("top level must be a JSON object".into()))?;
            if object.get("version").and_then(Value::as_u64) != Some(1) {
                return Err(StoreError::Malformed("unsupported version".into()));
            }
            object.insert("serverUrl".into(), Value::String(server_origin.to_string()));
            object.insert("auth".into(), serde_json::to_value(auth)?);
            self.write_value_at(parent, &root)
        })
    }

    pub fn logout(&self) -> Result<bool, StoreError> {
        self.with_lock(|parent| {
            let Some(mut root) = self.read_value_at(parent)? else {
                return Ok(false);
            };
            let object = root
                .as_object_mut()
                .ok_or_else(|| StoreError::Malformed("top level must be a JSON object".into()))?;
            let removed = object.remove("auth").is_some();
            if removed {
                self.write_value_at(parent, &root)?;
            }
            Ok(removed)
        })
    }

    fn with_lock<T>(
        &self,
        update: impl FnOnce(&File) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let parent = self.open_parent()?;
        let mut lock_name = self.file_name()?.to_os_string();
        lock_name.push(".lock");
        let lock = openat_file(&parent, &lock_name, libc::O_CREAT | libc::O_RDWR, 0o600)?;
        validate_file_metadata(&lock.metadata()?, "authentication lock")?;
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let result = update(&parent);
        unsafe {
            libc::flock(lock.as_raw_fd(), libc::LOCK_UN);
        }
        result
    }

    fn open_parent(&self) -> Result<File, StoreError> {
        let path = self
            .path
            .parent()
            .ok_or_else(|| StoreError::Unsafe("configuration path has no parent".into()))?;
        open_private_directory(path)
    }

    fn file_name(&self) -> Result<&std::ffi::OsStr, StoreError> {
        self.path
            .file_name()
            .ok_or_else(|| StoreError::Unsafe("configuration path has no file name".into()))
    }

    fn read_value_at(&self, parent: &File) -> Result<Option<Value>, StoreError> {
        let mut file = match openat_file(parent, self.file_name()?, libc::O_RDONLY, 0) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) if error.raw_os_error() == Some(libc::ELOOP) => {
                return Err(StoreError::Unsafe(
                    "credential file must not be a symlink".into(),
                ));
            }
            Err(error) => return Err(error.into()),
        };
        validate_file_metadata(&file.metadata()?, "credential file")?;
        let mut content = Vec::new();
        file.read_to_end(&mut content)?;
        serde_json::from_slice(&content)
            .map(Some)
            .map_err(|error| StoreError::Malformed(error.to_string()))
    }

    fn write_value_at(&self, parent: &File, value: &Value) -> Result<(), StoreError> {
        let target_name = self.file_name()?;
        match openat_file(parent, target_name, libc::O_RDONLY, 0) {
            Ok(file) => validate_file_metadata(&file.metadata()?, "credential file")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) if error.raw_os_error() == Some(libc::ELOOP) => {
                return Err(StoreError::Unsafe(
                    "credential file must not be a symlink".into(),
                ));
            }
            Err(error) => return Err(error.into()),
        }

        let mut bytes = Zeroizing::new(serde_json::to_vec_pretty(value)?);
        bytes.push(b'\n');
        let temp_name = format!(
            ".artifact-sync-{}-{}.tmp",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let temp = openat_file(
            parent,
            temp_name.as_str(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
            0o600,
        )?;
        let result = (|| -> Result<(), StoreError> {
            let mut temp = temp;
            temp.write_all(&bytes)?;
            temp.sync_all()?;
            drop(temp);
            let target = c_name(target_name)?;
            let temporary = c_name(std::ffi::OsStr::new(&temp_name))?;
            let rename = unsafe {
                libc::renameat(
                    parent.as_raw_fd(),
                    temporary.as_ptr(),
                    parent.as_raw_fd(),
                    target.as_ptr(),
                )
            };
            if rename != 0 {
                return Err(std::io::Error::last_os_error().into());
            }
            parent.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            if let Ok(temp_cstr) = c_name(std::ffi::OsStr::new(&temp_name)) {
                unsafe {
                    libc::unlinkat(parent.as_raw_fd(), temp_cstr.as_ptr(), 0);
                }
            }
        }
        result
    }
}

pub(crate) fn open_private_directory(path: &Path) -> Result<File, StoreError> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC)
        .open("/")?;

    for component in absolute.components() {
        match component {
            std::path::Component::RootDir | std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                directory = open_directory_at(&directory, std::ffi::OsStr::new(".."))?;
            }
            std::path::Component::Normal(name) => {
                directory = match open_directory_at(&directory, name) {
                    Ok(next) => next,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        let name = c_name(name)?;
                        let made =
                            unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o700) };
                        if made != 0 {
                            let error = std::io::Error::last_os_error();
                            if error.kind() != std::io::ErrorKind::AlreadyExists {
                                return Err(error.into());
                            }
                        }
                        open_directory_at(&directory, std::ffi::OsStr::from_bytes(name.as_bytes()))?
                    }
                    Err(error)
                        if error.raw_os_error() == Some(libc::ELOOP)
                            || error.raw_os_error() == Some(libc::ENOTDIR) =>
                    {
                        return Err(StoreError::Unsafe(
                            "authentication configuration path contains a symlink or non-directory"
                                .into(),
                        ));
                    }
                    Err(error) => return Err(error.into()),
                };
            }
            std::path::Component::Prefix(_) => {
                return Err(StoreError::Unsafe(
                    "authentication configuration path is not a Unix path".into(),
                ));
            }
        }
    }
    let metadata = directory.metadata()?;
    validate_owner_and_mode(&metadata, "authentication configuration directory")?;
    if metadata.permissions().mode() & 0o777 != 0o700 {
        return Err(StoreError::Unsafe(format!(
            "configuration directory {} must use mode 0700 (found {:04o})",
            path.display(),
            metadata.permissions().mode() & 0o777
        )));
    }
    Ok(directory)
}

fn open_directory_at(parent: &File, name: &std::ffi::OsStr) -> Result<File, std::io::Error> {
    let name = CString::new(name.as_bytes()).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "directory name contains NUL",
        )
    })?;
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

fn c_name(name: &std::ffi::OsStr) -> Result<CString, StoreError> {
    CString::new(name.as_bytes())
        .map_err(|_| StoreError::Unsafe("configuration file name contains a NUL byte".into()))
}

fn openat_file(
    parent: &File,
    name: impl AsRef<std::ffi::OsStr>,
    flags: i32,
    mode: libc::mode_t,
) -> Result<File, std::io::Error> {
    let name = CString::new(name.as_ref().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "file name contains NUL")
    })?;
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            mode,
        )
    };
    if fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

fn validate_file_metadata(metadata: &fs::Metadata, label: &str) -> Result<(), StoreError> {
    if !metadata.is_file() {
        return Err(StoreError::Unsafe(format!("{label} is not a regular file")));
    }
    validate_owner_and_mode(metadata, label)?;
    if metadata.permissions().mode() & 0o077 != 0 {
        return Err(StoreError::Unsafe(format!(
            "{label} is group/world accessible; restrict it to mode 0600"
        )));
    }
    Ok(())
}

fn validate_owner_and_mode(metadata: &fs::Metadata, label: &str) -> Result<(), StoreError> {
    let current_uid = unsafe { libc::geteuid() };
    if metadata.uid() != current_uid {
        return Err(StoreError::Unsafe(format!(
            "{label} is not owned by the current user"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::credentials::{CachedIdentity, SecretString};
    use chrono::Utc;
    use std::os::unix::fs::{PermissionsExt, symlink};

    const VALID_ACCESS_TOKEN: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhcnRpZmFjdC1zeW5jIn0.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const VALID_REFRESH_TOKEN: &str = "as_rf_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    fn sample_auth(access_token: &str) -> SavedAuth {
        SavedAuth {
            auth_type: "team_token".into(),
            access_token: SecretString::new(access_token),
            refresh_token: SecretString::new(VALID_REFRESH_TOKEN),
            token_id: "api_test".into(),
            expires_at: Utc::now(),
            cached_identity: CachedIdentity {
                user_id: "user_test".into(),
                email: "user@example.test".into(),
                name: "Test User".into(),
                team_id: "team_test".into(),
                team: "w3dev".into(),
                permissions: vec!["artifacts:publish".into()],
            },
        }
    }

    #[test]
    fn creates_private_files_and_preserves_unrelated_settings_on_logout() {
        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().join("private");
        let path = directory.join("config.json");
        let store = CredentialStore::new(&path);
        store
            .save_login(
                "https://artifacts.example.com",
                &sample_auth(VALID_ACCESS_TOKEN),
            )
            .unwrap();
        assert_eq!(
            fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let mut raw: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        raw["custom"] = Value::String("preserved".into());
        fs::write(&path, serde_json::to_vec(&raw).unwrap()).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(store.logout().unwrap());
        let after: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(after.get("auth").is_none());
        assert_eq!(after["serverUrl"], "https://artifacts.example.com");
        assert_eq!(after["custom"], "preserved");
    }

    #[test]
    fn rejects_group_access_and_symlinked_credentials() {
        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().join("private");
        fs::create_dir(&directory).unwrap();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
        let credential = directory.join("config.json");
        fs::write(
            &credential,
            r#"{"version":1,"serverUrl":"https://a.example","auth":{}}"#,
        )
        .unwrap();
        fs::set_permissions(&credential, fs::Permissions::from_mode(0o644)).unwrap();
        let store = CredentialStore::new(&credential);
        assert!(matches!(store.load(), Err(StoreError::Unsafe(_))));

        let target = directory.join("target.json");
        fs::write(&target, "{}").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        let link = directory.join("link.json");
        symlink(&target, &link).unwrap();
        assert!(matches!(
            CredentialStore::new(link).load(),
            Err(StoreError::Unsafe(_))
        ));

        let replacement = directory.join("replacement.json");
        symlink(&target, &replacement).unwrap();
        assert!(matches!(
            CredentialStore::new(replacement).save_login(
                "https://artifacts.example.com",
                &sample_auth(VALID_ACCESS_TOKEN)
            ),
            Err(StoreError::Unsafe(_))
        ));
    }

    #[test]
    fn rejects_malformed_files_and_symlinked_parent_directories() {
        let temp = tempfile::tempdir().unwrap();
        let private = temp.path().join("private");
        fs::create_dir(&private).unwrap();
        fs::set_permissions(&private, fs::Permissions::from_mode(0o700)).unwrap();
        let credential = private.join("config.json");
        fs::write(&credential, "not-json").unwrap();
        fs::set_permissions(&credential, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(matches!(
            CredentialStore::new(&credential).load(),
            Err(StoreError::Malformed(_))
        ));

        fs::write(
            &credential,
            r#"{"version":1,"serverUrl":"https://a.example","auth":{"type":"publisher_token","token":"as_pub_short"}}"#,
        )
        .unwrap();
        fs::set_permissions(&credential, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(matches!(
            CredentialStore::new(&credential).load(),
            Err(StoreError::Malformed(_))
        ));

        assert!(matches!(
            CredentialStore::new(private.join("new.json"))
                .save_login("https://a.example", &sample_auth("invalid.access.token")),
            Err(StoreError::Malformed(_))
        ));

        let link = temp.path().join("private-link");
        symlink(&private, &link).unwrap();
        assert!(matches!(
            CredentialStore::new(link.join("config.json")).load(),
            Err(StoreError::Unsafe(_))
        ));
    }

    #[test]
    fn concurrent_login_and_logout_updates_remain_atomic() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("private/config.json");
        let workers = (0..12)
            .map(|index| {
                let path = path.clone();
                std::thread::spawn(move || {
                    let store = CredentialStore::new(path);
                    if index % 2 == 0 {
                        store
                            .save_login(
                                "https://artifacts.example.com",
                                &sample_auth(VALID_ACCESS_TOKEN),
                            )
                            .unwrap();
                    } else {
                        let _ = store.logout().unwrap();
                    }
                })
            })
            .collect::<Vec<_>>();
        for worker in workers {
            worker.join().unwrap();
        }
        let store = CredentialStore::new(&path);
        let parsed = store.load().unwrap().unwrap();
        assert_eq!(parsed.version, 1);
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(fs::read_dir(path.parent().unwrap()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));
    }

    #[test]
    fn secret_debug_is_redacted() {
        let secret = SecretString::new("as_pub_never_print_this");
        assert!(!format!("{secret:?}").contains("never_print_this"));
    }
}
