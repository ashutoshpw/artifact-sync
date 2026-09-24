use super::credentials::{DeviceAuthorization, PublisherIdentity, SecretString, TokenExchange};
use reqwest::{Client, StatusCode, redirect::Policy};
use serde::Serialize;
use thiserror::Error;
use url::Url;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum AuthClientError {
    #[error("team credential was rejected (401)")]
    InvalidCredential,
    #[error("authenticated user lacks permission or team access (403)")]
    Forbidden,
    #[error("device authorization expired before approval")]
    DeviceExpired,
    #[error("authentication server redirected the request; credentials were not forwarded")]
    Redirect,
    #[error("authentication server is unreachable; retry when connectivity returns")]
    Unavailable,
    #[error("authentication server returned an unexpected response")]
    UnexpectedResponse,
    #[error("authentication server returned malformed identity data")]
    MalformedResponse,
    #[error("device verification URL did not match the selected server origin")]
    UnsafeDeviceUrl,
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
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|_| AuthClientError::Unavailable)?;
        Ok(Self { origin, http })
    }

    pub fn origin(&self) -> &str {
        &self.origin
    }

    pub async fn whoami(
        &self,
        access_token: &SecretString,
    ) -> Result<PublisherIdentity, AuthClientError> {
        let response = self
            .http
            .get(format!("{}/__api/v1/auth/me", self.origin))
            .bearer_auth(access_token.expose())
            .send()
            .await
            .map_err(|_| AuthClientError::Unavailable)?;
        check_status(&response, &[StatusCode::OK])?;
        response
            .json()
            .await
            .map_err(|_| AuthClientError::MalformedResponse)
    }

    pub async fn refresh(
        &self,
        refresh_token: &SecretString,
        rotate: bool,
    ) -> Result<TokenExchange, AuthClientError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct RefreshRequest<'a> {
            refresh_token: &'a str,
            rotate: bool,
        }

        let response = self
            .http
            .post(format!("{}/__api/v1/auth/refresh", self.origin))
            .json(&RefreshRequest {
                refresh_token: refresh_token.expose(),
                rotate,
            })
            .send()
            .await
            .map_err(|_| AuthClientError::Unavailable)?;
        check_status(&response, &[StatusCode::OK])?;
        response
            .json()
            .await
            .map_err(|_| AuthClientError::MalformedResponse)
    }

    pub async fn start_device(
        &self,
        device_name: &str,
    ) -> Result<DeviceAuthorization, AuthClientError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct DeviceStartRequest<'a> {
            device_name: &'a str,
            platform: &'static str,
            client_version: &'static str,
        }

        let response = self
            .http
            .post(format!("{}/__api/v1/device/start", self.origin))
            .json(&DeviceStartRequest {
                device_name,
                platform: std::env::consts::OS,
                client_version: env!("CARGO_PKG_VERSION"),
            })
            .send()
            .await
            .map_err(|_| AuthClientError::Unavailable)?;
        check_status(&response, &[StatusCode::CREATED])?;
        let authorization: DeviceAuthorization = response
            .json()
            .await
            .map_err(|_| AuthClientError::MalformedResponse)?;
        validate_device_verification_url(&self.origin, &authorization.verification_url)?;
        Ok(authorization)
    }

    pub async fn poll_device(
        &self,
        device_code: &SecretString,
    ) -> Result<Option<TokenExchange>, AuthClientError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct PollRequest<'a> {
            device_code: &'a str,
        }

        let response = self
            .http
            .post(format!("{}/__api/v1/device/poll", self.origin))
            .json(&PollRequest {
                device_code: device_code.expose(),
            })
            .send()
            .await
            .map_err(|_| AuthClientError::Unavailable)?;
        if response.status() == StatusCode::ACCEPTED {
            return Ok(None);
        }
        check_status(&response, &[StatusCode::OK])?;
        response
            .json()
            .await
            .map(Some)
            .map_err(|_| AuthClientError::MalformedResponse)
    }

    pub async fn upload(
        &self,
        access_token: &SecretString,
        artifact_slug: &str,
        relative_path: &str,
        body: Vec<u8>,
    ) -> Result<(), AuthClientError> {
        let response = self
            .http
            .put(format!("{}/__api/v1/uploads", self.origin))
            .bearer_auth(access_token.expose())
            .query(&[("artifact", artifact_slug), ("path", relative_path)])
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(body)
            .send()
            .await
            .map_err(|_| AuthClientError::Unavailable)?;
        check_status(&response, &[StatusCode::CREATED])
    }
}

fn check_status(
    response: &reqwest::Response,
    accepted: &[StatusCode],
) -> Result<(), AuthClientError> {
    let status = response.status();
    if status.is_redirection() {
        return Err(AuthClientError::Redirect);
    }
    if accepted.contains(&status) {
        return Ok(());
    }
    match status {
        StatusCode::UNAUTHORIZED => Err(AuthClientError::InvalidCredential),
        StatusCode::FORBIDDEN => Err(AuthClientError::Forbidden),
        StatusCode::GONE => Err(AuthClientError::DeviceExpired),
        _ => Err(AuthClientError::UnexpectedResponse),
    }
}

pub fn validate_device_verification_url(origin: &str, value: &str) -> Result<(), AuthClientError> {
    let parsed = Url::parse(value).map_err(|_| AuthClientError::UnsafeDeviceUrl)?;
    let normalized_origin =
        normalize_server_origin(origin).map_err(|_| AuthClientError::UnsafeDeviceUrl)?;
    let result_origin = parsed.origin().ascii_serialization();
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != "/auth/device"
        || result_origin != normalized_origin
    {
        return Err(AuthClientError::UnsafeDeviceUrl);
    }
    Ok(())
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

    #[test]
    fn rejects_cross_origin_and_non_device_verification_redirects() {
        assert!(
            validate_device_verification_url(
                "https://artifact.w3dev.app",
                "https://attacker.example/auth/device?code=AAAA2222"
            )
            .is_err()
        );
        assert!(
            validate_device_verification_url(
                "https://artifact.w3dev.app",
                "https://artifact.w3dev.app/redirect?to=https://attacker.example"
            )
            .is_err()
        );
        assert!(
            validate_device_verification_url(
                "https://artifact.w3dev.app",
                "https://artifact.w3dev.app/auth/device?code=AAAA2222"
            )
            .is_ok()
        );
    }

    #[tokio::test]
    async fn upload_sends_artifact_slug_and_in_artifact_path_separately() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            let length = stream.read(&mut request).await.unwrap();
            stream
                .write_all(
                    b"HTTP/1.1 201 Created\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
            String::from_utf8_lossy(&request[..length]).to_string()
        });

        let client = AuthClient::new(format!("http://{address}")).unwrap();
        client
            .upload(
                &SecretString::new("test-token"),
                "reports",
                "nested/today.json",
                b"{}".to_vec(),
            )
            .await
            .unwrap();

        let request = server.await.unwrap();
        assert!(
            request.starts_with("PUT /__api/v1/uploads?artifact=reports&path=nested%2Ftoday.json ")
        );
    }
}
