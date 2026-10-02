# Savia Companion product context

## Platform

Desktop application for macOS and Windows with a React WebView and native capture.
The initial validation build supports short manual sessions; real-device support
claims require the platform validation protocol.

## Purpose and users

Savia users record their own permitted meetings, inspect source tracks and request
remote transcription and a reviewable summary. Saved meetings remain a future
backend capability; this prototype keeps results in memory.

## Constraints

Provider keys belong to the backend. No automatic recording or business writes.
Microphone and output sources are not speaker identities. Keep Savia attribution.
The monorepo's current monochrome interface and emerald theme are the visual
reference; this app extends that family. Controls must work with keyboard input
and report native/backend failures clearly. Initial UI language is English.
