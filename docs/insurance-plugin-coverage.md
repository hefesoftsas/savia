# Optional insurance plugin coverage

Owner: Savia maintainers. Last reviewed: 2026-09-19.

The release catalog now contains 25 optional extensions. Industry code stays in
packages and release composition; the generic host supplies authorization,
collections, files, extension actions/settings and workflows.

## New capabilities

| Extension                       | User workflow                                                          | Guide                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `insurance.payments`            | Bank CSV preview, deduplication, partial allocation and differences    | [Finance](insurance-finance.md)                                        |
| `insurance.settlements`         | Fully collected commission shares, adjustments and producer statements | [Finance](insurance-finance.md)                                        |
| `insurance.accounting`          | Balanced accounting batches and CSV export                             | [Finance](insurance-finance.md)                                        |
| `insurance.communications`      | Saved drafts, provider dispatch and delivery status                    | [Integrations](insurance-integrations.md)                              |
| `insurance.carriers`            | Persisted carrier requests, status and document retrieval              | [Integrations](insurance-integrations.md)                              |
| `insurance.calendar`            | Saved events, ICS export and provider synchronization                  | [Integrations](insurance-integrations.md)                              |
| `insurance.campaigns`           | Consent/suppression review, saved recipient snapshots and dispatch     | [Integrations](insurance-integrations.md)                              |
| `insurance.document-generation` | Templates, persisted generated files and signature evidence            | [Documents and signatures](insurance-documents-and-signatures.md)      |
| `insurance.data-quality`        | CSV validation, duplicate review and resumable imports                 | [Data and reports](insurance-data-and-reports.md)                      |
| `insurance.reports`             | Operational metrics and native-link customer 360                       | [Data and reports](insurance-data-and-reports.md)                      |
| `insurance.compliance`          | Configurable checklist templates, evidence review and validity         | [Compliance](insurance-operations.md#configurable-compliance-dossiers) |
| `insurance.customer-portal`     | Customer-limited authenticated policies, requests and files            | [Customer portal](insurance-customer-portal.md)                        |

## Completed worklist expansions

- Shared operational record editors expose native file upload, download and
  version-checked deletion. They clear attachments when changing records.
- Renewals support policy-term keys, controlled historical preview/creation and
  advance follow-up through published date-relative waits. Waiting workflows
  re-read current records before creating follow-up work.
- Issuance can generate a linked native policy with an idempotent source key.
- Service cases expose escalation and response drafts; issuance exposes delivery
  drafts. Operators send the resulting messages from Communications.
- Document requirements track review validity and can reopen expired cases.
- Reports provide the combined customer view through explicit native links.

## Activation and external configuration

Install the desired extension, review its required collections and configure
permissions. Prepare and publish the selected automation bundles; preparing a
bundle never silently replaces an already edited/published workflow. Review the
upgrade notes for legacy renewal source keys and existing workflows.

Finance settings aggregates and integration connection configuration require
extension-management rights. Customer portal accounts require the narrowly scoped
customer role described in the portal guide; broad administrator access is not a
customer portal configuration.

External actions are unavailable until an encrypted connection and a trusted
provider adapter are configured. Set `EXTENSION_GATEWAY_ALLOWED_ORIGINS` on the
connector gateway to a comma-separated HTTPS origin allowlist. The default is
deny-all. The adapter implements the documented contract, verifies authoritative
consent, enforces durable idempotency and maps provider receipts. No specific
WhatsApp, insurer, signature, calendar or accounting account has been configured
or contacted as part of local implementation/testing.

Accounting exports do not issue electronic invoices, file tax documents or post
to an unspecified accounting system. Carrier request acceptance is not proof that
a policy was issued; delivery acceptance is not proof of delivery; a document
signature requires the returned timestamp and evidence. The platform records
these distinctions in its UI and histories.

## Release

Run the repository tests and typechecks, build the matching host release and pack
the extension directories with `scripts/pack-extension.mjs`. Source ZIPs require
this matching compiled release. Apply database migrations through the normal
release process. No live deployment, production account provisioning or outbound
customer messaging is performed by packaging.
