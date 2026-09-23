use super::credentials::{PublisherIdentity, SecretString, TemporaryUploadCredentials};
use reqwest::{Client, StatusCode, redirect::Policy};
use serde::Serialize;
use thiserror::Error;
use url::Url;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum AuthClientError {
    #[error("publisher credential was rejected (401)")]
    InvalidCredential,
    #[error("publisher is authenticated but lacks permission or team access (403)")]
    Forbidden,
    #[error("authentication server redirected the request; credentials were not forwarded")]
    Redirect,
    #[error("authentication server is unreachable; retry when connectivity returns")]
    Unavailable,
    #[error("authentication server returned an unexpected response")]
    UnexpectedResponse,
    #[error("authentication server returned malformed identity data")]
    MalformedResponse,
}

#[derive(Clone)]
pub struct AuthClient {
    origin: String,
    http: Client,
}

impl AuthClient {
    pub fn new(origin: String) -> Result<Self, AuthClientError> {
        let http = Client::builder()
            .redirect(Policy::none())
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|_| AuthClientError::Unavailable)?;
        Ok(Self { origin, http })
    }

    pub fn origin(&self) -> &str {
        &self.origin
    }

    pub async fn whoami(&self, token: &SecretString) -> Result<PublisherIdentity, AuthClientError> {
        let response = self
            .http
            .get(format!("{}/__api/v1/auth/me", self.origin))
            .bearer_auth(token.expose())
            .send()
            .await
            .map_err(|_| AuthClientError::Unavailable)?;
        check_status(&response)?;
        response
            .json()
            .await
            .map_err(|_| AuthClientError::MalformedResponse)
    }

    pub async fn temporary_credentials(
        &self,
        token: &SecretString,
        team: &str,
    ) -> Result<TemporaryUploadCredentials, AuthClientError> {
        #[derive(Serialize)]
        struct Request<'a> {
            team: &'a str,
        }

        let response = self
            .http
            .post(format!("{}/__api/v1/uploads/credentials", self.origin))
            .bearer_auth(token.expose())
            .json(&Request { team })
            .send()
            .await
            .map_err(|_| AuthClientError::Unavailable)?;
        check_status(&response)?;
        response
            .json()
            .await
            .map_err(|_| AuthClientError::MalformedResponse)
    }
}

fn check_status(response: &reqwest::Response) -> Result<(), AuthClientError> {
    let status = response.status();
    if status.is_redirection() {
        return Err(AuthClientError::Redirect);
    }
    match status {
        StatusCode::OK => Ok(()),
        StatusCode::UNAUTHORIZED => Err(AuthClientError::InvalidCredential),
        StatusCode::FORBIDDEN => Err(AuthClientError::Forbidden),
        _ => Err(AuthClientError::UnexpectedResponse),
    }
}

pub fn normalize_server_origin(value: &str) -> Result<String, String> {
    let parsed =
        Url::parse(value).map_err(|_| "server must be a valid HTTPS origin".to_string())?;
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(
            "server URL must contain only an origin, without user info, query, or fragment".into(),
        );
    }
    if parsed.path() != "/" && !parsed.path().is_empty() {
        return Err("server URL must be an origin without a path".into());
    }
    match parsed.scheme() {
        "https" => {}
        "http" if local_http_is_explicitly_enabled() && is_loopback(&parsed) => {}
        "http" => {
            return Err(
                "HTTP is allowed only for loopback when ARTIFACT_SYNC_ALLOW_INSECURE_HTTP=1".into(),
            );
        }
        _ => return Err("server must use HTTPS".into()),
    }
    Ok(parsed.origin().ascii_serialization())
}

fn local_http_is_explicitly_enabled() -> bool {
    std::env::var("ARTIFACT_SYNC_ALLOW_INSECURE_HTTP").is_ok_and(|value| value == "1")
}

fn is_loopback(url: &Url) -> bool {
    if let Some(host) = url.host_str() {
        if host.eq_ignore_ascii_case("localhost") || host.eq_ignore_ascii_case("localhost.") {
            return true;
        }
        if let Ok(address) = host.parse::<std::net::IpAddr>() {
            return address.is_loopback();
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn normalizes_https_origins_and_rejects_paths() {
        assert_eq!(
            normalize_server_origin("https://Artifacts.Example.com/").unwrap(),
            "https://artifacts.example.com"
        );
        assert!(normalize_server_origin("https://artifacts.example.com/v1").is_err());
        assert!(normalize_server_origin("http://example.com").is_err());
    }

    #[test]
    fn permits_http_only_for_explicit_loopback_development() {
        let _guard = env_lock().lock().unwrap();
        unsafe {
            std::env::remove_var("ARTIFACT_SYNC_ALLOW_INSECURE_HTTP");
        }
        assert!(normalize_server_origin("http://127.0.0.1:8787").is_err());
        unsafe {
            std::env::set_var("ARTIFACT_SYNC_ALLOW_INSECURE_HTTP", "1");
        }
        assert_eq!(
            normalize_server_origin("http://127.0.0.1:8787").unwrap(),
            "http://127.0.0.1:8787"
        );
        assert!(normalize_server_origin("http://example.com").is_err());
        unsafe {
            std::env::remove_var("ARTIFACT_SYNC_ALLOW_INSECURE_HTTP");
        }
    }
}
