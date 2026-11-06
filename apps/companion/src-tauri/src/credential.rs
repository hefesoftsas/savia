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

/// Only a fixed error category and numeric native code are shareable. Raw
/// Keyring diagnostics may carry credential attributes and never enter logs.
pub fn diagnostic_error(error: &keyring::Error) -> (&'static str, Option<i64>) {
    let (category, source) = match error {
        keyring::Error::PlatformFailure(source) => ("platform_failure", Some(source)),
        keyring::Error::NoStorageAccess(source) => ("storage_unavailable", Some(source)),
        keyring::Error::NoEntry => ("not_found", None),
        keyring::Error::BadEncoding(_) => ("bad_encoding", None),
        keyring::Error::TooLong(_, _) => ("too_long", None),
        keyring::Error::Invalid(_, _) => ("invalid_input", None),
        keyring::Error::Ambiguous(_) => ("ambiguous_entry", None),
        _ => ("unknown", None),
    };
    // security-framework's Debug includes `code: OSStatus`. Parse just that
    // integer without adding its human-readable message to the log.
    let code = source.and_then(|source| {
        let debug = format!("{source:?}");
        let value = debug.strip_prefix("Error { code: ")?;
        let number = value.split([',', '}']).next()?.trim();
        number.parse::<i32>().ok().map(i64::from)
    });
    (category, code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_categories_exclude_invalid_values_and_bad_secret_bytes() {
        let secret = "savia_pat_do_not_log";
        let invalid = keyring::Error::Invalid("token".into(), secret.into());
        let encoded = keyring::Error::BadEncoding(secret.as_bytes().to_vec());
        assert_eq!(diagnostic_error(&invalid), ("invalid_input", None));
        assert_eq!(diagnostic_error(&encoded), ("bad_encoding", None));
        assert!(!serde_json::to_string(&diagnostic_error(&invalid))
            .unwrap()
            .contains(secret));
        assert!(!serde_json::to_string(&diagnostic_error(&encoded))
            .unwrap()
            .contains(secret));
    }

    #[test]
    fn diagnostic_native_codes_do_not_include_source_messages() {
        struct NativeFailure;
        impl std::fmt::Debug for NativeFailure {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.debug_struct("Error")
                    .field("code", &-25308)
                    .field("message", &"savia_pat_do_not_log")
                    .finish()
            }
        }
        impl std::fmt::Display for NativeFailure {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "savia_pat_do_not_log")
            }
        }
        impl std::error::Error for NativeFailure {}
        let failure = keyring::Error::PlatformFailure(Box::new(NativeFailure));
        assert_eq!(
            diagnostic_error(&failure),
            ("platform_failure", Some(-25308))
        );
        assert!(!serde_json::to_string(&diagnostic_error(&failure))
            .unwrap()
            .contains("savia_pat_do_not_log"));
    }

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
