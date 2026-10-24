# Account Emergency Stop Panel Implementation Plan

> **For agentic workers:** Use the existing project delegation policy for the independent panel module; keep backend integration and final review with the coordinator.

**Goal:** Add an authenticated account-wide manual stop button independent of the applications.

**Architecture:** The existing guard Worker serves a static control panel. A confirmed authenticated `/stop` request stores a persistent latch in its existing Durable Object before external calls, then reuses existing pause actions.

**Tech Stack:** Cloudflare Worker ES modules, existing SQLite Durable Object, dependency-free HTML/CSS/browser JavaScript, Node tests.

**Spec:** `docs/superpowers/specs/2026-10-24-account-stop-panel-design.md`

## Global Constraints

- No application deployments or automatic resumption; preserve backup/cleanup exceptions.
- Existing administrator key only; never embed it in HTML/URLs or browser persistence.
- No new credentials, inference bindings, databases or paid infrastructure.
- All product code/docs in English; state and snapshots remain in the backend.

## Review Focus

- Billing or inventory failures must not prevent persistence of manual stop.
- Unauthorized, unconfirmed and cross-origin requests must not mutate state.
- Repeated stop and scheduled checks must preserve original recovery snapshots and the manual latch.
- Partial failures must remain visible; an incomplete inventory cannot report a universal success.
- Browser refresh must discard credentials but retain server-side stop state.

### Task 1: Manual stop and status contract

**Files:** `scripts/cloudflare-cost-guard/worker.mjs`, `worker.test.mjs`.
**Interfaces:** Exported `executeCheck(env, { fetcher, now, manualStop })`; authenticated JSON `POST /stop`, confirmation `PAUSE_ALL_ENVIRONMENTS`; status includes target outcomes and errors.

- [x] Add failing tests for a below-budget stop, latch-before-inventory/billing independence, authentication/confirmation/origin, scheduled persistence and failures.
- [x] Implement manual latch and reuse pause actions; expose sanitized per-target outcomes.
- [x] Run guard tests and preserve recovery snapshot behavior.

### Task 2: Independent protected controls

**Files:** New `scripts/cloudflare-cost-guard/panel.mjs`, `panel.test.mjs`; Worker route integration.
**Interfaces:** `renderControlPanel()` returns static HTML; `/control` serves it with no-store/CSP/framing protections. Browser requests `/status` and `/stop` with the existing administrator key in memory only.

- [x] Write failing tests for login, confirmation, per-target errors, storage/credential safety and accessibility.
- [x] Build responsive panel, including protected services and no resume button.
- [x] Run tests and inspect desktop/mobile UI in browser.

### Task 3: Validate and activate

**Files:** Existing runbook and contract test command if needed.

- [x] Update runbook with access, manual latch, partial failure and in-flight request limitations.
- [x] Review the combined diff; run guard tests, contracts and publication safety scan.
- [x] Inspect exact Wrangler configuration, dry-run and deploy only the guard using existing credentials.
- [x] Exercise authenticated stop on the already-paused account; verify persisted status and full account pause. Preserve automatic preview deployment disablement.
- [ ] Publish a reviewable PR, show the live panel and report verification evidence.

Execution evidence: deployed only the guard, exercised the real browser button, and verified 120 successful actions with zero errors. The independent account audit confirmed all six queues paused, no application public routes/crons/native AI bindings, and the protected guard/backup/cleanup services retained. All 782 contracts passed.

## Cloudflare Access follow-up

- Replace browser administrator-key entry with a Cloudflare Access session.
- Protect `/control` and subpaths using the Cloudflare identity provider, account
  membership and administrator email, with a 30-minute session.
- Fail closed in the Worker without verified platform context and an allowed email.
- Preserve machine bearer endpoints and internal scheduled enforcement.
- Record the external Access application settings and IDs in the repository.
- Verify anonymous redirects, authenticated status and stop, tests, and paused services.
