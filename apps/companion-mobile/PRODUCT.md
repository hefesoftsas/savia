# Savia Companion mobile

<!-- impeccable:product-schema 1 -->

## Platform

adaptive — Flutter Android and iOS, with system browser and document picker.

## Users and purpose

Savia users capture or import audio, save it privately to their workspace, and
review transcripts, summaries, and answers grounded in those recordings.

## Capabilities and constraints

The approved preview supports foreground microphone capture up to 60 seconds,
imports up to 50 MB, and explicit upload and processing consent. Backend storage
is authoritative. Only refresh credentials and transient app-owned audio reside
on the device. No other-app call capture or background recording is included.

## Brand commitments

Inherit Savia Companion desktop's neutral surfaces, emerald action color, system
typography, and direct ES/EN/PT language. Preserve familiar native controls.

## Evidence

Approved design: ../../docs/superpowers/specs/2026-10-03-companion-mobile-design.md.
Desktop visual source: ../companion/src/styles.css. Device/provider verification
is recorded separately from automated tests.

## Validation context

Visual tests use explicitly synthetic recordings; native OS permission, callback,
and audible playback evidence must come from device runs, not screenshots.
