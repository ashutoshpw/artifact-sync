use serde::Deserialize;
use std::path::{Component, Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("home directory is unavailable")]
    HomeUnavailable,
    #[error("could not read publishing configuration: {0}")]
    Read(#[from] std::io::Error),
    #[error("publishing configuration is invalid: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("publishing team must use lowercase letters, digits, hyphens, or underscores")]
    InvalidTeam,
    #[error("sync.maxConcurrentUploads must be between 1 and 32")]
    InvalidConcurrency,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncConfig {
    #[serde(default = "default_debounce_ms")]
    pub debounce_ms: u64,
    #[serde(default = "default_max_concurrent_uploads")]
    pub max_concurrent_uploads: usize,
    #[serde(default)]
    pub audit_interval_seconds: u64,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            debounce_ms: default_debounce_ms(),
            max_concurrent_uploads: default_max_concurrent_uploads(),
            audit_interval_seconds: 0,
        }
    }
}

fn default_debounce_ms() -> u64 {
    750
}
fn default_max_concurrent_uploads() -> usize {
    2
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct PublishingConfig {
    pub team: String,
    #[serde(default)]
    pub sync: SyncConfig,
}

impl PublishingConfig {
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.team.is_empty()
            || self.team.len() > 63
            || !self.team.bytes().enumerate().all(|(index, byte)| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || (index > 0 && (byte == b'-' || byte == b'_'))
            })
            || !self.team.as_bytes()[0].is_ascii_lowercase()
                && !self.team.as_bytes()[0].is_ascii_digit()
        {
            return Err(ConfigError::InvalidTeam);
        }
        if !(1..=32).contains(&self.sync.max_concurrent_uploads) {
            return Err(ConfigError::InvalidConcurrency);
        }
        Ok(())
    }
}

pub fn home_dir() -> Result<PathBuf, ConfigError> {
    dirs::home_dir().ok_or(ConfigError::HomeUnavailable)
}

pub fn default_publishing_config_path() -> Result<PathBuf, ConfigError> {
    Ok(home_dir()?.join(".agents/artifacts/config.json"))
}

pub fn default_auth_config_path() -> Result<PathBuf, ConfigError> {
    Ok(home_dir()?.join(".config/artifact-sync/config.json"))
}

pub fn resolve_auth_config_path(argument: Option<PathBuf>) -> Result<PathBuf, ConfigError> {
    if let Some(path) = argument {
        return expand_home(path);
    }
    if let Some(value) = std::env::var_os("ARTIFACT_SYNC_AUTH_CONFIG") {
        return expand_home(PathBuf::from(value));
    }
    default_auth_config_path()
}

pub fn resolve_publishing_config_path(argument: Option<PathBuf>) -> Result<PathBuf, ConfigError> {
    argument
        .map(expand_home)
        .unwrap_or_else(default_publishing_config_path)
}

fn expand_home(path: PathBuf) -> Result<PathBuf, ConfigError> {
    let expanded = if path == Path::new("~") {
        home_dir()?
    } else if let Ok(stripped) = path.strip_prefix("~") {
        home_dir()?.join(stripped.strip_prefix("/").unwrap_or(stripped))
    } else {
        path
    };
    if expanded.is_absolute() {
        Ok(expanded)
    } else {
        Ok(std::env::current_dir()?.join(expanded))
    }
}

pub fn load_publishing_config(path: &Path) -> Result<PublishingConfig, ConfigError> {
    let text = std::fs::read_to_string(path)?;
    let config: PublishingConfig = serde_json::from_str(&text)?;
    config.validate()?;
    Ok(config)
}

pub fn path_is_inside(path: &Path, root: &Path) -> Result<bool, std::io::Error> {
    let path = canonicalize_missing_tail(path)?;
    let root = canonicalize_missing_tail(root)?;
    Ok(path == root || path.starts_with(root))
}

fn canonicalize_missing_tail(path: &Path) -> Result<PathBuf, std::io::Error> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut existing = absolute.as_path();
    let mut suffix = Vec::new();
    while !existing.exists() {
        let name = existing.file_name().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "path has no existing ancestor",
            )
        })?;
        suffix.push(name.to_os_string());
        existing = existing.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
        })?;
    }
    let mut canonical = std::fs::canonicalize(existing)?;
    for name in suffix.iter().rev() {
        canonical.push(name);
    }
    let mut normalized = PathBuf::new();
    for component in canonical.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_rejects_local_server_destination() {
        let parsed = serde_json::from_str::<PublishingConfig>(
            r#"{"team":"w3dev","serverUrl":"https://evil.example"}"#,
        );
        assert!(parsed.is_err());
    }

    #[test]
    fn path_check_canonicalizes_existing_parent_and_missing_file() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("artifacts");
        std::fs::create_dir(&root).unwrap();
        assert!(path_is_inside(&root.join("config.json"), &root).unwrap());
        assert!(!path_is_inside(&directory.path().join("auth.json"), &root).unwrap());
    }
}
