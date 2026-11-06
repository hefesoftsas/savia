# Preview frontend publication plan

Implement the approved frontend-only path and measure a visible label change
from push through verified publication. Production and all periodic activity
remain unchanged.

- Classify narrowly scoped Admin TSX/CSS and localization changes as frontend CI.
  Run all six Admin shards, Admin type checking, contracts and source safety.
  The required gate rejects any failed, cancelled or missing frontend prerequisite.
- Extend verified Preview code scopes to the pair `pluginEditor` and `gateway`.
  Build both frontend bundles to preserve shared-source compatibility; freeze only
  those Worker configs and assets. Keep the existing immutable artifact, binding
  checks, Pulumi saved plan, health checks and rollback controls.
- Reject mixed backend/frontend scopes, missing source proof, dependency/config
  changes and production. Skip backups, migrations, secret publication and Auth
  initialization on the verified frontend path.
- Validate retry custody including the plugin editor origin. Publish tooling first
  without application changes so the trusted CI classifier and component receipts
  establish a clean baseline.
- Push a useful visible label change separately. Record push, CI, publication and
  browser observation timestamps; inspect the rendered Preview configs before
  publication and compare live Worker versions/schedules afterward. Confirm only
  the two frontend Workers changed and no production resource changed.

Tests cover scope boundaries, full fallback, both frontend builds, exact target
identity, production rejection, retry custody and all required CI prerequisites.
The result reports measured end-to-end latency, including any failure/retry.
