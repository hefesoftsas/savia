# Insurance quoting

Owner: Savia maintainers. Last reviewed: 2026-10-07.

Step-by-step auto quote flow (`savia.insurance-quoter` + `insurance.quotes`).
Each selected insurer product runs as its own independent flow; products run
concurrently and each provider flow executes its steps sequentially.

## Conversational WhatsApp quote pilot

The opt-in virtual employee channel uses the same canonical quote contract and
shared insurance operations as the authenticated assistant. Publish an employee
with access to `cotizaciones` and `cotizaciones_detalle` under a task label such
as **Consultar seguros**. The tenant must have the insurance solution installed,
its Savia Request bundle prepared, and enabled products configured.

Vehicle lookup is cached for the unchanged plate in the encrypted employee
draft; retries require an explicit request. Supplied vehicle and applicant
fields survive subsequent turns. After canonical validation, the server requests
explicit data-processing consent for those specific fields; changed fields
invalidate consent. A separate server-issued preview and confirmation are
required before creating a quote or calling enabled insurer products.

A stable execution key supports existing record-create idempotency. The contact
ownership link is persisted before provider dispatch, and each product receives
a durable dispatch claim. A lost dispatch acknowledgement becomes uncertain and
is never automatically replayed. Customer summaries return only that contact's
own completed or uncertain channel results; linked advisers use their own tenant
permissions.

WhatsApp result messages retain verified priced offers even when another insurer
request is uncertain. They distinguish failed, unverified and unpriced responses,
include relevant persistence warnings, and label results as partial when any
requests fail or return unverified or unpriced responses. Human support is
suggested when no priced offers are received; verified priced offers remain
available without an automatic adviser referral. Unverified requests require
history review before quoting again and are never automatically repeated.
Prices alone do not
establish a coverage recommendation. Internal CRM links stay out of customer
messages.

After Meta acknowledges a result send, its text is saved to the originating
contact, access generation and employee's conversation history, together with
the outbound message ID. Follow-up questions therefore receive the delivered
result as context. Duplicate delivery attempts do not send or record it twice;
uncertain sends are not recorded as delivered and are never automatically retried.
Current access checks and the reply window still apply.

If the history transaction fails after a send acknowledgement, the channel saves
the outbound ID, exact message text and send time in a `history_pending` delivery.
The scheduler retries only the history write, under the original access scope,
without sending again or requiring a new reply window. Preparation failures
before a send attempt can retry; an attempted send without an acknowledgement
remains uncertain.

The pilot test uses simulated provider responses and a synthetic vehicle. No
real insurer call is made by the test. See the
[WhatsApp channel runbook](runbooks/nango-whatsapp.md#task-menu-and-virtual-employee-channel)
for settings and a separately authorized live pilot.

## Quote explanations and shared results

Confirmed WhatsApp quotes collect a public proposal for every configured product.
Intermediate WhatsApp messages include confirmed positive premiums and a bounded
summary of up to eight verified coverage and deductible facts, without waiting
for model analysis. Complete facts stay in the public report. Failed, unpriced,
and uncertain responses are summarized once at the end. The terminal message
lists up to five priced proposals, including offers outside the lowest-price
group, with a compact evidence summary; older results without proposals retain
their lowest-price summary. Terminal guidance, persistence warnings, the public
link, and the task menu reserve space before optional coverage summaries. Internal action
references and provider transaction numbers do not appear in these messages.
Public reports have a separate short customer reference.
Only confirmed premiums and an explicit allowlist of coverage and deductible
fields returned by the provider are included. Static catalog profiles are not
verified coverage evidence. WhatsApp and public forms share the same provider
fact projection. It accepts normalized `coverages`, canonical `coverageDetails`
(`label`, `limit`, `deductible`), and returned `response.amparo` entries
(`nombre`, `capital`, `tdeducible`/`deducible`). Reports retain up to 40 facts,
including zero deductibles; zero capital is shown as reported and never treated
as unlimited coverage. Missing values remain explicitly unreported. Unknown
fields, contacts, and raw payloads are excluded.
Failed, unpriced, and uncertain proposals remain
visible as such; they do not acquire estimated premiums.

The assigned employee's configured LLM explains priced proposals in asynchronous
batches while provider calls continue. The final analysis gives comparison
guidance and identifies missing evidence. Equal prices without verified coverage
do not justify a winning proposal. Model calls have a twenty-second deadline,
no tools, and no automatic retries. A model failure preserves provider results
and the customer link, with analysis availability clearly indicated.
Analysis disables model reasoning to reserve the bounded output budget for the
customer explanation. The OpenRouter adapter sends a strict JSON schema through
the provider's structured-output API and requires compatible provider routing.
An explicit null preference means no verified preferred proposal and is normalized
to the public report's optional field. Local validation still checks proposal IDs
and unsafe output. Schema failures record at most five static field paths and
validation codes, without rejected values or model error messages.
Model input includes only priced proposals and the count of remaining options.
Identical facts are sent once, with explicit indices attaching each fact to its
proposal. Distinct limits, deductibles, and evidence sources remain distinct;
proposals without facts never inherit another proposal's evidence. The public
report retains the full evidence for every offer.
The private action result and structured diagnostics
identify safe reasons such as unavailable configuration or authorization,
timeout, malformed or truncated output, and proposal ID mismatch. They do not
retain prompts, model responses, credentials, or contact details. Batch and
final-analysis outcomes are logged separately.

The final WhatsApp message includes an opaque public link to a read-only report.
It expires seven days after creation and contains offers and saved analysis,
without applicant documents, contact details, raw provider responses, or internal
CRM links. Opening the report does not call the model or insurers again. Report
responses and the public page use `no-store`; unknown, expired, and revoked links
return the same unavailable result.
Production, preview, and local admin Worker configs route `/public/quotes` and
`/public/quotes/*` through the gateway so these responses retain their security
headers instead of falling through to the static single-page app.

Tenant administrators can inspect and revoke these links in the quote screen's
public-link settings, under shared quote results. Revocation is tenant-scoped
and requires authenticated administration access. Sharing a result does not
create a new quote or grant access to the authenticated workspace.

## WhatsApp intake

The quote plugin exports a static WhatsApp Flow intake contribution through the
release catalog. It identifies `insurance.quotes`, the `savia.insurance-quoter`
solution and the `insurance-auto-light` Savia Request bundle, and returns the
same validated `vehicle` and `applicant` shape used by the quote wizard. The
Flow collects vehicle, applicant, contact and explicit data-processing consent.
Flow completion is untrusted input and must be validated again by the server.

This contribution collects information only. It does not enable provider
execution, choose products from contact messages or start quotes. A tenant must
install the `insurance.quotes` plugin and `savia.insurance-quoter` solution,
enable products and vehicle lookup in that tenant's quote settings, and prepare
the matching `insurance-auto-light` Savia Request bundle with that tenant's
provider credentials before a trusted server flow can request quotes. The Meta
WhatsApp Business account must also have the Flow created and published before
it can be sent.

Future execution must resolve allowed products from the tenant's saved settings
and invoke the existing trusted quote action with the validated canonical
input. It must use durable idempotency for a completed Flow submission and keep
provider execution out of AI tools. Receiving a questionnaire is not a quote;
quote results and their CRM history should follow the existing quote lifecycle.

## Performance

Provider calls in confirmed WhatsApp execution have a 30-second request deadline;
persistence requests retain a 15-second deadline. Both remain capped by the
90-second total execution budget. A completed response received within the
provider deadline is used immediately; expiry never triggers a replay.

- Quote startup records elapsed time for setup (`setupMs`), CRM persistence
  (`crmMs`) and each product flow (`duracion_ms` per detail, surfaced as
  `products[productId]`). These diagnostics are not printed in the customer results view.
  Provider durations remain available in persisted details.
- The configured client is resolved with a server-side match query
  (`filters: { logic: "and", conditions: [{ field, op: "eq", value }] }`)
  through the plugin collection API. The full collection scan (up to 2,000
  records) remains only as a compatibility fallback for hosts without filter
  support.
- Quote execution never waits for a full CRM scan before launching product
  flows. After a bounded initial CRM wait, the master record is created; a late
  `cliente` link is saved together with its final summary. A 4s early-client race avoids holding
  providers on slow CRM collections. CRM failures are visible
  ("La cotización continuó sin guardar el cliente en el CRM…") instead of
  silently blocking providers.

## History loading

- Plugin collection requests use the authenticated backend transport, including
  ZIP iframe plugins. A browser outbox acknowledgement is not a committed quote:
  local creates have no server version and previously caused result updates to
  be skipped. Both history reads and writes now use the server source of truth.
- Each successful provider saves its detail and updates the master summary
  without waiting for the remaining providers. One successful offer means
  `Recibida`, even when other products remain pending or fail. Pending products
  retain their own status and do not hide completed offers.
- This change prevents new results from being lost on reload. Earlier detail
  rows that contain no saved response cannot be reconstructed by refreshing
  history; they require an explicit retry.

- Selecting a saved quote performs reads only and never invokes a quote
  action or lookup flow. Retries stay explicit via retry controls.
- History loads only the child details of the selected master with a
  server-side filter (`cotizacion eq quoteId`, or `or` with the historic
  reference name). It pages the filtered result instead of scanning every
  quote's details.
- The UI shows a loading state while details load and an error state on
  failure; an empty result is never presented as a successful load.
- Pending details older than five minutes, or without a usable update/create
  timestamp, are treated as stale failures in history so they can be retried
  instead of remaining "in progress" indefinitely.

## Result snapshots

`cotizaciones_detalle` persists an allowlisted, normalized snapshot per
product so history renders after reload or after recent action runs expire:

- `resultado_snapshot` (Textarea, JSON): `provider`, `productName`,
  `premium`, `quoteNumber`, `monthlyInstallment`, `score`, `badges`,
  `coverages` (9 keys), `highlights`. No raw provider payloads or applicant
  data.
- `duracion_ms` (Number): per-product execution time in ms.

History rendering prefers the snapshot when no matching run is in memory;
absent runs are never treated as empty coverage data. Live sparse responses
keep the honest "No informado por la aseguradora" view.

## Deleting history

- The history view groups retry and delete actions. Delete uses a quiet trash
  action and a separate confirmation with the selected reference and a
  destructive submit button; mobile controls have full-width confirmation actions.
- Deletion removes child details first, then soft-deletes the master with its
  current version. Child deletion failure retains the master for recovery;
  the selection clears immediately with a pending notice. The master is restored
  to the history list on failure, and the server state is refreshed for recovery.
- Supported hosts submit child deletions through the existing versioned bulk API
  in groups of up to 200. A 19-product quote normally uses four requests (list,
  bulk delete, master read, master delete), instead of about 41 sequential requests.
  Version conflicts remain visible and prevent deletion of the master.
- This is optimistic UI backed by online commits, not a durable offline delete
  queue. Reloading during a pending operation reads the actual server state.

## Data model

- `cotizaciones` master + `cotizaciones_detalle` (relation
  `cotizacion → cotizaciones`, no `onDelete:clear`, so children-first delete
  is required). Detail adds optional `resultado_snapshot` + `duracion_ms`.
- Plugin collection `list()` accepts `filters` and `q`, forwarded as
  `?filters=JSON&q=` to `GET /api/records/:object`, which already supports
  `eq/ne/contains/in/…` via `buildWhere`.

## Compatibility and recovery

- The quote plugin declares the master and detail collections for new installations.
  Existing fields and custom layouts are preserved; installation adds missing
  optional fields with a versioned schema update. Before saving optional snapshots
  and durations, the wizard reads the actual detail schema (once per mounted
  collection handle). On older schemas it saves core status, premium, quote number,
  and run reference, and explicitly warns when coverage details cannot be stored.
  Failed writes are surfaced instead of silently leaving history pending.
- Late CRM linking is saved with the terminal master update, avoiding concurrent
  writes using the same version.
- History ignores responses from an earlier selection. Empty saved quotes never
  borrow unrelated recent runs. Saved pending details show a refresh action rather
  than claiming a live provider request is running.
- Deletion reads current child and master versions immediately before removing
  them. Version conflicts remain visible; deletion never retries a conflict without
  the required version. Client-side ownership checks also isolate results returned
  by legacy hosts that ignore collection filters.

- Retrying one or all providers recalculates the master premium from all successful
  offers, so a more expensive retry cannot replace the best price. Summary writes
  are serialized and read the current master version before saving.
- Resuming a quote replaces reselected provider flows instead of duplicating them.
  Starting a new quote or deleting the active quote is blocked while retries run.
- Changing saved quotes resets the insurer filter. A deleted quote's deep link is
  cleared, and deleting one quote cannot clear a newer selection.

## Standalone quote plugin styles

Both quote store variants bundle `quote-screens.css` with their executable
entry. The configuration screen uses its own `insurance-package-*` classes,
rather than portfolio classes supplied by Admin. Loading messages use the
included `insurance-sr-only` accessibility style. Both store adapters share
`store-ports/quotes/entry.css` for their tabs, including selected and keyboard
focus states. This keeps these screens styled inside the isolated iframe.

Rebuild both artifacts after changing the shared styles:

```bash
pnpm store:pack store-ports/quotes
pnpm store:pack store-ports/quotes-ui
node --test scripts/store-ports.test.mjs
```
