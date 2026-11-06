# Preview Pulumi latency implementation plan

**Goal:** Reduce the measured 63-second plan and 125-second apply overhead in an Auth-only Preview release.

**Architecture:** Bound independent Preview snapshot reads to four concurrent Worker chains, reusing serving-version dependency metadata in Preview inventory. Batch public configuration preparation with one Pulumi CLI call when real isolated CLI equivalence is verified. Keep production behavior, fresh plan/apply inventory, credential refresh, exact saved plans, checkpoint fingerprints, recovery and the existing Pulumi engine concurrency unchanged.

**Authorization:** The user approved implementation and another measured Preview publication. Preserve all local recovery material; add no schedules, pings, inference or background polling.

- [x] Test and implement bounded read concurrency, deterministic snapshot ordering, failure settling, serving dependencies and secret-safe metadata. Default production reads remain serial.
- [x] Prove individual and batch configuration writes produce equivalent values with the pinned CLI in an isolated file backend. Test Preview-only batching and failure before preview.
- [x] Add fixed-label timings for inventory, catalog/config/export/preview/apply commands without recording arguments, output or credentials.
- [x] Update the guide and deployment-only source classification; perform focused and complete contract checks and independent review.
- [ ] Publish the optimization with one controlled Auth comment change to main and measure its Auth-only Preview release. Compare plan/apply time, verify backups/migrations were skipped, verify production and schedule state unchanged.

No ownership checks or cross-stack evidence are omitted. Cache lifetime stays within one operation. Performance claims require the measured hosted run, not estimates from local tests.
