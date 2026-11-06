# Connected insurance validation

Owner: Savia maintainers. Last reviewed: 2026-09-19.

Follow-up: the 11 previously reported API failures are addressed in
[API regression fixes](2026-09-19-api-regression-fixes.md).

## Delivered

`insurance.automation` adds four optional bundles: customer/policy links,
policy-to-renewal, won-opportunity-to-issuance and renewal follow-up. The release
catalog now contains 13 extensions. Native workflow bundle preparation is generic;
industry definitions remain in the sector package. Schema preparation is additive
and repeatable. Drafts remain inactive until published and are never replaced by
repeated preparation. Existing published flows are independently managed.

The workbench discovers native single-record relations and agreed coverage dates,
loads authorized record choices, preserves historical text and saves actual IDs
with the current version. The backend rejects nonexistent/cross-workspace links.
Matched workflow creation uses scalar unique text fields and the existing native
transaction/checkpoint machinery to arbitrate concurrent events.

## Verification

- API extension and connected-operations suites: 31 tests passed. Real D1 evidence
  covers both generated chains, repeated/concurrent events, manual-change
  preservation, invalid relation IDs, inactive draft preparation, retained edited
  drafts, invalid date-order review tasks, incompatible relation cardinality,
  unsupported numeric keys, authorization and exclusion of closed renewals.
- Existing dynamic CRM/publication suites: 13 tests passed.
- Existing workflow engine suite: 14 tests passed.
- Focused admin worklist/workflow/screen suites: 28 tests passed, including actual
  ID selection, retained text, optimistic writes and explicit publication.
- Shared workflow/Plugin API suites: 12 tests passed. Release catalog: 3 passed.
- Automation package: 2 tests passed. Shared insurance workbench: 10 passed.
- Repository typecheck passed. Changed admin/workbench types were checked again
  after final interface adjustments. Production admin build and contract checks passed.
- Formatting and whitespace checks passed. Source ZIP generated as
  `dist/extensions/insurance.automation-1.0.0.savia-extension.zip`.

The repository's previously reproduced 11 unrelated API failures are described
in [the first validation report](2026-09-19-insurance-plugins-validation.md).
This iteration ran targeted regression suites, not a new full-repository test run.

## Reviews and browser evidence

Independent review prompted cardinality/delete-policy compatibility checks and
consistent publication/runtime restrictions for matched keys. Regression tests
cover these cases. A subsequent review found no remaining material issues.

Actual compiled UI components were inspected in an explicitly labeled synthetic
preview at desktop and 390 px mobile widths. Final workflow captures include the
compiled production utility CSS. The relationship picker saved a selected client
ID and restored that selection after reloading. The preview used a separate
file-backed fixture API; workflow execution evidence comes from the real D1 tests.
Visual review closed after confirming final button sizing and mobile wrapping.
Local screenshots and logs remain under `.cache/insurance-qa/`.

## Deployment and operating limits

No production deployment, live data migration, live extension installation or
workflow activation was performed. Use the matching compiled release; the source
ZIP alone cannot add generic host capabilities to an older deployment.

See [connected operations](../insurance-operations.md#connected-operations) for
installation, source field mappings, scheduler prerequisites, publication and
recovery. Templates react to future accepted writes, do not infer historical links
or contractual dates, and do not overwrite already generated cases. There is one
renewal per policy record rather than recurring renewal cycles on the same record.
Follow-up is due at policy expiry by default, not a configurable lead-time campaign.
