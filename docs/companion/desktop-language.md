# Companion desktop language

Savia Companion includes Spanish, English, and Portuguese interface text. At
launch, it reads the current WebView language supplied by the operating system
and selects the matching supported language (`es`, `en`, or `pt`). Regional
tags such as `es-MX` and `pt-BR` use their primary language. Unsupported or
missing language settings fall back to Spanish.

The Language control in Connection settings changes the current window only.
That choice is held in memory and is not written to browser storage, native
preferences, Savia, or a provider. On the next launch, Companion detects the
current operating-system/WebView language again. Changing the interface
language does not connect to Savia or change recording, upload, or processing
consent.

Known native capture error codes show translated permission or recovery
guidance. Other operation failures use a translated generic message; raw native
diagnostic text is not shown in the interface.

API addresses and credentials remain governed by the connection flow; language
selection does not save or transmit them. See the [Companion guide](../../apps/companion/README.md)
for setup, local preview, explicit upload, and recording privacy details.

Connection settings keep the native remember checkbox at a fixed size beside
its label and keychain tooltip. Diagnostics form a separate group below the
connection action, with their own spacing and divider; long exported filenames
wrap within the compact window. These controls use the same layout in all three
languages.

The local meeting inbox, upload state, deletion confirmation, source fallback
notices, and combined preview controls support all three languages. Secondary
guidance is available in keyboard-accessible tooltips; permission errors and
upload consent remain visible. Meeting names persist in native metadata and
are not translated when the interface language changes.

The initial permission notice, acceptance action, and reset action are translated
in all supported languages. Acknowledgement is a separate native preference;
language selection remains temporary and does not alter the acknowledgement.

Inline name editing has translated save, cancel, and validation labels. SVG
actions keep translated accessible names and tooltips. Custom meeting names
remain user-authored values when the interface language changes.
