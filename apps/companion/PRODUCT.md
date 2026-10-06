# Savia Companion product context

## Platform

Desktop application for macOS and Windows with a React WebView and native capture.
The preview supports manually started sessions up to one hour of recorded audio,
with pause/resume that keeps one take; paused wall-clock time is excluded from
the one-hour budget and the timeline continues where audio stopped.
Real-device support claims require the platform validation protocol.

## Purpose and users

Savia users record their own permitted meetings, inspect source tracks and request
remote transcription and a reviewable summary. Audio, transcripts, processing progress and notes persist privately in Savia.
A bounded native draft spool preserves completed segments after interruption.
After stopping or recovering an interrupted draft, each source can be explicitly
previewed on the device from the current native draft before upload. Preview needs no API connection, upload
permission, upload consent, or provider call, and never uploads automatically.
Past takes live in Savia, not in a local history.

## Constraints

Provider keys belong to the backend. No automatic recording or business writes.
The Savia credential stays in memory; only an explicit “remember on this
device” opt-in stores origin and token in the OS keychain and reconnects on
launch, removable at any time from connection settings.
Microphone and output sources are not speaker identities. Keep Savia attribution.
The monorepo's current monochrome interface and emerald theme are the visual
reference; this app extends that family. Controls must work with keyboard input
and report native/backend failures clearly. The interface ships in Spanish,
English and Portuguese: it detects the OS/WebView language at each launch and
falls back to Spanish. A manual choice in connection settings lasts for the
current window only; the app does not persist that preference.
