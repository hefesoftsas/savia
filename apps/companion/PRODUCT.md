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
A private native meeting inbox preserves completed segments after interruption
and retains multiple meetings across launches. New recordings preserve earlier
meetings. Each meeting can be renamed, previewed, uploaded individually, or
explicitly deleted. A single local player combines both sources on their stored
timeline without an API connection or upload. Uploaded local copies remain until
deleted. Capture always attempts both sources with three attempts per unavailable
source and keeps any available source; it fails if neither can start.

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

Upload uses a button on each local meeting. A startup disclaimer explains
participant authorization and per-meeting responsibility; acceptance persists
in a versioned private native preference and can be reset in connection settings.
Acceptance never uploads audio automatically. Help icons sit beside the label
they explain, and their floating bubbles stay within the viewport.
