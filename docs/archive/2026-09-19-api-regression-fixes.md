# API regression fixes — 2026-09-19

Owner: Savia maintainers. Last reviewed: 2026-09-19.

## Causes and corrections

The previously reported 11 API failures were reproduced: three identity tests,
seven tenant-host tests, and one schema projection test.

Tenant deletion left scoped access roles behind. Recreating the same tenant ID
failed the role-name uniqueness constraint. Migration
`0057_access_tenant_lifecycle.sql` removes historical orphan policies and adds a
tenant deletion trigger. Role removal cascades to grants and assignments; audit
events remain and policy revisions advance rather than reset. Existing tenants
retain their policies. The migration must be applied through the normal release
migration process; no live database was changed during this task.

The schema test still expected 292 tables. Its exact count is now 306, and its
required-table assertions explicitly include the 14 workflow, access-control and
file-revision tables responsible for the difference.

## Verification

- Before correction: the three affected suites had 11 failures and 25 passes.
- After correction: the three suites plus the new tenant lifecycle regression
  passed all 37 tests.
- The new regression exercises historical orphan cleanup, future deletion,
  recreation without inherited assignments, preserved audit/revision history,
  and isolation of another tenant's policy.
- Full `pnpm test` passed: administration 801 tests, API 412 tests, all
  workspace package suites, and 53 contract checks (49 + 4).
- Full `pnpm run typecheck` passed.
- Prettier checks for changed TypeScript and documentation passed; `git diff
--check` passed.
- Independent scoped code review found no material issues.

Local command logs are under `.cache/insurance-qa/`.
