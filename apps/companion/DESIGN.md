---
name: Savia Companion
description: A compact desktop recorder for capturing audio and handing it off to Savia.
colors:
  primary: "#176647"
  primary-hover: "#105438"
  primary-wash: "#eaf4ee"
  recording: "#a53839"
  focus: "#4d9874"
  ink: "#202925"
  muted: "#59665f"
  neutral-bg: "#f6f8f7"
  surface: "#ffffff"
  soft: "#f5f8f6"
  divider: "#e1e7e3"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(56px, 18vw, 72px)"
    fontWeight: 450
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  sm: "7px"
  md: "9px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "30px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 9px"
    height: "34px"
  settings-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "13px 14px 14px"
---

# Design System: Savia Companion

## Overview

**Creative North Star: “One capture, one handoff.”**

Savia Companion is a small desktop utility for recording a short sample and
previewing each captured source locally before choosing whether to upload it for
review in Savia. Its quiet white surface keeps the capture state and large real
timer central, with source selection and the current action grouped in a compact
dock.

The interface uses familiar system typography, restrained green controls, and
thin dividers. A red recording indicator and track make active capture easy to
recognize. The compact window keeps connection settings out of the first view
until requested, and the Savia/Hefesoft attribution remains visible in the
capture footer.

**Key Characteristics:**

- Compact, single-purpose recorder with a clear Savia handoff.
- Real timer and state-led Start, Stop, and Upload action.
- Flat neutral surfaces with restrained green and state-specific red.

## Colors

The palette is mostly white and soft gray-green neutrals; emerald marks actions
and connection, while muted red marks active recording or capture errors.

### Primary

- **Savia Emerald**: Primary actions, selected audio sources, and connected state.
- **Deep Action Green**: Hover state for the primary action.
- **Pale Green Wash**: Soft green emphasis where a quiet selected treatment is needed.

### Neutral

- **Ink**: Main headings, timer, and primary text.
- **Muted Green Gray**: Supporting copy and connection details.
- **Cool White**: Main application surface and fields.
- **Mist**: Page canvas and subtle controls.
- **Divider Gray**: Quiet borders and section separators.
- **Focus Green**: Visible keyboard focus outline.

### Named Rules

**The State Color Rule.** Green communicates an available or selected action;
red is reserved for active recording and capture errors.

## Typography

**Display Font:** Platform system UI (`-apple-system`, BlinkMacSystemFont,
Segoe UI, sans-serif)
**Body Font:** The same platform system UI stack.

**Character:** Familiar, compact, and easy to scan. The timer is the largest
element; supporting labels stay small while remaining legible.

### Hierarchy

- **Display** (450, 56–72px, 1.05 line-height): Tabular elapsed time, sized responsively to the utility window.
- **Title** (650, 14px, 1.2 line-height): Companion name in the header.
- **Body** (400, 12px, 1.45 line-height): Source labels, helper text, and short messages.
- **Label** (600, 11px, 1.2 line-height): Connection status and compact settings labels.

### Named Rules

**The Timer First Rule.** Give elapsed time the strongest type scale, but keep
the capture state and available action visible alongside it.

## Layout

The native window opens at 380 × 540 px and has a 320 × 460 px minimum. The app
content is a centered, vertical column capped at 480 px, with 18 px horizontal
padding (14 px at widths up to 360 px). Header, flexible recording stage, and
capture dock form the main stack. At heights up to 500 px, the stage tightens
its vertical padding and the timer scales down.

The capture dock stays in normal document flow rather than sticking over the
content. Opening connection settings inserts a bordered panel below the header;
at shorter window sizes, the page can scroll to reach the stage and controls.
At narrow widths, header and source-control gaps tighten while labels remain
visible. Keep the primary capture action and attribution accessible without
horizontal scrolling.

## Elevation & Depth

The surface is flat by default and uses no container shadows. Thin neutral
dividers, subtle background changes, and borders distinguish the settings panel
and capture dock. Keyboard focus uses a clear offset outline rather than a
shadow glow.

### Named Rules

**The Flat Surface Rule.** Separate content with spacing, tone, and fine borders;
do not add ambient shadows to the utility surface.

## Shapes

Controls use gently rounded corners (7–9 px); the settings panel and brand mark
use a more open 10–12 px radius. Toggle tracks and status lights are circular or
pill-shaped. Borders are thin and low contrast, with a stronger green outline
for keyboard focus.

## Components

### Header

- Keep the Savia Companion identity and connection status on the left, with the
  “Open in Savia” link and settings disclosure on the right when connected.
- The settings control has a visible expanded state and an accessible label.
- The connection panel appears inline under the header; it does not cover the
  recording surface. Its URL and credential fields are compact and visibly
  labeled.

### Recording Stage

- Center the current state and elapsed timer in the flexible middle area.
- Use tabular numerals for the timer and a thin 3 px duration track capped at
  300 px. The track follows elapsed capture time and turns red while recording.
- Show separate captured-source details when a take is ready. Do not imply
  waveform analysis or audio quality.
- The recording light may pulse gently; respect reduced-motion preferences.

### Local Source Preview

- After capture stops, offer an explicit Preview action for each source with
  completed chunks, including a recovered draft. Show a loading state while the
  app reads and assembles that source from the native spool.
- Keep preview local and source-specific. It does not require API credentials,
  upload permission, upload consent, or a provider call, and it never uploads
  automatically.
- Bound each assembled preview to 64 MiB. Preserve chunk order and validate the
  stored native segments before making the local audio player available.
- Treat preview URLs as temporary. Release them when a new recording replaces
  the draft, when the user discards it, and when the view is destroyed.
- Keep durable recording history, cross-session playback, transcripts, and
  summaries in Savia's authenticated review surface.

### Source Controls

- Present microphone and system audio as independently labeled switches.
- Use a quiet gray track when off and the primary green when on. Keep the
  30 × 18 px track, visible label, and keyboard focus treatment together.

### Buttons

- **Primary:** A full-width emerald action with a 9 px radius and 44 px minimum
  height. Its label follows the state: Start recording, Stop recording, or
  Upload recording.
- **Hover / Focus:** Darken on hover; show a 3 px green offset outline for
  keyboard focus.
- **Active:** Press down by 1 px. Reduce transitions and animation to near-zero
  when reduced motion is requested.
- **Secondary:** Discard is a compact white button with a fine border and stays
  visually subordinate to the current capture action.

### Consent and Footer

- Show the upload-permission checkbox when a recording is ready, next to its
  explicit consent statement.
- Keep a short privacy reminder near the action area to clarify that audio is
  not sent until the user chooses Upload. Local preview does not send audio.
- Keep “Savia — Desarrollado por Hefesoft SAS, Colombia.” in the persistent
  capture footer, including while recording and at the minimum window size.

## Do's and Don'ts

### Do:

- **Do** make the current recording state, real timer, source selection, and next
  action easy to identify at a glance.
- **Do** keep microphone and system audio selection independent.
- **Do** retain a ready recording and its upload identity after an upload error
  so the user can retry.
- **Do** keep consent, privacy copy, and attribution legible in the compact
  window.
- **Do** preserve visible keyboard focus and reduced-motion support.

### Don't:

- **Don't** place transcripts, summaries, recording history, or cross-session
  playback in this capture utility; Savia is the review surface. A preview of
  the current stopped draft, separated by source, is allowed.
- **Don't** hide connection settings in the first view behind a large setup
  form.
- **Don't** show invented waveform activity or decorate the timer with
  nonfunctional motion.
- **Don't** upload captured audio before the user chooses Upload and provides
  the required consent.
