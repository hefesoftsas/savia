# Insurance service plugins validation

Owner: Savia maintainers. Last reviewed: 2026-09-19.

## Scope

Added three optional plugins to the existing seven operations plugins:
`insurance.issuance`, `insurance.documents` and `insurance.service`. With the
existing quotes and policy dashboard, the release catalog now contains 12
extensions. Each new plugin owns its collection, manifest, validation and screen.
No production deployment or automatic tenant installation was performed.

## Checks

- All insurance packages: 104 tests passed, including 27 tests in the three new
  packages. Domain tests were first run against missing implementations and failed.
- Extension API suite: 22 tests passed. Coverage includes install/repair, version
  conflicts, isolation between data domains, and completion requirements on both
  creation and partial updates.
- Focused admin suites: 21 tests passed. New cases cover all three editors,
  issuance delivery requirements, document receipt evidence and service creation.
- Release catalog: 3 tests passed. Repository contract checks passed.
- Repository typecheck passed; the changed packages were checked again after
  final rendering adjustments. Production admin build passed.
- All three source release ZIPs were generated under `dist/extensions/`.

The earlier full admin run passed 793 tests before these additions. This pass used
focused regression tests; the previously reproduced 11 baseline API failures
remain documented in [the initial validation](2026-09-19-insurance-plugins-validation.md).
No claim is made that the full repository suite is green.

## Interface review

The actual compiled components were reviewed in an isolated synthetic QA preview
at desktop and 390 px mobile sizes, including the issuance editor. Issuance closure
was saved using the visible form and remained delivered after reloading. Calendar
fields were exercised with native keyboard controls. Backend integration was
verified separately by the API tests; the preview used a file-backed fixture API.

The shared footer now honors each plugin's date/currency context instead of
labeling nonfinancial lists as COP. Missing or invalid issuance premiums render
as unknown instead of becoming zero through numeric coercion. Screenshots and
command logs are retained locally in `.cache/insurance-qa/`.

Independent code review found no material high/medium issue. Visual review
requested a loaded desktop issuance capture; the final capture shows the complete
list after records loaded. The established workbench design remains authoritative.

## Limits

Cross-field date ordering is enforced in the operational editors. Required fields,
option values and conditional completion evidence are also enforced by collection
metadata on the backend. Files and related records are text references. The new
plugins do not issue insurance, generate certificates, upload files, send replies,
calculate legal deadlines or automatically update other collections.
