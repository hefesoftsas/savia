use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureErrorCode {
    MicrophonePermissionDenied,
    SystemPermissionDenied,
    CaptureUnavailable,
    PendingDraft,
    CaptureFailed,
}

pub fn classify_capture_error(message: &str) -> CaptureErrorCode {
    let message = message.to_ascii_lowercase();
    if matches!(
        message.as_str(),
        "a saved capture draft must be discarded before starting another recording."
            | "the recording is paused. resume or discard it before starting another recording."
    ) {
        CaptureErrorCode::PendingDraft
    } else if message.contains("microphone permission was denied")
        || message.contains("could not request microphone permission")
        || message.contains("microphone permission did not resolve")
    {
        CaptureErrorCode::MicrophonePermissionDenied
    } else if message.contains("capture permission")
        || message.contains("system audio recording permission")
        || message.contains("audio recording permissions")
        || message.contains("could not start the system audio tap")
    {
        CaptureErrorCode::SystemPermissionDenied
    } else if message.contains("no windows system output device is available")
        || message.contains("capture currently supports macos and windows only")
    {
        CaptureErrorCode::CaptureUnavailable
    } else {
        CaptureErrorCode::CaptureFailed
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_capture_error, CaptureErrorCode};

    #[test]
    fn classifies_native_permission_and_availability_errors() {
        assert_eq!(
            classify_capture_error("Microphone permission was denied."),
            CaptureErrorCode::MicrophonePermissionDenied
        );
        assert_eq!(
            classify_capture_error(
                "macOS denied or could not initialize system audio capture. Check the app's audio recording permissions."
            ),
            CaptureErrorCode::SystemPermissionDenied
        );
        assert_eq!(
            classify_capture_error(
                "macOS could not start the system audio tap. Check System Settings > Privacy & Security > Screen & System Audio Recording."
            ),
            CaptureErrorCode::SystemPermissionDenied
        );
        assert_eq!(
            classify_capture_error("No Windows system output device is available: none"),
            CaptureErrorCode::CaptureUnavailable
        );
    }

    #[test]
    fn unknown_native_errors_fail_closed_to_generic_capture_failure() {
        assert_eq!(
            classify_capture_error("A driver returned an unexpected diagnostic."),
            CaptureErrorCode::CaptureFailed
        );
    }

    #[test]
    fn classifies_pending_draft_hints() {
        assert_eq!(
            classify_capture_error(
                "A saved capture draft must be discarded before starting another recording."
            ),
            CaptureErrorCode::PendingDraft
        );
        assert_eq!(
            classify_capture_error(
                "The recording is paused. Resume or discard it before starting another recording."
            ),
            CaptureErrorCode::PendingDraft
        );
        assert_eq!(
            classify_capture_error(
                "A saved capture draft must be discarded before starting another recording. Driver failed."
            ),
            CaptureErrorCode::CaptureFailed
        );
    }

    #[test]
    fn serializes_codes_for_the_frontend_contract() {
        assert_eq!(
            serde_json::to_string(&CaptureErrorCode::MicrophonePermissionDenied).unwrap(),
            "\"microphonePermissionDenied\""
        );
        assert_eq!(
            serde_json::to_string(&CaptureErrorCode::CaptureFailed).unwrap(),
            "\"captureFailed\""
        );
        assert_eq!(
            serde_json::to_string(&CaptureErrorCode::PendingDraft).unwrap(),
            "\"pendingDraft\""
        );
    }
}
