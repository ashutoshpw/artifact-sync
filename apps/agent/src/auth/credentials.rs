use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop};

pub fn is_refresh_credential(value: &str) -> bool {
    ["as_api_", "as_dev_", "as_rf_"].iter().any(|prefix| {
        value.strip_prefix(prefix).is_some_and(|secret| {
            secret.len() == 43
                && secret
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        })
    })
}

pub fn is_access_token(value: &str) -> bool {
    let mut parts = value.split('.');
    let Some(header) = parts.next() else {
        return false;
    };
    let Some(payload) = parts.next() else {
        return false;
    };
    let Some(signature) = parts.next() else {
        return false;
    };
    if parts.next().is_some() || value.len() > 8192 {
        return false;
    }
    let Ok(header) = URL_SAFE_NO_PAD.decode(header) else {
        return false;
    };
    let Ok(payload) = URL_SAFE_NO_PAD.decode(payload) else {
        return false;
    };
    let Ok(signature) = URL_SAFE_NO_PAD.decode(signature) else {
        return false;
    };
    let Ok(header): Result<serde_json::Value, _> = serde_json::from_slice(&header) else {
        return false;
    };
    let Ok(payload): Result<serde_json::Value, _> = serde_json::from_slice(&payload) else {
        return false;
    };
    header.get("alg").and_then(serde_json::Value::as_str) == Some("HS256")
        && header.get("typ").and_then(serde_json::Value::as_str) == Some("JWT")
        && payload.is_object()
        && signature.len() == 32
}

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretString([REDACTED])")
    }
}

impl Serialize for SecretString {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for SecretString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        String::deserialize(deserializer).map(Self::new)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CachedIdentity {
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub team_id: String,
    pub team: String,
    pub permissions: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedAuth {
    #[serde(rename = "type")]
    pub auth_type: String,
    pub access_token: SecretString,
    pub refresh_token: SecretString,
    pub token_id: String,
    pub expires_at: DateTime<Utc>,
    pub cached_identity: CachedIdentity,
}

impl fmt::Debug for SavedAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SavedAuth")
            .field("auth_type", &self.auth_type)
            .field("access_token", &"[REDACTED]")
            .field("refresh_token", &"[REDACTED]")
            .field("token_id", &self.token_id)
            .field("expires_at", &self.expires_at)
            .field("cached_identity", &self.cached_identity)
            .finish()
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthFile {
    pub version: u8,
    pub server_url: String,
    #[serde(default)]
    pub auth: Option<SavedAuth>,
}

impl fmt::Debug for AuthFile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AuthFile")
            .field("version", &self.version)
            .field("server_url", &self.server_url)
            .field(
                "auth",
                &self.auth.as_ref().map(|auth| auth.auth_type.as_str()),
            )
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialSource {
    AuthFile,
    Environment,
}

impl CredentialSource {
    pub fn label(self) -> &'static str {
        match self {
            Self::AuthFile => "auth file",
            Self::Environment => "environment",
        }
    }
}

#[derive(Clone)]
pub struct ActiveCredential {
    /// Environment credentials may be a refresh secret before initial exchange;
    /// file credentials are the current short-lived access JWT.
    pub access_token: SecretString,
    pub refresh_token: Option<SecretString>,
    pub server_origin: String,
    pub source: CredentialSource,
    pub cached_auth: Option<SavedAuth>,
}

impl fmt::Debug for ActiveCredential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ActiveCredential")
            .field("access_token", &"[REDACTED]")
            .field(
                "refresh_token",
                &self.refresh_token.as_ref().map(|_| "[REDACTED]"),
            )
            .field("server_origin", &self.server_origin)
            .field("source", &self.source)
            .finish()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublisherIdentity {
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub team_id: String,
    pub team: String,
    pub permissions: Vec<String>,
    pub expires_at: DateTime<Utc>,
    pub token_id: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TokenExchange {
    pub access_token: SecretString,
    pub refresh_token: SecretString,
    pub expires_at: DateTime<Utc>,
    pub identity: PublisherIdentity,
}

impl fmt::Debug for TokenExchange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TokenExchange")
            .field("access_token", &"[REDACTED]")
            .field("refresh_token", &"[REDACTED]")
            .field("expires_at", &self.expires_at)
            .field("identity", &self.identity)
            .finish()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceAuthorization {
    pub device_code: SecretString,
    pub user_code: String,
    pub verification_url: String,
    pub interval_seconds: u64,
    pub expires_at: DateTime<Utc>,
}
