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

## Constraints

Provider keys belong to the backend. No automatic recording or business writes.
Microphone and output sources are not speaker identities. Keep Savia attribution.
The monorepo's current monochrome interface and emerald theme are the visual
reference; this app extends that family. Controls must work with keyboard input
and report native/backend failures clearly. Initial UI language is English.
