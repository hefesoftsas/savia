use std::time::Duration;

use reqwest::{header::AUTHORIZATION, redirect::Policy, Client, Method, Url};
use serde::Deserialize;
use serde_json::Value;

const MAX_TOKEN_BYTES: usize = 8 * 1024;
const MAX_REQUEST_BYTES: usize = 12 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Capabilities,
    Transcribe,
    Summarize,
    Save,
    Recordings,
}

impl Operation {
    fn path(self) -> &'static str {
        match self {
            Self::Capabilities => "capabilities",
            Self::Transcribe => "transcribe",
            Self::Summarize => "summarize",
            Self::Save => "recordings",
            Self::Recordings => "recordings",
        }
    }

    fn method(self) -> Method {
        match self {
            Self::Capabilities | Self::Recordings => Method::GET,
            Self::Transcribe | Self::Summarize | Self::Save => Method::POST,
        }
    }
}

#[derive(Deserialize)]
pub struct CompanionRequest {
    pub origin: String,
    pub token: String,
    pub operation: Operation,
    #[serde(default)]
    pub body: Option<Value>,
}

fn validate_origin(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Enter a valid Savia server origin.".to_string())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let local = matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1" | "[::1]");
    if !matches!(url.scheme(), "https" | "http")
        || (url.scheme() == "http" && !local)
        || url.username() != ""
        || url.password().is_some()
        || !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Server origin must be HTTPS; HTTP is allowed only for localhost.".into());
    }
    Ok(url)
}

fn validate_token(token: &str) -> Result<(), String> {
    if token.is_empty()
        || token.len() > MAX_TOKEN_BYTES
        || token.bytes().any(|byte| !(0x21..=0x7e).contains(&byte))
        || token.to_ascii_lowercase().starts_with("sk-or-")
    {
        return Err("Enter a valid Savia access token.".into());
    }
    Ok(())
}

fn build_url(origin: &str, operation: Operation) -> Result<Url, String> {
    let mut url = validate_origin(origin)?;
    url.set_path(&format!("/v1/companion/{}", operation.path()));
    Ok(url)
}

pub async fn request(request: CompanionRequest) -> Result<Value, String> {
    validate_token(&request.token)?;
    let url = build_url(&request.origin, request.operation)?;
    let body = request.body.unwrap_or(Value::Null);
    let body_bytes =
        serde_json::to_vec(&body).map_err(|_| "Request data must be JSON.".to_string())?;
    if request.operation.method() != Method::GET && body_bytes.len() > MAX_REQUEST_BYTES {
        return Err("Request data exceeds the 12 MiB limit.".into());
    }

    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(75))
        .build()
        .map_err(|_| "Could not initialize the Savia connection.".to_string())?;
    let mut builder = client
        .request(request.operation.method(), url)
        .header(AUTHORIZATION, format!("Bearer {}", request.token));
    if request.operation.method() == Method::POST {
        builder = builder
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body_bytes);
    }

    let mut response = builder
        .send()
        .await
        .map_err(|error| if error.is_timeout() {
            "The request timed out after submission. Its outcome may be billable; check Savia before retrying.".to_string()
        } else {
            "Could not reach the Savia server.".to_string()
        })?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let fallback = format!("Savia request failed (HTTP {status}).");
        let mut error_bytes = Vec::new();
        while error_bytes.len() < 16 * 1024 {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    let remaining = 16 * 1024 - error_bytes.len();
                    if chunk.len() > remaining {
                        break;
                    }
                    error_bytes.extend_from_slice(&chunk);
                }
                Ok(None) | Err(_) => break,
            }
        }
        let message = serde_json::from_slice::<Value>(&error_bytes)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .or_else(|| value.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .map(|candidate| safe_error_message(&candidate, &request.token, &fallback))
            .unwrap_or(fallback);
        return Err(message);
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("Savia response exceeds the 1 MiB limit.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read the Savia response.".to_string())?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("Savia response exceeds the 1 MiB limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let result = serde_json::from_slice(&bytes)
        .map_err(|_| "Savia returned an invalid JSON response.".to_string())?;
    Ok(result)
}

fn safe_error_message(candidate: &str, token: &str, fallback: &str) -> String {
    let safe: String = candidate
        .chars()
        .filter(|character| !character.is_control())
        .take(160)
        .collect();
    if safe.is_empty()
        || safe.contains(token)
        || safe.to_ascii_lowercase().contains("sk-or-")
        || safe.to_ascii_lowercase().contains("bearer ")
    {
        fallback.to_string()
    } else {
        safe
    }
}

fn savia_page_url(origin: &str) -> Result<Url, String> {
    let mut url = validate_origin(origin)?;
    url.set_fragment(Some("/companion-recordings"));
    Ok(url)
}

pub fn open_savia(origin: &str) -> Result<(), String> {
    let url = savia_page_url(origin)?;
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("/usr/bin/open")
        .arg(url.as_str())
        .spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(url.as_str())
        .spawn();
    result
        .map(|_| ())
        .map_err(|_| "Could not open Savia in your browser.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_links_are_fixed_to_the_savia_recording_page() {
        assert_eq!(
            savia_page_url("https://savia.example").unwrap().as_str(),
            "https://savia.example/#/companion-recordings"
        );
        assert!(savia_page_url("https://savia.example/?token=secret").is_err());
        assert!(savia_page_url("file:///tmp/sample").is_err());
    }

    #[test]
    fn only_https_and_localhost_http_origins_are_accepted() {
        assert!(validate_origin("https://savia.example").is_ok());
        assert!(validate_origin("http://localhost:8787").is_ok());
        assert!(validate_origin("http://127.0.0.1:8787").is_ok());
        assert!(validate_origin("http://[::1]:8787").is_ok());
        assert!(validate_origin("http://savia.example").is_err());
        assert!(validate_origin("https://savia.example/path").is_err());
        assert!(validate_origin("https://user@savia.example").is_err());
        assert!(validate_origin("https://savia.example/?x=y").is_err());
    }

    #[test]
    fn bearer_token_rejects_provider_keys_and_control_characters() {
        assert!(validate_token("savia-session-token").is_ok());
        assert!(validate_token("sk-or-secret").is_err());
        assert!(validate_token("abc\nxyz").is_err());
        assert!(validate_token(&"x".repeat(MAX_TOKEN_BYTES + 1)).is_err());
    }

    #[test]
    fn operation_paths_and_methods_are_fixed() {
        assert_eq!(Operation::Capabilities.path(), "capabilities");
        assert_eq!(Operation::Transcribe.path(), "transcribe");
        assert_eq!(Operation::Summarize.path(), "summarize");
        assert_eq!(Operation::Save.path(), "recordings");
        assert_eq!(Operation::Recordings.path(), "recordings");
        assert_eq!(Operation::Capabilities.method(), Method::GET);
        assert_eq!(Operation::Transcribe.method(), Method::POST);
        assert_eq!(Operation::Summarize.method(), Method::POST);
        assert_eq!(Operation::Save.method(), Method::POST);
        assert_eq!(Operation::Recordings.method(), Method::GET);
        assert_eq!(
            build_url("https://savia.example", Operation::Save)
                .unwrap()
                .as_str(),
            "https://savia.example/v1/companion/recordings"
        );
        assert_eq!(
            build_url("https://savia.example", Operation::Transcribe)
                .unwrap()
                .as_str(),
            "https://savia.example/v1/companion/transcribe"
        );
    }

    #[test]
    fn sanitizes_nested_backend_error_messages_and_secret_echoes() {
        assert_eq!(
            safe_error_message(
                "Companion is disabled for this tenant.",
                "session",
                "HTTP failure"
            ),
            "Companion is disabled for this tenant."
        );
        assert_eq!(
            safe_error_message("Token was session-secret", "session-secret", "HTTP failure"),
            "HTTP failure"
        );
        assert_eq!(
            safe_error_message(
                "Invalid Authorization: Bearer abc",
                "session",
                "HTTP failure"
            ),
            "HTTP failure"
        );
    }
}
