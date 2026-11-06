# Preview component retries implementation plan

**Goal:** Independently retry Preview runtime, Office assets and plugin publication, avoiding data backups for verified compatible code-only releases.

**Architecture:** Keep separate successful component receipts tied to exact trusted main workflow runs. Runtime progress survives asset failures; full promotion requires every needed component. Preserve the strict existing code-only publisher and full backup fallback for unknown/stateful changes.

**Spec:** User-approved design in this conversation: separate deploy results, retry failures only, no backups for compatible code, Preview-only validation and measurement.

## Constraints

- Do not change production behavior, credentials, schedules, polling or AI routing.
- Preserve local history and all existing local recovery copies.
- Do not infer successful full promotion from partial component success.
- Preserve newer optional Preview plugin versions; required or conflicting same-version content must not be silently accepted.

## Tasks

1. Add component-aware planning and tests in scripts/preview-release-plan.mjs and its tests. Independent runtime/office/store baselines, successful trusted job+artifact proof, strict legacy runtime adoption from completed successful managed apply with exact artifact and preflight, fail closed otherwise. Exclude only known deployment orchestration and asset-only paths from runtime changes. Keep plugin-only lane compatibility.
2. Split .github/workflows/deploy-preview.yml into runtime, office, store, existing selective plugins and final promotion jobs. Publish receipts after successful component verification, keep event and exact-main guards. Job retries must not replay successful siblings. Update workflow contracts and guide.
3. Add Preview-only plugin catalog preflight in scripts/deploy-store-plugins.mjs and private deployment worker. Preserve newer optional catalog entries, never downgrade or hide generic409; production default remains exact. Add behavioral tests.
4. Run affected suites, syntax/workflow checks and fresh independent review. Commit and integrate using existing required checks.
5. Validate on Preview: measure component runs; exercise a compatible code-only change and a targeted job retry. Verify no backup/quiesce for code-only, no production modifications and zero schedules. Retain measurement evidence outside repository.

## Review focus

- Partial runtime success with plugin failure advances only runtime proof.
- Missing/forged/expired evidence never skips required work.
- Pending plugin changes remain pending across later code-only releases.
- Workflow-only edits do not require republishing unchanged Workers.
- Newer optional plugins are preserved only in Preview; same-version different content stays an error.
