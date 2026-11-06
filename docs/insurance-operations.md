# Insurance operations plugins

Owner: Savia maintainers. Last reviewed: 2026-09-19.

Savia includes ten optional operations plugins in its compiled release catalog.
The collections and renewals workflows are described first; claims, commissions,
endorsements, opportunities, activities, issuance, documents and service follow below.

The initial pair owns these collections:

| Extension               | Label        | Owned collection        |
| ----------------------- | ------------ | ----------------------- |
| `insurance.collections` | Cartera      | `insurance_receivables` |
| `insurance.renewals`    | Renovaciones | `insurance_renewals`    |

Each workspace installs and activates them independently under **Manage screens →
Packages and extensions**. Installation creates the missing collection, preserves
compatible existing schemas, and rejects incompatible schemas without activating
the extension. Repeating installation repairs a missing collection. No sample
records are created, and the existing policy dashboard remains separate.

## Collections

Create an account with a reference, customer, due date, original amount and paid
total. Policy reference, insurer, owner, next follow-up and management notes are
optional. All amounts are COP with at most two decimal places.

The worklist shows outstanding balance, overdue balance, balances overdue more
than 60 days, and settled account count. Filter by overdue/current/settled status,
payment commitments, or entries requiring review. Search reference, customer,
policy, insurer or owner, and combine that search with the management-stage filter.

Open **Manage → Register payment** to record a received partial or full payment.
The action updates the paid total and latest payment date on the account using its
record version. Entering an older receipt preserves the more recent payment date. It rejects zero, negative, over-precision and excess payments.
This records a collection; it does not transfer money. There is no separate
payment ledger, automatic reconciliation or payment reversal in this release.
The editable paid total supports corrections under ordinary CRM permissions.

## Renewals

Create a renewal case with its customer, current policy reference, expiry date
and premium. Progress through pending, contacted, negotiation, documents and
issuance stages, then close as renewed or not renewed. A renewed case requires
the new policy reference in the outcome field; a lost case requires a reason.

The worklist separates overdue cases, cases expiring within seven days, those
expiring in 8–30 days, open cases and closed cases. Closed cases do not count as
urgent or contribute to open premium. Dates use calendar days in America/Bogota.

Policy/customer/owner references are text snapshots. These extensions install
without a policy collection and do not create a new policy, send notifications,
obtain quotes, or automatically create cases from existing policies.

## Persistence, permissions and errors

All records use Savia's tenant-scoped collections API. The browser stores no
persistent business data. Updates carry `_version`; concurrent changes fail
instead of silently replacing another user's work. A failed save retains the
form. Close it, refresh the worklist, and reapply the change to the latest record.

The ordinary backend schema enforces required fields, numeric bounds, stage
options and the conditional outcome field on closed renewals. Cross-field payment
rules are checked by the extension screen; the generic collection API remains editable under existing permissions.
Invalid imported account balances are explicitly flagged and excluded from
balance totals rather than silently clamped. This is an operational worklist,
not an accounting ledger or a backend financial posting service.

The screen retrieves all authorized pages before applying filters and computing
its totals, with a limit of 10,000 records. Above that limit it shows an explicit
error and directs the user to the ordinary collection view; it never labels a
partial first page as a complete total. CSV export contains every matching row,
not only the current display page, and escapes spreadsheet formulas.

Disabling an extension removes its custom screen. Existing records are preserved
and remain subject to the platform's standard collection access rules.

## Development and release

Each package owns its manifest, collection requirements, domain rules and screen
configuration. `@savia/insurance-workbench` is the shared UI layer for the whole
solution: sector date/currency helpers, the record editor (opened as a right-side
drawer over the worklist), and three shells that every screen must render in —
the operational workbench (`.iw-workbench` via `Workbench`), the provider
integration shell (`@savia/insurance-workbench/integrations`: `Shell`,
`History`, `IntegrationStatus`, `loadAll`) and the finance shell
(`.iw-finance` styles in `@savia/insurance-workbench/workbench.css`). All three
resolve the same `--iw-*` token aliases from host theme values; integration and
finance plugins use them instead of owning stylesheets. The quote wizard keeps
its own print-style screen CSS on top of the host tokens.
`@savia/release-catalog` assembles the contributions; platform hosts do
not import the sector packages directly.

```sh
pnpm --filter @savia/insurance-collections test
pnpm --filter @savia/insurance-renewals test
pnpm --filter @savia/insurance-workbench test
pnpm extension:pack insurance-collections
pnpm extension:pack insurance-renewals
```

ZIPs are source release candidates for the existing trusted review/build process,
not runtime uploads. Their `workspace:*` dependency on `insurance-workbench`
must be available from the same Savia release checkout. Deploy the compiled
release before installing the extensions in a live workspace.

## Additional operational plugins

The expanded catalog also includes these independently installable extensions:

| Extension                 | Screen                | Owned collection          | Primary workflow                                               |
| ------------------------- | --------------------- | ------------------------- | -------------------------------------------------------------- |
| `insurance.claims`        | Siniestros            | `insurance_claims`        | Report, documentation, assessment, approval, closure/rejection |
| `insurance.commissions`   | Comisiones            | `insurance_commissions`   | Expected commissions, reconciliation and received amounts      |
| `insurance.endorsements`  | Movimientos de póliza | `insurance_endorsements`  | Request, review, carrier submission, issue/reject              |
| `insurance.opportunities` | Oportunidades         | `insurance_opportunities` | Prospect, qualification, proposal, negotiation, win/loss       |
| `insurance.activities`    | Actividades           | `insurance_activities`    | Scheduled, in progress, completed/cancelled                    |

Every screen supports search, stage/date filters, complete filtered CSV exports,
versioned edits, notes and owner assignment by text reference. The shared mobile
layout stacks each record into labeled fields instead of requiring horizontal
scrolling. No plugin is installed or activated automatically.

### Claims

Record the incident date, carrier notification date/reference, customer, policy,
adjuster, claimed amount and indemnity received. Notification cannot precede the
incident. Follow-up urgency uses the next follow-up date; an undated open case
stays open and displays “No date”. Closed and rejected cases require an outcome,
also enforced by the backend metadata. This tracks the team's decisions and does
not decide coverage, submit a claim to an insurer, or issue a payment.

### Commissions

Enter the expected commission, received total, planned seller share and expected
collection date. Received amounts and seller allocation cannot exceed expected
commission in the operational editor. Registering a receipt uses the same
versioned payment mechanism as collections. Optional premium and percentage
produce an informational commission estimate, rounded to cents; the expected
amount remains explicitly entered to support negotiated terms and adjustments.
A fully received commission drops out of overdue/open totals regardless of its
reconciliation stage. Seller participation is an allocation, not proof of payout.
No bank transfers, tax calculations or settlement ledger are implied.

### Policy endorsements

Track coverage changes, inclusion/exclusion, corrections and cancellations.
Record request and effective dates, additional premium and refunds separately.
Retroactive effective dates are allowed intentionally; the recorded date is not
an authorization from an insurer. Issued or rejected requests require an issued
endorsement reference or rejection reason. Closing a request does not modify the
referenced policy or communicate with a carrier.

### Opportunities

Track prospect/customer, product, source, owner, expected closing date, estimated
premium and probability from 0 to 100 percent. The weighted premium sums only
open opportunities, rounding each estimate to cents. It is an estimate based on
entered probabilities, not a forecast claim. Won/lost opportunities require the
resulting policy reference or a loss reason. Winning does not create a policy or
invoke a quote connector automatically.

### Activities

Track calls, meetings, tasks and document reviews with an owner, calendar due
date, priority and progress. Customer and policy/case context are optional text
references. Completed/cancelled activities require a result or cancellation
reason. Dates do not include appointment times; this is an operational agenda,
not an external calendar integration. No messages or reminders are sent.

### Issuance and delivery

`insurance.issuance` installs `insurance_issuance` and the **Emisiones** screen.
Track a request through underwriting, issued, delivered or cancelled. An issued
case remains open until delivery. Issuance requires a policy reference and issue
date; delivery also requires its delivery date. Cancellation requires a reason.
The coverage end must follow its start. The delivery commitment and issue date
cannot precede the request, and delivery cannot precede issuance. These date
ordering rules run in the operational editor; required completion fields also run
on the backend for both creates and partial updates.

This is a manual operational record of issuance and delivery. It does not issue
insurance, create a policy in another collection or send documents to a customer.

### Document requirements

`insurance.documents` installs `insurance_documents` and **Requisitos documentales**.
Each record tracks one required document for a customer or case, with a request
and due date. Receipt requires a received date and a reference to the file stored
in the existing document manager. Approval and requests for corrections require a
review date and written result. Corrections remain open; approved and waived
requirements are closed. Waiver requires a reason without inventing a receipt.
The editor checks request, receipt and review chronology.

The file reference is plain text; the form does not upload or fetch files.
Approval records the team's review, not a legal or automated compliance finding.
This release does not track document validity periods or automatically reopen
approved requirements on expiration.

### Customer service requests

`insurance.service` installs `insurance_service` and **Solicitudes de servicio**.
Track queries, service complaints, certificate requests and data updates through
received, in progress, waiting for information, resolved or cancelled. Record the
reception channel, responsible person and an explicitly entered response deadline.
Resolution requires a response and resolution date; cancellation requires a reason.
The editor rejects response deadlines or resolutions before receipt. Closed cases
are excluded from overdue workload.

Dates are operational commitments, not calculated statutory deadlines. Recording
a response does not send it; certificate requests do not generate certificates,
and data-update requests do not alter a customer's record automatically.

## Functionality coverage

| Area                                           | Available surface                                             |
| ---------------------------------------------- | ------------------------------------------------------------- |
| Quote connections and comparison               | Existing `insurance.quotes` extension                         |
| Policy inventory and expiry overview           | Existing `insurance.portfolio-dashboard` extension            |
| Receivables and payment follow-up              | Collections extension                                         |
| Retention and expiry case management           | Renewals extension                                            |
| Claims lifecycle                               | Claims extension                                              |
| Commission reconciliation                      | Commissions extension                                         |
| Policy amendments and endorsements             | Endorsements extension                                        |
| Sales pipeline                                 | Opportunities extension                                       |
| Policy issuance and delivery                   | Issuance extension                                            |
| Document collection and review                 | Document requirements extension                               |
| Customer queries and service requests          | Service requests extension                                    |
| Daily tasks, meetings and follow-up            | Activities extension                                          |
| Customers, insurers and configurable relations | Existing insurance solution collections and low-code designer |
| Files, permissions and generic workflows       | Existing Savia platform capabilities                          |

Reference snapshots can be enriched through the low-code designer. The worklist plugins alone do not provide automatic case creation or cross-plugin
links; enable the connected operations extension below for those capabilities.
Document attachments inside these custom forms, outbound notifications, carrier
reconciliation, accounting ledgers and external calendar sync remain outside scope.
The coverage table describes operational record workflows, not feature-for-feature
parity with a separate product.

## Connected operations

The optional `insurance.automation` extension (**Operación conectada**) contributes
four bundles to **Operations → Flujos de trabajo → Conectar colecciones con
plantillas**. It adds no business collection and does not activate workflows on
installation. The initial connected-operations release contained 13 extensions: ten operational worklists,
quotes, the policy dashboard, and connected operations.

1. Install the source and destination plugins, plus **Operación conectada**.
   Customer/policy links also require native `clientes` and `polizas` collections,
   normally supplied by the insurance solution. Missing prerequisites are listed.
2. Choose **Preparar** for each needed bundle. Preparation adds native relation
   fields and inactive workflow drafts. It preserves unrelated metadata and
   existing records, checks relation type/cardinality and refuses conflicts.
   Repeating preparation repairs missing fields without replacing edited flows.
3. Review the five generated drafts (two policy events, two opportunity events,
   one renewal event) and publish each required draft using **Publicar**. Publication
   pins its version and execution owner. The relationship-only bundle needs no
   publication. Preparation requires workspace workflow design and publish rights.
4. Make sure the existing workflow scheduler runs in the environment. The preview
   does not imply production scheduling. Inspect each flow's execution history for
   missing data, denied permissions or rejected writes, and correct the source
   before generating another relevant source event.

### Relations and existing records

The links bundle adds optional `customer_id` and `policy_id` fields to installed
worklist collections. The policy-renewal bundle adds or validates `polizas.cliente`.
These are native single-record relationships, validated within the current data
workspace; invalid or foreign-workspace IDs are rejected. Custom worklist editors
show available related records and save their IDs with the ordinary record version.
They also expose the agreed coverage dates added to opportunities.

Legacy customer/policy text is retained as a snapshot. The system does not guess
links by matching names, replace those snapshots when a link changes, or backfill
old records automatically. Link records deliberately. The editor loads authorized
choices only and blocks saving if it cannot load the relationship metadata/choices,
so retrying cannot silently discard a link. The existing 10,000-record load bound
also applies to selectors; larger collections use the standard collection editor.

### Generated records

- **Policy → renewal:** Creating a policy or changing its expiry, premium, status
  or customer creates one renewal if its status is `Vigente`. The policy must have
  a valid `cliente`, `fin` and `prima`. Customer name is resolved from the linked
  record; the renewal retains `customer_id` and unique `source_policy_id`.
- **Won opportunity → issuance:** Creating a won opportunity or changing its stage,
  agreed coverage dates, premium or expected close date creates one issuance
  request with unique `source_opportunity_id`. Enter a positive premium and an
  ordered coverage interval first. Expected closing date is copied into request
  and initial delivery commitment dates; adjust the latter when agreed. Invalid
  coverage order or nonpositive premium creates a review task for the publisher.
  Missing variables fail visibly in execution history instead of inventing data.
- **Renewal → follow-up:** A newly created open renewal creates one linked activity
  through unique `source_renewal_id`, due on policy expiry. Closed renewals are
  excluded. The initial responsible person is the workflow publisher, recorded by
  principal ID. Reassign or reschedule in the activity editor as needed.

Unique source links and workflow checkpoints prevent repeated/concurrent events
from creating duplicate destinations. Existing target records are returned without
overwriting subsequent manual changes. There is one generated target per source
record, not a fresh target for every update. A new policy term represented by a new
policy record can generate another renewal. Reusing a policy record does not roll
its existing renewal into another cycle.

These templates react to future accepted writes; they do not scan historical
records or schedule an N-days-before-expiry campaign. They do not synchronize later
source edits into existing targets, send notifications to customers, issue a policy
with a carrier or infer contractual terms. Source relations let an operator follow
the chain while preserving each case's own lifecycle.

Prepared workflows become independently managed workspace workflows. Disabling
**Operación conectada** hides its preparation templates but does not deactivate
published workflows; deactivate the relevant flows explicitly. Additive schema
preparation is recoverable, not an all-bundle transaction: after a concurrent
schema conflict, review the conflict and prepare again to finish remaining changes.

### Recurring terms, recovery, and operational commitments

Renewal automation uses a unique policy/expiration key, allowing successive terms without replacing previous negotiations. Prepare and publish the current template for new installations. Existing manually edited workflows require deliberate migration; preparation does not overwrite them. In Renewals, choose advance days, preview existing policies, then create reviewed candidates. The operation checks source versions, skips existing linked terms, and stops on conflicts; preview again after any partial execution. Automatic follow-up waits until 30 days before expiry and rechecks whether the case remains open.

The issuance-to-policy template creates an actual native policy when a case reaches issued, with a unique issuance relation for idempotency. Service requests support response/escalation dates and a named escalation owner. Documents support a validity end date; expired approvals become overdue and can be reopened without deleting evidence. Saved-record actions use optimistic version checks.

Issuance delivery and service response actions prepare drafts in Communications. Consent remains unverified until explicitly completed there. Provider configuration and dispatch are required for actual sending; draft creation does not change a case to delivered/resolved. Native file attachment is available in the shared saved-record panel.

### Configurable compliance dossiers

The Compliance plugin stores a versioned checklist template in backend extension settings. Save the template, select an existing native customer, owner and review commitment, then preview missing items before generating a dossier. A unique customer/template-version/item key preserves existing reviews and makes repeated preparation idempotent. Changed templates require a fresh preview; partial failures report how many items were created.

Approval requires evidence and a review date; an exemption requires a reason and review date. Attach original files in the native saved-record attachment panel. Expired evidence no longer counts as ready and appears overdue. These are requirements configured by the workspace; the plugin does not establish legal obligations.

Carrier operations persist their request payload, selected connection, and idempotency reference before calling the gateway. Recover a saved request to query its state or retry with the same reference after a timeout; a new request explicitly creates a new reference. The server validates action-specific message, event, policy and signature payloads before contacting a provider.

See [full plugin coverage](insurance-plugin-coverage.md) for the expanded 25-plugin catalog, integrations, reporting, customer portal and activation prerequisites.
