use std::path::{Component, Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("home directory is unavailable")]
    HomeUnavailable,
    #[error("configuration path could not be resolved: {0}")]
    Path(#[from] std::io::Error),
}

pub fn home_dir() -> Result<PathBuf, ConfigError> {
    dirs::home_dir().ok_or(ConfigError::HomeUnavailable)
}

pub fn default_auth_config_path() -> Result<PathBuf, ConfigError> {
    Ok(home_dir()?.join(".config/artifact-sync/config.json"))
}

pub fn default_artifact_root() -> Result<PathBuf, ConfigError> {
    Ok(home_dir()?.join(".agents/artifacts"))
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

pub fn path_is_inside(path: &Path, root: &Path) -> Result<bool, std::io::Error> {
    let path = canonicalize_missing_tail(path)?;
    let root = canonicalize_missing_tail(root)?;
    Ok(path == root || path.starts_with(root))
}

pub(crate) fn canonicalize_missing_tail(path: &Path) -> Result<PathBuf, std::io::Error> {
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
    fn default_paths_stay_separate_and_outside_each_other() {
        let auth = default_auth_config_path().unwrap();
        let root = default_artifact_root().unwrap();
        assert!(auth.ends_with(".config/artifact-sync/config.json"));
        assert!(root.ends_with(".agents/artifacts"));
        assert!(!auth.starts_with(&root));
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
