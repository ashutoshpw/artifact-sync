use super::{ManagerStatus, SERVICE_MARKER, ServiceError, ServiceSettings};
use std::path::PathBuf;
use std::process::{Command, Output};

const LABEL: &str = "com.artifact-sync.daemon";

fn domain() -> Result<String, ServiceError> {
    Ok(format!("gui/{}", unsafe { libc::geteuid() }))
}

fn service_target() -> Result<String, ServiceError> {
    Ok(format!("{}/{}", domain()?, LABEL))
}

pub(super) fn definition_path() -> Result<PathBuf, ServiceError> {
    let home = dirs::home_dir()
        .ok_or_else(|| ServiceError::Message("home directory unavailable".into()))?;
    Ok(std::fs::canonicalize(home)?
        .join("Library/LaunchAgents")
        .join(format!("{LABEL}.plist")))
}

pub(super) fn render_definition(settings: &ServiceSettings) -> Result<String, ServiceError> {
    let log_dir = dirs::home_dir()
        .ok_or_else(|| ServiceError::Message("home directory unavailable".into()))?
        .join("Library/Logs");
    let arguments = [
        settings.executable.as_os_str(),
        std::ffi::OsStr::new("--auth-config"),
        settings.auth_config.as_os_str(),
        std::ffi::OsStr::new("daemon"),
        std::ffi::OsStr::new("--auth-file-only"),
    ];
    let mut args = String::new();
    for argument in arguments {
        let argument = argument.to_str().ok_or_else(|| {
            ServiceError::Message("launchd service paths must be valid UTF-8".into())
        })?;
        if argument.chars().any(|character| character.is_control()) {
            return Err(ServiceError::Message(
                "launchd service paths must not contain control characters".into(),
            ));
        }
        args.push_str("    <string>");
        args.push_str(&xml_escape(argument));
        args.push_str("</string>\n");
    }
    let stdout = log_dir.join("artifact-sync.log");
    let stderr = log_dir.join("artifact-sync.error.log");
    Ok(format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\"><dict>\n\
           <key>Label</key><string>{LABEL}</string>\n\
           <key>ProgramArguments</key><array>\n{args}  </array>\n\
           <key>RunAtLoad</key><true/>\n\
           <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n\
           <key>ThrottleInterval</key><integer>300</integer>\n\
           <key>Umask</key><integer>63</integer>\n\
           <key>StandardOutPath</key><string>{}</string>\n\
           <key>StandardErrorPath</key><string>{}</string>\n\
           <key>Comment</key><string>{}</string>\n\
         </dict></plist>\n",
        xml_escape(&stdout.to_string_lossy()),
        xml_escape(&stderr.to_string_lossy()),
        xml_escape(SERVICE_MARKER),
    ))
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub(super) fn status() -> Result<ManagerStatus, ServiceError> {
    let output = run(&["print", &service_target()?])?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
        if error.contains("could not find service")
            || error.contains("service not found")
            || error.contains("no such process")
        {
            let disabled = is_disabled()?;
            return Ok(ManagerStatus {
                state: "not loaded".into(),
                loaded: false,
                active: false,
                enabled: !disabled,
                process_id: None,
                detail: None,
            });
        }
        return Err(command_error("launchctl print", &output));
    }
    let output_text = String::from_utf8_lossy(&output.stdout);
    let state = field_value(&output_text, "state =").unwrap_or("loaded");
    let process_id = field_value(&output_text, "pid =").and_then(|value| value.parse().ok());
    let disabled = is_disabled()?;
    Ok(ManagerStatus {
        state: state.to_string(),
        loaded: true,
        active: state == "running" && process_id.is_some(),
        enabled: !disabled,
        process_id,
        detail: None,
    })
}

pub(super) fn install() -> Result<(), ServiceError> {
    let domain = domain()?;
    let definition = definition_path()?;
    let definition = definition.to_str().ok_or_else(|| {
        ServiceError::Message("launchd definition path must be valid UTF-8".into())
    })?;
    let target = format!("{domain}/{LABEL}");
    let home = dirs::home_dir()
        .ok_or_else(|| ServiceError::Message("home directory unavailable".into()))?;
    let log_dir = std::fs::canonicalize(home)?.join("Library/Logs");
    super::ensure_service_directory(&log_dir)?;
    checked(&["enable", &target])?;
    checked(&["bootstrap", &domain, definition])?;
    Ok(())
}

pub(super) fn start() -> Result<(), ServiceError> {
    let target = service_target()?;
    checked(&["enable", &target])?;
    let status = status()?;
    if !status.loaded {
        install()?;
    } else if !status.active {
        checked(&["kickstart", &target])?;
    }
    Ok(())
}

pub(super) fn stop() -> Result<(), ServiceError> {
    let target = service_target()?;
    checked(&["disable", &target])?;
    if status()?.loaded {
        checked(&["bootout", &target])?;
    }
    Ok(())
}

pub(super) fn uninstall() -> Result<(), ServiceError> {
    stop()
}

pub(super) fn reload() -> Result<(), ServiceError> {
    // launchd reads the plist at bootstrap time; there is no global reload command.
    Ok(())
}

fn is_disabled() -> Result<bool, ServiceError> {
    let output = run(&["print-disabled", &domain()?])?;
    if !output.status.success() {
        return Err(command_error("launchctl print-disabled", &output));
    }
    let output = String::from_utf8_lossy(&output.stdout);
    Ok(label_is_disabled(&output, LABEL))
}

fn label_is_disabled(output: &str, label: &str) -> bool {
    output.lines().any(|line| {
        let Some((candidate, state)) = line.trim().split_once("=>") else {
            return false;
        };
        candidate.trim().trim_matches('"') == label
            && matches!(state.trim().trim_end_matches(','), "disabled" | "true")
    })
}

fn field_value<'a>(output: &'a str, field: &str) -> Option<&'a str> {
    output
        .lines()
        .find_map(|line| line.trim().strip_prefix(field).map(|value| value.trim()))
}

fn checked(args: &[&str]) -> Result<(), ServiceError> {
    let output = run(args)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error("launchctl", &output))
    }
}

fn run(args: &[&str]) -> Result<Output, ServiceError> {
    Command::new("launchctl")
        .args(args)
        .output()
        .map_err(|error| ServiceError::Message(format!("could not run launchctl: {error}")))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plist_escapes_argument_values_and_contains_only_file_credentials() {
        let settings = ServiceSettings {
            executable: PathBuf::from("/Users/alice/Applications/Artifact & Sync"),
            auth_config: PathBuf::from("/Users/alice/.config/artifact-sync/config.json"),
        };
        let rendered = render_definition(&settings).unwrap();
        assert!(rendered.contains("Artifact &amp; Sync"));
        assert!(rendered.contains("--auth-file-only"));
        assert!(!rendered.contains("--config"));
        assert!(rendered.contains(SERVICE_MARKER));
        assert!(!rendered.contains("ARTIFACTS_PUBLISH_TOKEN"));
        assert!(!rendered.contains("as_api_"));
    }

    #[test]
    fn launchctl_disabled_state_parser_distinguishes_enabled_jobs() {
        let output = format!(
            "disabled services = {{\n\t\"{LABEL}\" => disabled\n\t\"com.other.job\" => enabled\n}}\n"
        );
        assert!(label_is_disabled(&output, LABEL));
        assert!(!label_is_disabled(&output, "com.other.job"));
        assert!(!label_is_disabled("disabled services = {}", LABEL));
    }
}
