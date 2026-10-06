# WhatsApp as a general virtual employee channel

Status: revised specification, awaiting written-spec review.
Date: 2026-10-06.
Supersedes: `2026-10-06-whatsapp-alice-quoting-design.md`.

## User intent

WhatsApp is a channel for the virtual employees already available in Savia.
Insurance quoting is the first end-to-end test, not the channel's architecture
or its only purpose. Administrators can expose any active tenant virtual employee
to the integration. Contacts choose what they want to do through a WhatsApp
list of tasks, without needing to know the employees' names or specialties.
Each task routes to its configured employee. Replies identify that employee,
and contacts can return to the main menu at any time using `menú` or `inicio`.

The user requested both internal and external audiences. An administrator-owned
registry of staff phone numbers determines whether a contact is internal.
Other contacts are external. The existing pilot contact allowlist determines
whether a contact may receive replies; it does not determine staff membership.

Reuse each selected employee's identity, prompt, model, knowledge, and authorized
capabilities from Savia. Do not clone employees or build an insurance-only bot.

## Current implementation

- `apps/api/src/assistant/virtual-employees.ts` provides tenant-scoped active
  employees, names, handles, greetings, prompts, models, and collection scopes.
- `apps/api/src/whatsapp/assistant-routes.ts` and the admin WhatsApp assistant
  settings currently select one employee for the connection and a pilot contact
  allowlist. They cannot yet expose a selectable employee roster.
- `apps/api/src/whatsapp/inbound-repository.ts` stores contact history and inbox
  snapshots tied to that connection-wide employee. Per-contact selection requires
  changing those snapshots and history scope, not only changing the dropdown.
- `apps/api/src/whatsapp/native.ts` supports native list replies with up to ten
  options; `native-input.ts` preserves choice IDs and outbound reply context.
- The WhatsApp completion currently has no tools. Savia chat has a scoped tool
  registry and authenticated pending-action confirmation. Its capabilities must
  be shared through explicit channel authorization, not by forwarding an owner's
  unrestricted bearer credentials to all contacts.

## Selected architecture

Build a generic WhatsApp employee router and a shared assistant capability layer.
Use existing active employee records as the source of truth. A tenant administrator
configures which employees are published to the connection, their task label and
description, ordering, and availability to internal/external contacts. Task labels
are mandatory customer-facing configuration, not employee names or AI-generated
guesses. Initially each published employee contributes one configured task entry.

The effective capability set is the intersection of the selected employee's
configured scope, installed solution capabilities, channel publication policy,
and the caller's current access. Both Savia chat and WhatsApp consume shared
descriptors, validators, and handlers. Channel-specific rendering and confirmation
remain adapters around that shared behavior.

Prompt-only reuse would leave WhatsApp unable to act. Automatically exposing
every tool to every contact would ignore caller identity and ownership. A separate
implementation for each assistant would drift from Savia. The shared capability
layer plus deterministic router addresses these problems without assuming an
industry in platform core.

## Integration settings and staff classification

The integration configuration includes enabled state, published employee roster,
optional single-employee default, existing pilot contact allowlist, and staff
number registry. Administrators select employees from the active tenant employee
list, not from a second independently maintained assistant catalog.

Staff registry entries contain normalized international phone number, label,
active status, optional linked Savia principal, and audit timestamps. An active
entry is the sole classification authority: saved staff number means internal;
absence or inactive entry means external. An arbitrary phone address book or
CRM client record does not classify someone as staff. Messages cannot add entries,
choose another principal, or self-promote.

A linked principal must have current active tenant membership. Internal status
selects the internal menu and channel policy; it does not grant administrator
rights or access to another user's personal integrations. Staff without a linked
account receive only capabilities explicitly assigned to that internal channel
profile. Capabilities requiring user identity remain unavailable until linked.
Linked staff receive the intersection with their current Savia permissions.
Personal account operations require an explicit authorized account context;
never use the connection owner's mailbox, calendar, or files as a fallback.

External contacts use an explicit external capability profile. This can expose
customer-facing actions such as their own quote intake and results, but cannot
expose arbitrary collection reads or staff-only tools. Each action provider must
implement the required ownership policy before being published externally.

Retain signed webhook verification, tenant/sender/WABA resolution, connected
binding, and pilot allowlist. Staff classification never bypasses those checks.
Unknown numbers outside the pilot allowlist receive no automatic reply; allowed
unknown numbers are treated as external. Public onboarding beyond the pilot is
outside this milestone.

## Employee selection and response identity

1. Resolve contact admission and internal/external profile, then calculate its
   available published employees from current server-side settings.
2. With multiple available employees and no valid selection, send a deterministic
   task menu under “¿Qué deseas hacer?”. Example labels are “Consultar seguros”,
   “Consultar cartera”, and “Atención al cliente”, when configured and permitted.
   Do not display employee names or handles in the menu: the user chooses an
   outcome and the server maps it to the published employee. The model does not
   generate employee IDs, task mappings, or menu authorization decisions.
3. Use native WhatsApp lists when enabled. Support more than ten employees with
   pages of nine entries and one navigation row when needed. If lists are disabled,
   send a numbered text menu with equivalent paging. Bind selections to a saved
   menu revision and the contact; stale choices reopen the current menu.
   Validate published task titles at 24 characters maximum, descriptions at 72,
   and the list button label at 20, matching the existing native schema. Reject
   invalid settings at save time rather than truncating tasks into ambiguous names.
4. A selected row identifies the virtual employee, not an arbitrary executable
   command. Resolve the ID against the current contact-visible roster before
   storing the selected employee. Never trust a returned title for routing.
5. With one available employee, select it directly and show its identity. If none
   is available, return an accurate unavailable response without falling back to
   an unpublished employee. A configured default is usable only if visible to
   that contact.
6. Persist selection per tenant, connection, normalized contact, and access
   generation. Reserve `menú` / `menu` and `inicio` as global main-menu commands.
   Match the complete trimmed text after case and accent normalization; ordinary
   sentences containing those words are not routing controls. Recognize these
   commands on the server before model completion, regardless of selected
   employee, draft state, or pending confirmation. Clear selection, invalidate
   pending confirmations, and display a freshly authorized task menu without
   asking permission to switch. Preserve authorized drafts for an explicit return
   to their task. Show “Escribe menú para elegir otra opción” in the initial
   greeting and action previews. When no selection exists, preserve a normal
   initial task message and deliver it once to the chosen employee after selection;
   `menú` or `inicio` clears that buffered message instead of forwarding it.
7. Identify the responder on every generated text answer as “Alice · Asistente
   virtual” (using the selected employee's actual name). For interactive messages
   use the same identity in their supported body/header; for media-only messages
   use a supported caption or a separately tracked identity message. The server
   controls this label, accounts for Meta length limits, and prevents the model
   from impersonating another published employee.

Assistant greeting and prompt come from the selected Savia employee. A selection
can expose its capabilities without claiming to have performed an action.
Menu labels are untrusted display data, not instructions or permissions.

## History, switching, and revocation

Keep conversation history scoped by contact, selected virtual employee, and access
generation. Returning to the main menu is navigation, never confirmation or
cancellation of an already consumed action. Confirmed jobs continue with their
recorded authority and receive normal permission checks; selecting a new task
cannot create another execution of an existing action. Label any late action
result with its originating employee so it cannot appear to answer the new task.
Switching employees does not share another employee's conversation
or draft automatically. Returning to an employee restores its authorized draft;
handoff of context between employees requires an explicit user request and an
authorized, bounded summary.

Changing the roster, staff registry, linked principal, or effective permission
profile invalidates obsolete routing selections and pending confirmations.
Rotate the contact's access generation when its identity/profile changes; do not
inject history from an earlier access generation into the new assistant context.
Recheck access before each capability execution and outbound dispatch.

Inbox events snapshot the selected employee and access generation when accepted.
Routing/menu events are processed in the same contact ordering as task messages.
A queued message cannot be silently reassigned to the connection-wide default
after a selection change. A revoked employee/assignment fails closed and presents
a fresh authorized menu on the next eligible inbound request.

For migration, keep existing single-employee bindings in legacy mode until the
tenant explicitly enables routing. At cutover pause new admission, allow active
legacy leases to finish or expire, and terminally mark unstarted legacy inbox
rows as `routing_cutover` without sending or replaying them. Resume admission
under the new routing generation; the next inbound message opens the menu and
states when the previous request needs to be resent. Preserve responding/uncertain
outbound rows as terminal so cutover cannot resend them. Tag old history with a
legacy generation and its recorded default employee/contact; retain it for
authorized audit but do not inject it into newly classified staff/external
conversation contexts. Never infer staff status from historical allowlists.

## Shared capabilities and action confirmation

Separate generic employee orchestration from solution-specific handlers. Read
capabilities execute only after schema validation and access/ownership checks.
Each handler returns sanitized evidence; prompts alone never authorize tools.
Text-only employees remain text-only and may still be published in the menu.

Mutations prepare a typed, validated action and a server-generated preview. The
preview identifies the employee, intended operation, and relevant data. Execution
requires a deterministic channel confirmation; model text, a Flow submission,
or a generic conversational yes cannot approve it. Keep execution out of the
model's directly callable tools.

Use native confirm/cancel buttons with a cryptographically random 128-bit token.
When buttons are disabled, use a random 10-character uppercase base32 code with
an exact text instruction. Store only credential hashes, bound to tenant,
connection, contact, employee, profile/access generation, immutable action input,
and action revision. Default expiry is five minutes. Invalidate after five failed
attempts, rate-limit attempts per contact, and keep credentials out of model
context and logs. Switching employee, changing inputs, revocation, cancellation,
or expiry invalidates the preview. Atomic consumption permits one execution.

For linked staff, adapt the existing Savia read tools and supported prepared
commands, including Studio record changes and personal integration actions, to
this common confirmation and execution contract. Preserve current account and
collection permissions and resolve personal connections for the linked caller.
This is part of the general channel scope, not a separate insurance-only tool set.
Future installed solutions can register the same contracts. External publication
additionally requires a complete contact access/ownership policy for each
capability. Missing policies make a capability unavailable rather than silently
broadening access. Insurance is the first end-to-end validation scenario, not
the limit of the internal employee capability adapter.

## Durable execution and optional solution boundaries

Generic platform persistence covers published employees, staff entries, contact
selections, menu revisions, access generations, confirmations, and durable action
jobs. Solution packages own their data schemas, validation, ownership associations,
execution adapters, and result projections. Supply SQLite/D1 and PostgreSQL
migration/schema parity. Backend persistence is the source of truth.

After confirmation consumption, enqueue an action job and return progress. The
existing scheduler recovers undispatched jobs using fenced leases. Persist stable
execution identity and dispatch state before external calls. Duplicate webhook,
menu selection, confirmation, worker recovery, or outbound send failure must not
repeat a dispatched action. A timeout/crash after dispatch is uncertain: inspect
known state or require review, never automatically replay the external call.
Long-running work must use supported durable runtime execution rather than
depending only on an untracked `waitUntil` task.

Final delivery rechecks access and Meta's reply window. Retain results when
delivery is no longer allowed, so a later authorized inbound status request can
retrieve them. An uncertain send is recorded without automatic resend.
Audit selected employee, caller profile/principal, action, and outcome without
logging credentials or full personal/provider payloads. Apply tenant retention
and deletion rules to channel state and solution data.

## Insurance pilot acceptance

Publish Alice through the same roster as any other employee. Its insurance
capabilities come from installed `insurance.quotes` / `savia.insurance-quoter`,
canonical assistant contracts, enabled products, and the configured Savia Request
bundle. Provider credentials remain tenant-side. Package removal disables its
capabilities and undispatched jobs without disabling other employees.

The pilot must accept a plate, perform the enabled vehicle lookup once, resolve
city through DANE, preserve verified values, and ask at most three missing items
per turn. Collect explicit data-processing consent, validate the canonical form,
show a preview with configured products, confirm, run real configured product
actions, and summarize persisted offers/status without invented coverage.

Extract existing quote orchestration from `apps/mcp/src/savia-api.ts` into a shared
insurance service with authorized record/settings/action ports. Preserve Savia
chat behavior through its authenticated adapter. WhatsApp supplies its scoped
caller context and customer ownership association; do not borrow owner credentials.

Persist an action's intended master ID before record creation, create that stable
master, persist contact ownership, and transition to dispatch-ready only after
both exist. Recovery completes a missing link using the same master ID. If the
record API lacks stable server-created IDs, add that internal support first.
Never dispatch a provider call or expose a customer result without ownership.
Customers can read only channel quotes associated with their contact/access
assignment; linked advisers use their current authorized record scope. References,
plates, and document numbers alone do not establish customer ownership.

## Verification and rollout

- Admin can publish any active tenant virtual employee, define audience visibility,
  and classify staff through explicit registry entries without cloning assistants.
- Contacts see only their permitted roster; native and text menus paginate and
  reject stale, forged, other-contact, unpublished, inactive, or cross-tenant IDs.
- Menus show configured task labels rather than employee names. Each selection
  reaches its mapped employee. `menú`, `menu`, or `inicio` returns to the main
  menu from any conversation state, cancels pending previews, clears buffered
  initial input, and allows another task without duplicating confirmed jobs.
- Selection persists, replies identify the actual employee, histories remain
  isolated, and switching handles drafts and pending confirmations deterministically.
- A pilot allowlisted external number never becomes staff merely because it is
  allowed to chat. Staff removal, membership revocation, and account-link changes
  revoke stale capabilities and approvals before execution or delivery.
- Same-employee reads and prompts behave consistently with Savia under equivalent
  permissions. External contacts cannot read another customer's data or access
  a connection owner's personal integrations.
- A linked internal contact can use authorized existing Studio and personal
  capabilities through the chosen employee, including preview/confirmation for
  supported writes; unlinked staff cannot use identity-dependent operations.
- Confirmation expiry, wrong-code limits, replay, concurrent workers, mid-write
  recovery, and uncertain provider/send outcomes cannot duplicate external actions.
- The Alice insurance conversation reaches persisted provider results and status
  reads using the shared quote service; other employees work without insurance.
- Existing single-employee text bindings retain their configured default and pilot
  allowlist during migration. New action capabilities are opt-in.

Run focused routing/profile/capability unit and contract tests, signed-inbox
integration tests, shared Savia quote regressions, PostgreSQL schema/dialect
checks, and relevant typechecks. Update the WhatsApp runbook and assistant guide;
update the insurance guide for the pilot. Generate API docs through OpenAPI.

Roll out to explicit tenant/contact pilot settings, initially with mocked external
execution. Real insurer calls and deployment require separate authorization.
This milestone revises the specification only; written-spec review precedes the
implementation plan and execution-method selection.
