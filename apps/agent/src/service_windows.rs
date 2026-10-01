use clap::Subcommand;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Subcommand)]
pub enum ServiceCommand {
    Install {
        #[arg(long)]
        yes: bool,
    },
    Status,
    Start {
        #[arg(long)]
        yes: bool,
    },
    Stop,
    Uninstall,
}

#[derive(Debug, Error)]
#[error(
    "Windows automatic user-service installation is not supported; run `artifact-sync daemon` in a terminal, `artifact-sync daemon --status` to inspect it, and `artifact-sync daemon --stop` to shut it down"
)]
pub struct ServiceError;

pub async fn run(_: ServiceCommand, _: PathBuf, _: PathBuf) -> Result<(), ServiceError> {
    Err(ServiceError)
}
