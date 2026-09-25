use artifact_sync::auth::commands::{self, CommandError};
use artifact_sync::config::{default_artifact_root, resolve_auth_config_path};
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(
    name = "artifact-sync",
    version,
    about = "Publish local artifacts to a team-scoped artifact server",
    after_help = "Complete command reference:\n  login [--server <SERVER>] [--token-stdin]\n  whoami\n  logout\n  daemon\n  service install [--yes]\n  service status\n  service start [--yes]\n  service stop\n  service uninstall\n\nFor command-specific options and guidance, run `artifact-sync <COMMAND> --help`; for example, `artifact-sync service install --help`.\n`--yes` on service install/start confirms that existing artifacts may upload when the daemon starts."
)]
struct Cli {
    #[arg(
        long,
        global = true,
        env = "ARTIFACT_SYNC_AUTH_CONFIG",
        help = "Authentication config path (default: ~/.config/artifact-sync/config.json)"
    )]
    auth_config: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Validate and save a publisher credential for the selected server.
    Login {
        #[arg(
            long,
            default_value = "https://artifact.w3dev.app",
            help = "Server origin to validate and bind this credential to"
        )]
        server: String,
        #[arg(
            long,
            help = "Read the publisher token from stdin instead of prompting securely"
        )]
        token_stdin: bool,
    },
    /// Verify the active credential and display its publisher and team identity.
    Whoami,
    /// Remove the local saved credential; this does not revoke the server-side token.
    Logout,
    /// Run the artifact watcher in the foreground.
    Daemon {
        /// Ignore environment credentials; used by installed per-user services
        #[arg(long, hide = true)]
        auth_file_only: bool,
    },
    /// Install and manage the per-user background watcher service.
    Service {
        #[command(subcommand)]
        command: artifact_sync::service::ServiceCommand,
    },
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "warn".into()),
        )
        .with_target(false)
        .init();

    let cli = Cli::parse();
    if let Err(error) = run(cli).await {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

async fn run(cli: Cli) -> Result<(), CommandError> {
    let auth_path = resolve_auth_config_path(cli.auth_config)?;
    let artifact_root = default_artifact_root()?;
    match cli.command {
        Command::Login {
            server,
            token_stdin,
        } => commands::login(&server, token_stdin, auth_path, artifact_root).await,
        Command::Whoami => commands::whoami(auth_path, artifact_root).await,
        Command::Logout => commands::logout(auth_path, artifact_root).await,
        Command::Daemon { auth_file_only } => {
            artifact_sync::daemon::run(auth_path, artifact_root, auth_file_only)
                .await
                .map_err(|error| CommandError::Message(error.to_string()))
        }
        Command::Service { command } => {
            artifact_sync::service::run(command, auth_path, artifact_root)
                .await
                .map_err(|error| CommandError::Message(error.to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn root_help_lists_every_public_command_and_nested_service_action() {
        let mut command = Cli::command();
        let mut output = Vec::new();
        command.write_long_help(&mut output).unwrap();
        let help = String::from_utf8(output).unwrap();

        for expected in [
            "login [--server <SERVER>] [--token-stdin]",
            "whoami",
            "logout",
            "daemon",
            "service install [--yes]",
            "service status",
            "service start [--yes]",
            "service stop",
            "service uninstall",
            "~/.config/artifact-sync/config.json",
        ] {
            assert!(help.contains(expected), "root help is missing {expected:?}");
        }
        assert!(!help.contains("artifacts/config.json"));
    }

    #[test]
    fn login_help_explains_secure_token_input() {
        let mut command = Cli::command();
        let mut output = Vec::new();
        command
            .find_subcommand_mut("login")
            .unwrap()
            .write_long_help(&mut output)
            .unwrap();
        let help = String::from_utf8(output).unwrap();

        assert!(help.contains("--token-stdin"));
        assert!(help.contains("prompting securely"));
        assert!(help.contains("Server origin"));
    }

    #[test]
    fn login_defaults_to_the_hosted_server() {
        let cli = Cli::try_parse_from(["artifact-sync", "login"]).unwrap();
        match cli.command {
            Command::Login { server, .. } => {
                assert_eq!(server, "https://artifact.w3dev.app");
            }
            other => panic!("expected login command, got {other:?}"),
        }
    }
}
