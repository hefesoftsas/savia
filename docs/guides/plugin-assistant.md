# Open the native assistant from a plugin

Plugins can open Savia's existing assistant panel with `savia.assistant.open`.
The installed plugin shell exposes the same capability as the shared SDK factory,
including active panel scope and host error propagation. Its script URL carries a
revision derived from the generated source so host SDK fixes refresh independently
of the immutable plugin artifact version.
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

Frame, installation, active reusable-panel and principal changes revoke the host
session. Only the current panel activation may open or invoke its provider. Every action
still passes through normal extension installation and authorization checks.
Provider job and conversation references must also be bound to the requested
context; checking owner scope alone is insufficient when one owner has many items.

The provider keeps history in its backend. The host does not copy it to browser
storage or add it to general assistant threads. Returning to the general assistant
preserves its existing behavior. Reopen the plugin's context to continue a saved
provider conversation.

## Keep plugin screens addressable

Installed plugin screens can use `savia.route.get()`,
`savia.route.set({ item: "public-id", tab: "summary" })`, and
`savia.route.subscribe(listener)` to restore public view state after refresh or
Back/Forward navigation. Pass `{ replace: true }` as the second argument to
replace the current history entry. Setting an empty object clears the current
plugin's view state. Plugins must load the referenced records from their authorized
backend, validate returned identifiers, and cancel stale restores.

The host prefixes query keys with `plugin.<extension-id>.`, preserves tenant,
screen and other extensions' parameters, and rejects this API from panels and
widgets. Keys and string values are bounded. URL state never grants access;
normal backend authorization still applies. Never include credentials, evidence,
private conversation content or personal data in a URL.
