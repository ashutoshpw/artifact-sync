use super::{ManagerStatus, SERVICE_MARKER, ServiceError, ServiceSettings};
use std::path::PathBuf;
use std::process::{Command, Output};

const UNIT_NAME: &str = "artifact-sync.service";

pub(super) fn definition_path() -> Result<PathBuf, ServiceError> {
    let home = dirs::home_dir()
        .ok_or_else(|| ServiceError::Message("home directory unavailable".into()))?;
    Ok(std::fs::canonicalize(home)?
        .join(".config/systemd/user")
        .join(UNIT_NAME))
}

pub(super) fn render_definition(settings: &ServiceSettings) -> Result<String, ServiceError> {
    let args = [
        settings.executable.as_os_str(),
        std::ffi::OsStr::new("--auth-config"),
        settings.auth_config.as_os_str(),
        std::ffi::OsStr::new("daemon"),
        std::ffi::OsStr::new("--auth-file-only"),
    ];
    let exec_start = args
        .iter()
        .map(|arg| systemd_quote(arg))
        .collect::<Result<Vec<_>, _>>()?
        .join(" ");

    // User services already run without CAP_SYS_MODULE. Asking an unprivileged
    // systemd user manager to drop that capability can fail with 218/CAPABILITIES.
    Ok(format!(
        "# {SERVICE_MARKER}\n\
         [Unit]\n\
         Description=Artifact Sync user daemon\n\
         After=default.target\n\
         StartLimitIntervalSec=15min\n\
         StartLimitBurst=5\n\
         \n\
         [Service]\n\
         Type=simple\n\
         ExecStart={exec_start}\n\
         Restart=on-failure\n\
         RestartSec=30s\n\
         UMask=0077\n\
         NoNewPrivileges=true\n\
         PrivateTmp=true\n\
         ProtectSystem=full\n\
         ProtectKernelTunables=true\n\
         ProtectControlGroups=true\n\
         RestrictSUIDSGID=true\n\
         StandardOutput=journal\n\
         StandardError=journal\n\
         \n\
         [Install]\n\
         WantedBy=default.target\n"
    ))
}

fn systemd_quote(value: &std::ffi::OsStr) -> Result<String, ServiceError> {
    let value = value
        .to_str()
        .ok_or_else(|| ServiceError::Message("systemd service paths must be valid UTF-8".into()))?;
    if value.chars().any(|character| character.is_control()) {
        return Err(ServiceError::Message(
            "systemd service paths must not contain control characters".into(),
        ));
    }
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('"');
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '%' => escaped.push_str("%%"),
            '$' => escaped.push_str("$$"),
            other => escaped.push(other),
        }
    }
    escaped.push('"');
    Ok(escaped)
}

pub(super) fn status() -> Result<ManagerStatus, ServiceError> {
    let output = run(&[
        "show",
        "--no-pager",
        "--property=LoadState",
        "--property=ActiveState",
        "--property=SubState",
        "--property=MainPID",
        "--property=UnitFileState",
        UNIT_NAME,
    ])?;
    if !output.status.success() {
        return Err(command_error("systemctl --user show", &output));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let properties = parse_properties(&stdout);
    let load = properties.get("LoadState").copied().unwrap_or("not-found");
    let active_state = properties.get("ActiveState").copied().unwrap_or("inactive");
    let sub_state = properties.get("SubState").copied().unwrap_or_default();
    let unit_file_state = properties.get("UnitFileState").copied().unwrap_or_default();
    let loaded = load != "not-found";
    let active = active_state == "active";
    let enabled = matches!(
        unit_file_state,
        "enabled" | "enabled-runtime" | "linked" | "linked-runtime"
    );
    let process_id = properties
        .get("MainPID")
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value != 0);
    let state = if !loaded {
        "not loaded".into()
    } else if sub_state.is_empty() {
        active_state.to_string()
    } else {
        format!("{active_state} ({sub_state})")
    };
    let detail = (!unit_file_state.is_empty()).then(|| format!("unit file: {unit_file_state}"));
    Ok(ManagerStatus {
        state,
        loaded,
        active,
        enabled,
        process_id,
        detail,
    })
}

pub(super) fn install() -> Result<(), ServiceError> {
    checked(&["daemon-reload"])?;
    checked(&["enable", "--now", UNIT_NAME])?;
    Ok(())
}

pub(super) fn start() -> Result<(), ServiceError> {
    checked(&["enable", "--now", UNIT_NAME])?;
    Ok(())
}

pub(super) fn stop() -> Result<(), ServiceError> {
    checked(&["disable", "--now", UNIT_NAME])?;
    Ok(())
}

pub(super) fn uninstall() -> Result<(), ServiceError> {
    checked(&["disable", "--now", UNIT_NAME])?;
    Ok(())
}

pub(super) fn reload() -> Result<(), ServiceError> {
    checked(&["daemon-reload"])?;
    Ok(())
}

fn checked(args: &[&str]) -> Result<(), ServiceError> {
    let output = run(args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error("systemctl --user", &output))
    }
}

fn run(args: &[&str]) -> Result<Output, ServiceError> {
    Command::new("systemctl")
        .arg("--user")
        .args(args)
        .output()
        .map_err(|error| {
            ServiceError::Message(format!(
                "could not run systemctl --user (is systemd user service management available?): {error}"
            ))
        })
}

fn command_error(context: &str, output: &Output) -> ServiceError {
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = if detail.is_empty() {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    } else {
        detail
    };
    ServiceError::Message(if detail.is_empty() {
        format!("{context} failed with {}", output.status)
    } else {
        format!("{context} failed: {detail}")
    })
}

fn parse_properties(output: &str) -> std::collections::HashMap<&str, &str> {
    output
        .lines()
        .filter_map(|line| line.split_once('='))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_systemd_paths_without_shell_or_specifier_expansion() {
        assert_eq!(
            systemd_quote(std::ffi::OsStr::new("/tmp/a b/$HOME/%name/\"quoted\"")).unwrap(),
            "\"/tmp/a b/$$HOME/%%name/\\\"quoted\\\"\""
        );
        assert_eq!(
            systemd_quote(std::ffi::OsStr::new("/tmp/back\\slash")).unwrap(),
            "\"/tmp/back\\\\slash\""
        );
        assert!(systemd_quote(std::ffi::OsStr::new("/tmp/line\nbreak")).is_err());
    }

    #[test]
    fn unit_uses_saved_file_only_and_has_no_environment_credentials() {
        let settings = ServiceSettings {
            executable: PathBuf::from("/opt/artifact-sync"),
            auth_config: PathBuf::from("/home/alice/.config/artifact-sync/config.json"),
        };
        let rendered = render_definition(&settings).unwrap();
        assert!(rendered.contains(SERVICE_MARKER));
        assert!(rendered.contains("--auth-file-only"));
        assert!(!rendered.contains("--config"));
        assert!(rendered.contains("RestartSec=30s"));
        assert!(!rendered.contains("ProtectKernelModules="));
        assert!(!rendered.contains("ARTIFACTS_PUBLISH_TOKEN"));
        assert!(!rendered.contains("ARTIFACT_SYNC_SERVER_URL"));
        assert!(!rendered.contains("as_api_"));
    }

    #[test]
    fn parses_systemd_show_properties() {
        let output = "LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=123\nUnitFileState=enabled\n";
        let properties = parse_properties(output);
        assert_eq!(properties.get("LoadState"), Some(&"loaded"));
        assert_eq!(properties.get("MainPID"), Some(&"123"));
    }

    #[test]
    fn generated_unit_passes_systemd_analyze_when_available() {
        let temp = tempfile::tempdir().unwrap();
        let settings = ServiceSettings {
            executable: std::env::current_exe().unwrap(),
            auth_config: temp.path().join("auth config.json"),
        };
        let unit = temp.path().join(UNIT_NAME);
        std::fs::write(&unit, render_definition(&settings).unwrap()).unwrap();
        let output = match Command::new("systemd-analyze")
            .arg("verify")
            .arg(&unit)
            .output()
        {
            Ok(output) => output,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => panic!("could not run systemd-analyze verify: {error}"),
        };
        assert!(
            output.status.success(),
            "systemd-analyze rejected generated unit: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
