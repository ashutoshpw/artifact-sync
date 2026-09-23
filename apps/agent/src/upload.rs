use crate::auth::client::{AuthClient, AuthClientError};
use crate::auth::credentials::{SecretString, TemporaryUploadCredentials};
use crate::state::normalized_relative_path;
use chrono::{Duration as ChronoDuration, Utc};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::path::Path;
use thiserror::Error;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use url::Url;

type HmacSha256 = Hmac<Sha256>;
type SignedHeaders = Vec<(&'static str, String)>;

#[derive(Debug, Error)]
pub enum UploadError {
    #[error(transparent)]
    Auth(#[from] AuthClientError),
    #[error("R2 endpoint returned an unexpected response")]
    R2Response,
    #[error("temporary R2 credentials have an invalid team prefix")]
    InvalidCredentialScope,
    #[error("R2 endpoint is invalid or insecure")]
    InvalidEndpoint,
    #[error("artifact file could not be read")]
    File,
    #[error("artifact changed while it was being read")]
    Changed,
    #[error("upload was cancelled after an authentication change")]
    Cancelled,
    #[error("network request to R2 failed")]
    Network,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadOutcome {
    Uploaded,
    Changed,
}

pub struct UploadManager {
    auth_client: AuthClient,
    publisher_token: SecretString,
    team: String,
    cache: Mutex<Option<TemporaryUploadCredentials>>,
}

impl UploadManager {
    pub fn new(auth_client: AuthClient, publisher_token: SecretString, team: String) -> Self {
        Self {
            auth_client,
            publisher_token,
            team,
            cache: Mutex::new(None),
        }
    }

    pub async fn clear_cached_credentials(&self) {
        *self.cache.lock().await = None;
    }

    pub async fn upload_file(
        &self,
        root: &Path,
        path: &Path,
        expected_hash: &str,
        cancellation: &CancellationToken,
    ) -> Result<UploadOutcome, UploadError> {
        let relative = normalized_relative_path(root, path).map_err(|_| UploadError::File)?;
        if relative == "config.json" || relative.split('/').any(|part| part == ".artifact-sync") {
            return Err(UploadError::InvalidCredentialScope);
        }
        let bytes = tokio::fs::read(path).await.map_err(|_| UploadError::File)?;
        let content_hash = hex::encode(Sha256::digest(&bytes));
        if content_hash != expected_hash {
            return Ok(UploadOutcome::Changed);
        }

        for attempt in 0..2 {
            let credentials = self.credentials(cancellation).await?;
            validate_scope(&credentials, &self.team)?;
            let result = put_object(&credentials, &relative, &bytes, cancellation).await;
            match result {
                Err(PutError::Expired) if attempt == 0 => {
                    self.clear_cached_credentials().await;
                    continue;
                }
                Err(PutError::Expired) | Err(PutError::Failed) => {
                    return Err(UploadError::R2Response);
                }
                Err(PutError::Cancelled) => return Err(UploadError::Cancelled),
                Err(PutError::Network) => return Err(UploadError::Network),
                Ok(()) => return Ok(UploadOutcome::Uploaded),
            }
        }
        Err(UploadError::R2Response)
    }

    async fn credentials(
        &self,
        cancellation: &CancellationToken,
    ) -> Result<TemporaryUploadCredentials, UploadError> {
        let mut cache = self.cache.lock().await;
        if let Some(credentials) = cache.as_ref() {
            if credentials.expires_at > Utc::now() + ChronoDuration::seconds(120) {
                return Ok(credentials.clone());
            }
        }
        let future = self
            .auth_client
            .temporary_credentials(&self.publisher_token, &self.team);
        let credentials = tokio::select! {
            _ = cancellation.cancelled() => return Err(UploadError::Cancelled),
            result = future => result?,
        };
        validate_scope(&credentials, &self.team)?;
        *cache = Some(credentials.clone());
        Ok(credentials)
    }
}

fn validate_scope(credentials: &TemporaryUploadCredentials, team: &str) -> Result<(), UploadError> {
    let expected_prefix = format!("teams/{team}/artifacts/");
    if credentials.prefix != expected_prefix {
        return Err(UploadError::InvalidCredentialScope);
    }
    let endpoint = Url::parse(&credentials.endpoint).map_err(|_| UploadError::InvalidEndpoint)?;
    let host = endpoint.host_str().ok_or(UploadError::InvalidEndpoint)?;
    let r2_account = host.strip_suffix(".r2.cloudflarestorage.com");
    if endpoint.scheme() != "https"
        || r2_account.is_none_or(|account| account.is_empty() || account.contains('.'))
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || !matches!(endpoint.path(), "" | "/")
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
        || endpoint.port().is_some_and(|port| port != 443)
    {
        return Err(UploadError::InvalidEndpoint);
    }
    Ok(())
}

enum PutError {
    Expired,
    Failed,
    Network,
    Cancelled,
}

async fn put_object(
    credentials: &TemporaryUploadCredentials,
    relative_key: &str,
    body: &[u8],
    cancellation: &CancellationToken,
) -> Result<(), PutError> {
    let (url, headers) =
        signed_put(credentials, relative_key, body).map_err(|_| PutError::Failed)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| PutError::Network)?;
    let mut request = client.put(url).body(body.to_vec());
    for (name, value) in headers {
        request = request.header(name, value);
    }
    let response = tokio::select! {
        _ = cancellation.cancelled() => return Err(PutError::Cancelled),
        result = request.send() => result.map_err(|_| PutError::Network)?,
    };
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if status.as_u16() == 403
        && (body.contains("ExpiredToken")
            || body.contains("RequestExpired")
            || body.contains("expired"))
    {
        return Err(PutError::Expired);
    }
    Err(PutError::Failed)
}

fn signed_put(
    credentials: &TemporaryUploadCredentials,
    relative_key: &str,
    body: &[u8],
) -> Result<(Url, SignedHeaders), UploadError> {
    let mut endpoint =
        Url::parse(&credentials.endpoint).map_err(|_| UploadError::InvalidEndpoint)?;
    if endpoint.scheme() != "https" {
        return Err(UploadError::InvalidEndpoint);
    }
    let object_path = format!(
        "/{}/{}",
        encode_segment(&credentials.bucket),
        encode_key(relative_key)
    );
    endpoint.set_path(&object_path);
    endpoint.set_query(None);
    endpoint.set_fragment(None);
    let host = match endpoint.port() {
        Some(port) => format!(
            "{}:{port}",
            endpoint.host_str().ok_or(UploadError::InvalidEndpoint)?
        ),
        None => endpoint
            .host_str()
            .ok_or(UploadError::InvalidEndpoint)?
            .to_string(),
    };
    let date = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let short_date = &date[..8];
    let payload_hash = hex::encode(Sha256::digest(body));
    let signed_headers = "host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
    let canonical_headers = format!(
        "host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{date}\nx-amz-security-token:{}\n",
        credentials.session_token.expose()
    );
    let canonical_request = format!(
        "PUT\n{}\n\n{}\n{}\n{}",
        endpoint.path(),
        canonical_headers,
        signed_headers,
        payload_hash
    );
    let scope = format!("{short_date}/auto/s3/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{date}\n{scope}\n{}",
        hex::encode(Sha256::digest(canonical_request.as_bytes()))
    );
    let secret = format!("AWS4{}", credentials.secret_access_key.expose());
    let date_key = hmac(secret.as_bytes(), short_date);
    let region_key = hmac(&date_key, "auto");
    let service_key = hmac(&region_key, "s3");
    let signing_key = hmac(&service_key, "aws4_request");
    let signature = hex::encode(hmac(&signing_key, &string_to_sign));
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
        credentials.access_key_id.expose()
    );
    let headers = vec![
        ("host", host),
        ("x-amz-content-sha256", payload_hash),
        ("x-amz-date", date),
        (
            "x-amz-security-token",
            credentials.session_token.expose().to_string(),
        ),
        ("authorization", authorization),
    ];
    Ok((endpoint, headers))
}

fn hmac(key: &[u8], message: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts arbitrary key lengths");
    mac.update(message.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

fn encode_key(key: &str) -> String {
    key.split('/')
        .map(encode_segment)
        .collect::<Vec<_>>()
        .join("/")
}

fn encode_segment(segment: &str) -> String {
    let mut encoded = String::new();
    for byte in segment.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    fn credentials() -> TemporaryUploadCredentials {
        TemporaryUploadCredentials {
            access_key_id: SecretString::new("access"),
            secret_access_key: SecretString::new("secret"),
            session_token: SecretString::new("session-token-private"),
            endpoint: "https://account.r2.cloudflarestorage.com".into(),
            bucket: "artifacts".into(),
            prefix: "teams/w3dev/artifacts/".into(),
            expires_at: Utc::now() + Duration::minutes(15),
        }
    }

    #[test]
    fn signed_put_has_only_temporary_r2_authorization() {
        let (url, headers) = signed_put(&credentials(), "reports/a file.json", b"{}").unwrap();
        assert_eq!(url.path(), "/artifacts/reports/a%20file.json");
        assert!(
            headers
                .iter()
                .any(|(name, _)| *name == "x-amz-security-token")
        );
        let auth = headers
            .iter()
            .find(|(name, _)| *name == "authorization")
            .unwrap()
            .1
            .as_str();
        assert!(auth.starts_with("AWS4-HMAC-SHA256 Credential=access/"));
        assert!(!auth.contains("Bearer"));
    }

    #[test]
    fn credentials_must_match_the_exact_team_prefix() {
        assert!(validate_scope(&credentials(), "w3dev").is_ok());
        let mut bad = credentials();
        bad.prefix = "teams/other/artifacts/".into();
        assert!(matches!(
            validate_scope(&bad, "w3dev"),
            Err(UploadError::InvalidCredentialScope)
        ));
    }

    #[test]
    fn temporary_r2_endpoint_must_be_a_canonical_r2_origin() {
        let mut credentials = credentials();
        credentials.endpoint = "https://attacker.example".into();
        assert!(matches!(
            validate_scope(&credentials, "w3dev"),
            Err(UploadError::InvalidEndpoint)
        ));
        credentials.endpoint = "https://user:password@account.r2.cloudflarestorage.com".into();
        assert!(matches!(
            validate_scope(&credentials, "w3dev"),
            Err(UploadError::InvalidEndpoint)
        ));
    }

    #[tokio::test]
    async fn refreshes_temporary_credentials_when_the_cached_session_is_near_expiry() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for lifetime in [Duration::seconds(30), Duration::minutes(15)] {
                let (mut stream, _) = listener.accept().await.unwrap();
                let request = read_http_request(&mut stream).await;
                assert!(request.starts_with("POST /__api/v1/uploads/credentials "));
                assert!(request.lines().any(|line| {
                    line.eq_ignore_ascii_case("authorization: Bearer publisher-secret")
                }));
                let expires_at = (Utc::now() + lifetime).to_rfc3339();
                let body = format!(
                    "{{\"accessKeyId\":\"temporary-id\",\"secretAccessKey\":\"temporary-secret\",\"sessionToken\":\"temporary-session\",\"endpoint\":\"https://account.r2.cloudflarestorage.com\",\"bucket\":\"artifacts\",\"prefix\":\"teams/w3dev/artifacts/\",\"expiresAt\":\"{expires_at}\"}}"
                );
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });

        let manager = UploadManager::new(
            AuthClient::new(origin).unwrap(),
            SecretString::new("publisher-secret"),
            "w3dev".into(),
        );
        let cancellation = CancellationToken::new();
        let first = manager.credentials(&cancellation).await.unwrap();
        assert!(first.expires_at < Utc::now() + ChronoDuration::seconds(120));
        let refreshed = manager.credentials(&cancellation).await.unwrap();
        assert!(refreshed.expires_at > Utc::now() + ChronoDuration::seconds(120));
        assert_eq!(refreshed.access_key_id.expose(), "temporary-id");
        server.await.unwrap();
    }

    async fn read_http_request(stream: &mut TcpStream) -> String {
        let mut request = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            let read = stream.read(&mut chunk).await.unwrap();
            if read == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..read]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        String::from_utf8(request).unwrap()
    }
}
