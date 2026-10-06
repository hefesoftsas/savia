//! Opt-in OS-keychain storage for the Savia API credential.
//!
//! The renderer keeps the active token in memory only. When the user checks
//! "remember on this device", one JSON envelope (origin + token) is stored in
//! the platform credential manager (macOS Keychain, Windows Credential
//! Manager) under a fixed service/account pair. Nothing is ever written to the
//! capture spool, logs, or manifests.
use serde::{Deserialize, Serialize};

const SERVICE: &str = "Savia Companion";
const ACCOUNT: &str = "savia-api-credential";
const MAX_STORED_BYTES: usize = 16 * 1024;

#[derive(Serialize, Deserialize, PartialEq, Debug)]
pub struct SavedCredential {
    pub origin: String,
    pub token: String,
}

fn validate_origin(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 2048 {
        return Err("Enter a valid Savia server origin.".into());
    }
    crate::backend::validate_origin(value).map(|_| ())
}

fn validate_token(value: &str) -> Result<(), String> {
    crate::backend::validate_token(value)
}

/// Serialize and validate a credential for keychain storage.
pub fn envelope(origin: &str, token: &str) -> Result<String, String> {
    validate_origin(origin)?;
    validate_token(token)?;
    let secret = serde_json::to_string(&SavedCredential {
        origin: origin.into(),
        token: token.into(),
    })
    .map_err(|_| "Could not save the credential on this device.".to_string())?;
    if secret.len() > MAX_STORED_BYTES {
        return Err("Saved credential exceeds the storage limit.".into());
    }
    Ok(secret)
}

/// Parse and re-validate a secret read back from the keychain.
pub fn parse_envelope(secret: &str) -> Result<SavedCredential, String> {
    if secret.is_empty() || secret.len() > MAX_STORED_BYTES {
        return Err("Saved credential is invalid or corrupt.".into());
    }
    let credential: SavedCredential = serde_json::from_str(secret)
        .map_err(|_| "Saved credential is invalid or corrupt.".to_string())?;
    validate_origin(&credential.origin)?;
    validate_token(&credential.token)?;
    Ok(credential)
}

pub fn service() -> &'static str {
    SERVICE
}

pub fn account() -> &'static str {
    ACCOUNT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_round_trips_a_valid_credential() {
        let origin = "https://savia.example";
        let token = "savia_pat_abc123";
        let secret = envelope(origin, token).unwrap();
        assert_eq!(
            parse_envelope(&secret).unwrap(),
            SavedCredential {
                origin: origin.into(),
                token: token.into(),
            }
        );
    }

    #[test]
    fn envelope_rejects_overlong_or_malformed_values() {
        assert!(envelope("", "savia_pat_abc123").is_err());
        assert!(envelope("https://savia.example", "").is_err());
        assert!(envelope("https://savia.example", &"x".repeat(9 * 1024)).is_err());
        assert!(envelope("not a url", "savia_pat_abc123").is_err());
        // Provider keys must never be stored as the Companion credential.
        assert!(envelope("https://savia.example", "sk-or-secret").is_err());
    }

    #[test]
    fn parse_rejects_corrupt_or_foreign_secrets() {
        assert!(parse_envelope("").is_err());
        assert!(parse_envelope("not-json").is_err());
        assert!(parse_envelope("{\"origin\":\"https://savia.example\"}").is_err());
        assert!(parse_envelope("[]").is_err());
        assert!(parse_envelope(&"x".repeat(MAX_STORED_BYTES + 1)).is_err());
    }
}
