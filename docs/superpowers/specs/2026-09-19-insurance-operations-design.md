# Collections and renewals extensions

Build two independently installable trusted Savia extensions: `insurance.collections`
and `insurance.renewals`. Keep industry code in optional workspace packages and
assemble it only in release-catalog. Preserve the existing policy dashboard.

Collections owns `insurance_receivables`: reference, customer, policy reference,
insurer, owner, due date, amount, paid amount, last payment date, collection stage,
next follow-up and notes. Users create/edit accounts, record partial or full
payments with optimistic versions, filter by aging and search, and export the
filtered worklist. Amounts use COP and two decimal places; the payment action
rejects nonpositive payments, overpayments and invalid existing balances.

Renewals owns `insurance_renewals`: reference, customer, policy reference, insurer,
owner, expiry, premium, stage, next follow-up, outcome reference/reason and notes.
Users create/edit cases and move through pending, contacted, negotiation,
documents, issuance, renewed or lost stages. Closing requires an outcome reference
or reason. Policy references are explicit snapshots, not fabricated foreign keys.

Both collections use the existing idempotent installer, preserve compatible
schemas and reject incompatible ones. No seed data is installed. Data writes use
the scoped host collection API; client state holds only transient interaction
state. Backend metadata validates required fields, numbers and option values.
Business actions validate cross-field invariants before versioned writes.

## Interface

Extend Savia's existing administrative visual language, theme tokens and system
font. Operate mode: a daily work queue for insurance operations staff. A concise
heading and create action lead into a compact priority strip, search and filters,
a responsive table and an inline detail/editor panel. Priorities derive from
actual open balances or dates and never from decorative scores. Amounts use
aligned tabular figures. Keyboard focus, labeled inputs, asynchronous errors,
retry, loading, empty states and narrow screens are required.

## Limits and verification

No insurer reconciliation, payment gateway, email sending, automatic issuance or
background renewal creation is implied. Payments record collected amounts; they
do not move money. Generic CRM APIs remain available under ordinary permissions.
Test numeric/date boundaries, closed-case priorities, concurrent edits, backend
installation/tenant isolation, catalog registration and UI save/error flows.
Verify desktop/mobile rendering using explicitly labeled synthetic QA records.

## Catalog expansion

The follow-up request authorizes additional functional plugins. Expand in this
order: claims, commissions, policy endorsements, commercial opportunities and
activities. Each owns an independently installed collection, original domain
validation, a usable worklist/editor and release manifest. Reuse the tested
workbench to retain a consistent interface and persistence behavior.

- Claims: incident/notification dates, insurer reference, adjuster, claimed and
  paid amounts, next follow-up, status and documented outcome.
- Commissions: policy/insurer/seller references, expected and received commission,
  settlement date, reconciliation stage and received-payment recording.
- Endorsements: policy amendment type, request/effective dates, additional premium
  and refund, processing stage, issued reference or rejection reason.
- Opportunities: prospect/customer, product, source, owner, expected premium,
  probability, target close date, stage and winning policy/loss reason.
- Activities: customer/policy context, owner, activity kind, due date, priority,
  progress and completion/cancellation outcome.

These are operational record-management plugins, not hidden external integrations.
They do not send messages, move money, decide claim coverage, issue policies or
synchronize an external calendar. Existing core collections, files, permissions
and automation remain reusable platform features instead of duplicate plugins.
