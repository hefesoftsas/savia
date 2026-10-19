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

In the native conversation, the answer copy action is left-aligned below its sources.
Users can copy an individual assistant answer or the
complete provider conversation. The conversation copy includes the provider title,
message roles, answer text and available citation labels and excerpts. Providers
must return the complete history or report a bounded-history error; they must not
silently truncate it. Opaque message and citation identifiers are omitted; short
human-readable citation references are kept. Copying uses the browser clipboard
and reports success or failure in the conversation.

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

## Source and task actions

Citations may advertise `canOpen: true`. The host sends an `open-source` request
with the assistant message ID and citation ID to the bound provider; the provider
returns an optional `source: { url, page? }`. Only HTTPS links without embedded
credentials are accepted. Providers must authorize the stored conversation,
source version and context before issuing a short-lived read link; never accept
arbitrary document URLs from the browser. The host reserves a new tab during the
click to avoid popup blocking and closes it on failure or context change.

An optional launcher `taskCollection` enables explicit task creation into an
extension-owned collection using normal authenticated record CRUD and collection
ACL. It does not grant new permissions or create workflow tasks. The collection
uses `name`, `description`, `assignee`, `due_date`, `status`, `source_key` (unique),
`source_context`, `source_reference` and `source_url` fields. Providers may return
bounded per-message `taskSuggestions` with an ID, title, description and citation
IDs. The user selects a suggestion and reviews the title, responsible person's
name and due date before saving. Suggestions represent work to verify, not proof
that a company fails a requirement. Source references and bound context accompany
the task; a stable context/suggestion key makes retries reuse the original record.
No task is saved by opening the form, and this capability does not send workflow
assignment notifications. Tasks can be edited and completed in the collection's
native records screen.

## Generate a provider document

Providers may return up to four unique `documentActions` with `{ id, label, format: "docx", fileName? }`.
The native chat renders these bounded actions near its header. When no saved draft exists, a click invokes
`{ method: "generate-document", actionId }` through the same authorized provider
and bound context; it does not send a chat message or replace the saved history.
The provider returns `{ revision: 0, messages: [], document: { url, fileName, format: "docx" } }`.
The HTTPS download URL must not contain embedded credentials, and the file name
must be a bounded safe DOCX name. A context change revokes an unfinished download.
Generation and failure states are visible, and errors can be retried explicitly.

The SECOP provider generates an editable proposal using the current dossier and
selected company profile. It checks the current complete report index and includes
the saved requirements and source references, evidence gaps and review cautions.
Missing company data, prices, experience and declarations remain placeholders;
company evidence is not automatically treated as a verified compliance decision.
The SECOP backend returns a short-lived private attachment that the host imports into the Savia Office suite before opening the editor.
No SECOP proposal logic or client-side persistence is added to Savia core.

### Generated documents in the Office suite

The host exposes the generation action only after the current workspace Office policy is available and enabled. Disabling Office hides the action and cancels pending imports. The host fetches an advertised DOCX using its short-lived HTTPS URL without sending cookies or authorization headers to the provider. The provider must allow credential-free CORS reads. Savia validates and uploads the bounded file through its existing authenticated Office documents API, storing private bytes in R2 and metadata and versions in D1. Only after this save succeeds does the host open the native WASM editor. Users can reopen the saved document from Office suite, including after refreshing the page. A blocked popup does not discard a saved document: the action retains an Open document link. Changing provider or principal context cancels pending fetch/upload/navigation. The host first looks up a stable source key derived from the provider connection, action and canonical context, excluding transient session IDs. The key is unique per active tenant and owner. An existing draft opens at its current saved version without generation or upload; concurrent imports reuse one document. Saved edits are never overwritten. Providers may advertise a stable `fileName` to adopt the newest exactly named, owned legacy draft. Adoption is persisted on the server and cannot rebind a document already linked to another source. Lookup failures stop the action rather than creating a duplicate.

The connected chat uses icon actions with tooltips and accessible names. On larger screens, Expand chat and Restore chat size change the reading width without reloading the provider or discarding the composer draft.
