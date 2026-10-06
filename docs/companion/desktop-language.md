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
