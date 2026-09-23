use artifact_sync::auth::commands::{self, CommandError};
use artifact_sync::config::{resolve_auth_config_path, resolve_publishing_config_path};
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(
    name = "artifact-sync",
    version,
    about = "Publish local artifacts to a team-scoped artifact server"
)]
struct Cli {
    #[arg(
        long,
        global = true,
        env = "ARTIFACT_SYNC_AUTH_CONFIG",
        help = "Authentication config path (separate from publishing --config)"
    )]
    auth_config: Option<PathBuf>,
    #[arg(long, global = true, help = "Publishing config path")]
    config: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Login {
        #[arg(long, required = true)]
        server: String,
        #[arg(long)]
        token_stdin: bool,
    },
    Whoami,
    Logout,
    Daemon,
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
    let publishing_path = resolve_publishing_config_path(cli.config)?;
    match cli.command {
        Command::Login {
            server,
            token_stdin,
        } => commands::login(&server, token_stdin, auth_path, publishing_path).await,
        Command::Whoami => commands::whoami(auth_path, publishing_path).await,
        Command::Logout => commands::logout(auth_path, publishing_path).await,
        Command::Daemon => artifact_sync::daemon::run(auth_path, publishing_path)
            .await
            .map_err(|error| CommandError::Message(error.to_string())),
    }
}
