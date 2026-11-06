# Insurance operations implementation plan

**Goal:** Deliver independently installable collections and renewals extensions.
**Architecture:** Two sector packages plus a small shared insurance workbench;
release-catalog is the only platform integration point.
**Spec:** ../specs/2026-09-19-insurance-operations-design.md

## Constraints

No reference-project code or brand names. Preserve the generic platform boundary.
Use the existing tenant-scoped API and optimistic versions. No browser persistence.

## Tasks

- [x] Add domain tests for balance/aging/payment rules, expiry/stages/close rules,
      invalid dates and numeric inputs. Observe missing implementation failures.
- [x] Implement package manifests, independent collection requirements, domain
      functions and shared date/money/workbench support.
- [x] Build themed responsive worklists and editors with save, payment, retry,
      search, priority filters and CSV export. Cover writes and failures with UI tests.
- [x] Register both extensions/screens/requirements in release-catalog; test
      installation, compatible repair, tenant isolation and activation behavior.
- [x] Verify focused tests, typechecks, contract boundaries, production build,
      desktop/mobile browser states and an independent final review.
- [x] Write usage documentation and produce both extension release ZIPs.

## Review focus

Reject overpayments and invalid balances; exclude closed renewals from urgency;
never show a truncated page as a complete portfolio; retain unsaved input on
failure; send record versions on all edits to prevent lost updates.

## Follow-up expansion

- [x] Extend the internal workbench with shared declarative schema/field validation
      and financial helpers, backed by meaningful schema and decimal tests.
- [x] Add claims and commissions packages; verify date ordering, required outcomes,
      paid/expected balances, installation and versioned persistence.
- [x] Add endorsements, opportunities and activities packages; verify effective
      dates, closure requirements, probability bounds and closed-case filters.
- [x] Register all additional packages and test their screen and installation
      contracts. Run focused tests/types and browser checks using synthetic QA data.
- [x] Update the functionality coverage guide and package every extension.

## Completion evidence

See [the validation report](../../archive/2026-09-19-insurance-plugins-validation.md)
for final checks, browser coverage and the reproduced baseline API failures.
All seven source release candidates are packaged; no live deployment was performed.
