# Insurance plugins validation — 2026-09-19

Owner: Savia maintainers. Last reviewed: 2026-09-19.

Follow-up: the 11 previously reported API failures are addressed in
[API regression fixes](2026-09-19-api-regression-fixes.md).

## Delivered scope

Seven optional compiled extensions: collections, renewals, claims, commissions,
endorsements, opportunities and activities. Existing quotes and policy dashboard
extensions remain available. The shared insurance workbench is internal sector
infrastructure, not an independently installed extension.

Each extension has its own manifest, collection requirement, screen, validation,
tests and release ZIP under `dist/extensions/`. These are source release candidates
for the matching Savia checkout; they have not been deployed to a live workspace.
See [the operations guide](../insurance-operations.md) for workflows and limits.

## Verification

- All insurance package tests passed, including decimal arithmetic, aging, date
  validation, closure rules, pagination completeness and receipt date ordering.
- API extension suite: 16 tests passed, including installation, schema validation,
  optimistic conflicts and workspace isolation for all seven new extensions.
- Focused admin screen suites: 15 tests passed, including writes, conflict recovery,
  required closure outcomes and missing collection recovery.
- Full admin regression: 155 test files and 793 tests passed.
- Release catalog tests: 3 passed.
- Repository typecheck, admin production build, workspace unit tests and contract
  checks passed.
- Release packaging succeeded for all seven new extensions.
- Changed implementation files passed formatting and whitespace checks.

## Browser evidence

The actual compiled screens were exercised in an isolated local QA preview with
explicitly labeled synthetic records and a file-backed fixture API. This checks
screen behavior, not live tenant authentication or deployment. Production API
installation and isolation are covered separately by the API tests above.

Desktop and 390 px mobile checks covered all seven screens. Additional checks
covered dark theme, the mobile editor, a payment surviving reload, and a claim
closure saved with an outcome. Mobile worklists use labeled stacked rows and
compact metrics so a record is visible in the first viewport. Temporary screenshots
and command logs are retained locally in `.cache/insurance-qa/`.

Independent code reviews prompted fixes for decimal precision, incomplete
pagination totals and backdated receipts moving the latest payment date backward.
The visual review prompted mobile density and due-window copy fixes. Regression
tests cover the arithmetic and data-completeness fixes.

## Existing API suite failures

The full repository test command stopped at 11 API failures across three files.
The same 11 failures were reproduced with the original HEAD runtime catalog,
using a temporary test alias rather than modifying application source:

- `apps/api/test/identity.test.ts`: 3 failures from duplicate seeded access roles.
- `apps/api/test/tenant-host-guard.test.ts`: 7 failures from duplicate seeded access
  roles (`UNIQUE` on `access_roles.scope` and `access_roles.name`).
- `apps/api/test/schema.test.ts`: 1 projection assertion expecting 292 tables while
  the current schema contains 306.

The original-catalog reproduction had 11 failures and 25 passes. These unrelated
fixtures/schema expectations were left unchanged. The full suite is therefore not
reported as green.
