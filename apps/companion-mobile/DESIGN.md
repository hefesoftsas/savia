# Mobile Companion visual system

Extends `../companion/src/styles.css`. Operate mode: users record and review
private audio on a phone in variable ambient light. Light neutral surfaces keep
long transcripts legible; system typography and platform controls support
familiar touch and accessibility behavior.

- Emerald seed `#176647`; neutral page `#f6f8f7`; restrained error red.
- Material 3 semantic colors, system type and minimum standard touch targets.
- Library and capture are the two primary destinations. A recording detail is
  subordinate to its library; back returns without losing the server list.
- Scrolling content with 24px gutters; readable maximum width 720px, connection
  maximum 560px. Scalable text, explicit control labels, no fixed content heights.
- Preview, account and workspace remain in the app frame. Processing and upload
  consent are adjacent to their respective actions. Drafts are visibly temporary.
- Loading, unavailable permissions, provider errors, empty library and unknown
  upload outcomes use text and semantic state, not color alone.

The design is inherited from the approved mobile specification. It does not
introduce a new visual identity. App UI is localized in English, Spanish and
Portuguese; server content is shown in its original language.

## Refinement: task hierarchy

The shared Flutter theme in `lib/theme.dart` pins the desktop palette instead of
letting seed-generated colors drift. Semibold page/section titles contrast with
muted recording metadata. Inputs use white surfaces; controls have 12px corners
and at least 52px height while remaining free to grow with text.

Library rows use a quiet emerald audio mark and a separator. Capture has one
focused microphone surface; draft metadata and consent follow the reading order.
Recording details separate playback, saved notes and questions with spacing and
rules. Errors have a semantic icon and readable tinted surface, without relying
on color alone. No decorative animation or fabricated waveform is introduced.

Layout verification includes 320px phones at 200% text and 768px tablet layouts.
Rendered fixtures are visual evidence only, not proof of device recording or
provider processing.
