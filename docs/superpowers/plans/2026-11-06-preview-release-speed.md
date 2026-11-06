# Preview release speed implementation plan

**Goal:** Reduce work for verified source-only Preview changes and make full-release latency measurable.

**Architecture:** Keep the existing Pulumi-managed release, exact deployed ancestor, immutable artifact and version rollback. Build only selected Workers for a verified Preview code scope while preserving the full managed Worker inventory. Keep full releases for migrations, entrypoints, shared code, configuration, unknown changes and production. Publish independent full-release Workers with a concurrency limit of two and dependency barriers.

**Authorization:** The user approved the preceding deployment analysis and implementation recommendations. Continue implementation and review without another design approval round.

**Constraints:** No cloud mutation or deployment during implementation. No credential output, periodic jobs or AI provider changes. Preserve namespace identities, complete runtime inventory, health checks and rollback. New timing records contain only controlled operation labels, elapsed milliseconds and outcome.

## Tasks

- [x] Select Preview scope before building; skip unrelated admin builds and Worker bundles. Validate the exact partial artifact target set while preserving all managed identities and bindings. Test full-release fallback, active-runtime requirement, missing/extra targets, rollback and resource preservation.
- [x] Add safe per-command and per-phase timings, including failures, and publish the sanitized timing summary even when Pulumi fails. Never print subprocess output, arguments, environment, errors or secret input.
- [x] Add bounded parallel publication only for an explicitly independent Worker group. Preserve Auth initialization before consumers, Flows before API, gateway last, verification after all publication, and await in-flight work before recovery.
- [x] Update the release guide; run focused infrastructure, workflow, classifier and artifact tests; review combined changes and prepare a pull request. Report measured test results separately from unmeasured deployment-time targets.

## Review focus

- A partial artifact must never remove unmodified Workers from Pulumi ownership.
- Unknown or forged scope metadata must fail before mutation.
- A failed concurrent task must settle all in-flight operations before rollback starts.
- Timings must survive captured Pulumi subprocess output without leaking diagnostics.
- A full release and production must retain their consistency and recovery boundaries.

## Validation

- 495 infrastructure, artifact, workflow and release-classification tests passed.
- Infrastructure TypeScript checks passed for application, branch, shared registry and management projects.
- Two isolated real Pulumi CLI preflight checks passed.
- Independent review and follow-up review found no remaining actionable issues.
- No cloud deployment or production mutation was performed. Deployment latency remains to be measured on a later release.
