# Optional plugin coverage validation

Owner: Savia maintainers. Validated locally on 2026-09-19.

## Scope

The release catalog contains 25 optional extensions, including twelve new
packages and the completed operational expansions described in
[the coverage guide](../insurance-plugin-coverage.md). The core hosts import
industry implementations only through release composition.

## Verified checks

- Admin: 806 tests across 157 files passed with three workers.
- API: 431 tests across 63 files passed with one worker.
- Workspace packages: 546 tests across 116 files in 36 projects passed. The
  workspace lane used concurrency one to avoid resource contention.
- Contracts: 49 repository contracts and four core-boundary tests passed.
- Full repository typecheck passed. Admin and calendar typechecks were repeated
  after the final calendar UI and regression tests.
- The final production admin build passed. Existing Vite import/config warnings
  and Lucide chunk warnings remain warnings rather than compilation failures.
- Prettier passed for the changed source, configuration and guide files;
  `git diff --check` passed. The repository-wide lint baseline was not rewritten.
- All 24 extension descriptors produced valid source ZIP archives in
  `dist/extensions`. Quotes remains the existing catalog extension without this
  source descriptor. These archives require the matching compiled host release.
- Case-insensitive reference-brand audits found no matches in application,
  package and documentation sources or inside the generated ZIP archives.

## Behavior and visual evidence

Regression coverage includes authorization of customer-owned policies, requests
and files; denied cross-customer access; scoped access context; settlement rules;
version conflicts; duplicate imports; gateway payload restrictions; stable retry
keys; signature artifact selection; renewal term idempotency; absolute workflow
waits; policy issuance; date expressions; and stale attachment handling.

Calendar domain and UI tests cover local-time conversion, UTC persistence,
versioned edits and explicit rejection of daylight-saving gaps and repeated
hours. Both input and change event paths are covered. The in-app browser's
programmatic date fill did not update React state in the synthetic preview, so
browser-only calendar persistence is not claimed as evidence.

The twelve new screens were inspected at desktop and mobile widths using the
actual compiled components and a synthetic, filesystem-backed preview. No
horizontal overflow was observed at 390px or 1440px. Compliance template layout
and calendar inputs were refined during that pass. Bank import persistence was
checked across reload. Customer portal fail-closed UI was visible in the
unrestricted preview; authorized portal behavior is covered by real API tests.
The temporary preview process was stopped after review.

## Environment boundaries

Verification used local tests and synthetic data. No production deployment, NAS
persistence certification, real customer messages, insurer operations, calendar
synchronization or electronic signatures were performed. External execution
requires configured encrypted connections, a gateway origin allowlist and a
trusted provider adapter implementing the documented contract. Customer accounts
require the dedicated restricted role; automation bundles require review and
publication before execution.

Financial aggregates and exports are bounded operational tools. They do not
silently update receivable balances, create legal invoices or post to an
unspecified accounting provider. See the linked guides for limits and recovery
behavior. Initial contention timeouts and test-fixture failures were investigated
and rerun after correction; production timeouts were not increased to mask them.

Local run logs, screenshots and artifact checksums are retained under
`.cache/insurance-qa/` and are not committed as source.
