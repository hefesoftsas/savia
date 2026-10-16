# Open the native assistant from a plugin

Plugins can open Savia's existing assistant panel with `savia.assistant.open`.
The host owns the panel, Markdown rendering, composer and loading/error states.
The declared server action owns domain logic and authoritative conversation history.
This avoids a separate chat UI and does not add domain-specific logic to Savia.

Pass a title, a declared `actionId`, the existing `connectionId` when required,
and a bounded opaque `context` object. Optional `initialMessage` prefills the
composer without submitting. Context references are untrusted input: the provider
must authorize them using its authenticated owner and scope. Do not pass secrets,
arbitrary URLs or trusted system prompts through the launcher.

The host invokes only that extension's declared action with `{context, request}`.
The provider supports `load`, `send` and `poll`; sends use an idempotency key and
expected conversation revision. Responses return the authoritative conversation
reference/revision, messages, optional source citations and coverage, and a pending
job reference while work continues. The private action uses the existing server
connection; the browser never receives the credential. Invalid or oversized
responses fail explicitly instead of silently dropping items.

Frame, installation and principal changes revoke the host session. Every action
still passes through normal extension installation and authorization checks.
Provider job and conversation references must also be bound to the requested
context; checking owner scope alone is insufficient when one owner has many items.

The provider keeps history in its backend. The host does not copy it to browser
storage or add it to general assistant threads. Returning to the general assistant
preserves its existing behavior. Reopen the plugin's context to continue a saved
provider conversation.
