# Cloudflare Cost Guard Implementation Plan

**Goal:** Deploy a reversible Cloudflare-hosted spending circuit breaker before the requested USD 20 account ceiling, plus native AI Gateway limits.

**Architecture:** A scheduled Worker checks current-cycle Cloudflare billable usage every five minutes. It adds a USD 5 fixed-cost reserve and latches a reversible pause at USD 15 total, or when billing cannot be safely evaluated. Existing AI Gateway `default` caps routed inference at USD 5 per month and USD 1 per day, using native sliding windows. No automatic resume, deletion, subscription cancellation, or weakening of the backup barrier.

**Constraints:** Billing currently updates daily, not in real time. Gateway spend limits are eventually consistent. Existing storage, fixed charges, requests to paused endpoints, and unmanaged workloads remain chargeable. This is preventive automation, not an absolute invoice guarantee. The current cycle already exceeds the threshold.

## Tasks

- [x] Implement tested billing normalization, conservative validation, durable stop latch, reversible allowlisted pause actions, and private status/check endpoints.
- [x] Add deploy/configuration tooling with recovery snapshots and no credential logging. Use a dedicated account-scoped API token; never deploy Wrangler OAuth credentials.
- [x] Configure a native AI Gateway with spend limits, no logging of prompts for SECOP calls, and no provider fallback. Route SECOP analysis through it without losing OpenRouter max_price or retry protections.
- [x] Deploy and verify the Worker schedule, persistent state, pause settings, and gateway configuration. Keep SECOP processing paused.
- [x] Document operator recovery, permissions, coverage, latency, and residual charges. Run focused tests, inspect the combined diff, and report any activation blocker accurately.

## Verification evidence

Deployed version `e007660a-7c0c-4344-879a-e07820daf654`. The manual check
completed at 2026-10-24 13:39:21 UTC. A subsequent read-only status query showed
`checkedAt=2026-10-24T13:40:24.042Z`, proving the scheduled trigger ran without
another manual check. Both reported `tripped=true`, `reason=threshold`, and
`actionErrors=[]`. Live queue, Worker flag, schedule, and AI Search settings were
verified independently. Recovery export returned 15 snapshots.

Validation passed: 27 focused tests, 737 contract tests (732 main plus 5 package
boundary checks), and `git diff --check`. No full monorepo typecheck or lint run
was performed; changes are isolated operational JavaScript and documentation.

## Account-wide extension

The user subsequently authorized account-wide trigger controls, a global
OpenRouter-only inference policy, and adding Zone Read / Workers Routes Write to
the existing account token. The runtime now discovers new resources on every
check, disables workers.dev/previews, detaches custom domains, unbinds zone Worker
Routes, pauses all queues/workflows, and removes cron triggers except the guard
and backup coordinators. Native AI and AI Search bindings are removed even below
the spending threshold. Protected backups retain execution, not AI privileges.

SECOP's model client now uses the HTTP OpenRouter Gateway route without a native
AI binding. The approved AI Gateway Run-only token is saved as `CF_AIG_TOKEN`;
token status, secret presence, pause flag and disabled public URLs were verified.
No inference request was made. Missing credentials fail closed, and configured
provider prices and authenticated Gateway spend limits remain enforced.

Global policy and the `openrouter-only-ai` skill are installed in the agent
user configuration. Existing Orca hooks were preserved. Following
the user's explicit approval, the new PreToolUse definition was reviewed and
trusted through the agent's `/hooks` UI, rather than writing a trust hash manually.
The hook's 18-case self-test passes; arbitrary shell execution is not a sandbox.

Deployment `187b143e-a8ad-497f-98d6-4e97aabe4284` completed a real global check at
2026-10-24 14:02:46 UTC with `actionErrors=[]`, then armed the five-minute cron.
Recovery export contains 89 records. The 35 focused controller/HTTP-provider tests
pass. Residual fixed charges, storage, DO alarms, service-binding execution and
external REST inference via existing credentials remain outside an absolute cap.

Final deployment `90c3e84a-b3db-435d-bd21-868d5d1668a8` checked at
2026-10-24 14:05:02 UTC with `actionErrors=[]` and re-armed the five-minute cron.
Independent review and live verification caught a workers.dev/previews distinction;
both are now disabled and API confirmation is required. Final contracts passed
741 main tests plus 5 boundary tests; the focused controller/provider suite has
36 tests. The global hook has 18 passing behavioral cases and persisted trusted
state from the `/hooks` review.
