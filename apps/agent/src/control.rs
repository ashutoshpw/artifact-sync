use std::io;

#[cfg(unix)]
pub(crate) use tokio::net::UnixStream as Stream;
#[cfg(unix)]
pub(crate) use tokio::net::UnixStream as ClientStream;
#[cfg(unix)]
pub(crate) struct Listener(tokio::net::UnixListener);
#[cfg(unix)]
pub(crate) type Guard = crate::daemon::SocketGuard;

#[cfg(unix)]
impl Listener {
    pub(crate) async fn accept(&mut self) -> io::Result<Stream> {
        self.0.accept().await.map(|(stream, _)| stream)
    }
}

#[cfg(unix)]
pub(crate) async fn bind() -> Result<(Listener, Guard), crate::daemon::DaemonError> {
    let (listener, guard) = crate::daemon::bind_control_socket().await?;
    Ok((Listener(listener), guard))
}

#[cfg(unix)]
pub(crate) async fn connect() -> io::Result<ClientStream> {
    if !crate::daemon::daemon_is_running().await? {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "daemon is not running",
        ));
    }
    Stream::connect(crate::daemon::daemon_socket_path()?).await
}

#[cfg(windows)]
pub(crate) use windows::{Stream, bind, connect};

#[cfg(windows)]
mod windows {
    use crate::windows::{PrivateSecurity, validate_private_handle};
    use sha2::{Digest, Sha256};
    use std::io;
    use std::time::Duration;
    use tokio::net::windows::named_pipe::{
        ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions,
    };

    pub(crate) type Stream = NamedPipeServer;
    pub(crate) type ClientStream = NamedPipeClient;
    pub(crate) struct Guard;
    pub(crate) struct Listener {
        server: NamedPipeServer,
        name: String,
    }

    fn pipe_name() -> io::Result<String> {
        let home = crate::config::home_dir().map_err(io::Error::other)?;
        let identity = format!("{}:{}", crate::windows::user_sid()?, home.display());
        Ok(format!(
            r"\\.\pipe\artifact-sync-{}",
            hex::encode(Sha256::digest(identity.as_bytes()))
        ))
    }

    fn server(name: &str, first: bool) -> io::Result<NamedPipeServer> {
        let security = PrivateSecurity::new()?;
        let mut attributes = security.attributes();
        unsafe {
            ServerOptions::new()
                .first_pipe_instance(first)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(
                    name,
                    std::ptr::addr_of_mut!(attributes).cast(),
                )
        }
    }

    pub(crate) async fn bind() -> Result<(Listener, Guard), crate::daemon::DaemonError> {
        let name = pipe_name()?;
        let server = server(&name, true).map_err(|error| {
            if error.kind() == io::ErrorKind::PermissionDenied {
                crate::daemon::DaemonError::Message(
                    "daemon control pipe is already in use; another daemon may be running".into(),
                )
            } else {
                error.into()
            }
        })?;
        Ok((Listener { server, name }, Guard))
    }

    impl Listener {
        pub(crate) async fn accept(&mut self) -> io::Result<Stream> {
            self.server.connect().await?;
            let next = server(&self.name, false)?;
            Ok(std::mem::replace(&mut self.server, next))
        }
    }

    pub(crate) async fn connect() -> io::Result<ClientStream> {
        let name = pipe_name()?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        loop {
            match ClientOptions::new().open(&name) {
                Ok(stream) => {
                    validate_private_handle(&stream)?;
                    return Ok(stream);
                }
                Err(error)
                    if error.raw_os_error() == Some(231)
                        && tokio::time::Instant::now() < deadline =>
                {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                Err(error) => return Err(error),
            }
        }
    }
}

pub(crate) async fn shutdown_signal() -> io::Result<()> {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! { result = tokio::signal::ctrl_c() => result, _ = terminate.recv() => Ok(()) }
    }
    #[cfg(windows)]
    {
        let mut close = tokio::signal::windows::ctrl_close()?;
        let mut shutdown = tokio::signal::windows::ctrl_shutdown()?;
        let mut interrupt = tokio::signal::windows::ctrl_break()?;
        tokio::select! {
            result = tokio::signal::ctrl_c() => result,
            _ = close.recv() => Ok(()),
            _ = shutdown.recv() => Ok(()),
            _ = interrupt.recv() => Ok(()),
        }
    }
}
