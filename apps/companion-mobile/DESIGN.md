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
