# Connected insurance operations

Goal: Real record relations and durable automation using existing platform engines.

## Design

An optional sector package contributes declarative workflow bundles to the release
catalog. The generic workflow host lists bundles and prepares their native relation
fields plus deterministic drafts. Preparation is repeatable, preserves edited
workflows, never activates drafts automatically and never matches legacy text to IDs.
Users publish through the existing workflow controls. Installation failures are
recoverable: schema additions are additive, already prepared drafts are retained.
All operations require current workflow design/publish authorization.

Bundles: policy created/changed to renewal; won opportunity created/changed to
issuance; renewal created to follow-up activity. Source ID relations enforce one
linked target per source. Existing cases are never overwritten; a new policy record represents a new
renewal cycle in this first version. Policy renewal begins at
policy creation/update, not a scheduled N-days-before-expiry scan. Activities are
ordinary plugin records, not messages. Each generated target retains a real source
relation and snapshots for readable history. Missing input errors remain visible.

Generic keyed create uses a unique field to reuse an existing target after retries
or competing events; no business-specific behavior enters the host. Existing
workflow execution checkpointing and authorization remain authoritative.

Editors discover installed native relation fields and show permission-scoped
record selectors; no browser persistence. New links use actual IDs, legacy text is
left untouched. The shared field scope is limited to native single-record relations.

## Tasks

- [x] Generic typed workflow bundles, additive preparation, idempotent draft IDs,
      authorized routes and generated OpenAPI entries; test repeat/partial repair.
- [x] Generic keyed-create workflow primitive; test concurrent/replayed creation.
- [x] Sector bundle definitions with accurate mappings, prerequisites and native
      relation fields; integration tests on real D1 and invalid/cross-domain links.
- [x] Existing workflows UI bundle preparation and workbench relation selectors;
      focused UI tests, responsive browser inspection using Impeccable.
- [x] Regression, typecheck/build/contracts, guides and review before completion.

## Evidence

[Validation report](../../archive/2026-09-19-connected-insurance-validation.md).
No production deployment or live workflow activation was performed.
