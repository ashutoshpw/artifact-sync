use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop};

pub fn is_publisher_token(value: &str) -> bool {
    let Some(secret) = value.strip_prefix("as_pub_") else {
        return false;
    };
    secret.len() == 43
        && secret
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
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
    pub publisher_id: String,
    pub team: String,
    pub permissions: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedAuth {
    #[serde(rename = "type")]
    pub auth_type: String,
    pub token: SecretString,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_identity: Option<CachedIdentity>,
}

impl fmt::Debug for SavedAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SavedAuth")
            .field("auth_type", &self.auth_type)
            .field("token", &"[REDACTED]")
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
    pub token: SecretString,
    pub server_origin: String,
    pub source: CredentialSource,
    pub cached_auth: Option<SavedAuth>,
}

impl fmt::Debug for ActiveCredential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ActiveCredential")
            .field("token", &"[REDACTED]")
            .field("server_origin", &self.server_origin)
            .field("source", &self.source)
            .finish()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublisherIdentity {
    pub publisher_id: String,
    pub team: String,
    pub permissions: Vec<String>,
    pub expires_at: DateTime<Utc>,
    pub token_id: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemporaryUploadCredentials {
    pub access_key_id: SecretString,
    pub secret_access_key: SecretString,
    pub session_token: SecretString,
    pub endpoint: String,
    pub bucket: String,
    pub prefix: String,
    pub expires_at: DateTime<Utc>,
}

impl fmt::Debug for TemporaryUploadCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TemporaryUploadCredentials")
            .field("access_key_id", &"[REDACTED]")
            .field("secret_access_key", &"[REDACTED]")
            .field("session_token", &"[REDACTED]")
            .field("endpoint", &self.endpoint)
            .field("bucket", &self.bucket)
            .field("prefix", &self.prefix)
            .field("expires_at", &self.expires_at)
            .finish()
    }
}
