# Record History Implementation Plan

**Goal:** Deliver opt-in, bounded, authorized per-record history for local collections.
**Architecture:** Atomic SQL capture with request actor attribution; shared configuration validation; scoped server readers; lazy CRM history UI.
**Tech stack:** D1, Hono, Zod, React, TanStack Query; no new dependencies.
**Spec:** ../specs/2026-09-19-record-history-design.md

## Tasks

- [x] Capture: add matching API/standalone migrations, request actor context, triggers and bounded retention maintenance. Prove rollback and retries in real SQLite/D1 tests before broad integration.
- [x] Server API: add collection configuration and record summary/detail routes, validate selected fields and object version, bound keyset cursors to identity/tenant/record, enforce stable historical authorization and current field visibility. Test cross-tenant, forbidden fields, mutable predicates, delete access and expiry.
- [x] UI: configuration at collection level plus a lazy record History tab; defer snapshot requests until selected, reset state across records/scopes, show explicit states and do not persist history. Verify paging and authorization rejection.
- [x] Integration: cover offline and bundle attribution/idempotence; document supported scalar scope and retention; generate public API schemas through existing tooling where required.
- [ ] Verify: targeted red/green tests, package/API/admin types, required suites, independent review, desktop/mobile screenshots; fix findings, synchronize and push main; verify CI and preview.

## Review focus

- Transaction retries or rejected writes must not create history.
- Mutable row predicates must not reveal past data from another authorized population.
- Renamed/removed/sensitive fields must not remain exposed by old history entries.
- A disabled or idle collection must still expire and eventually purge old data.
- User attribution must come from the authenticated operation, never a copied owner or another concurrent request.

## Verification evidence

- Shared package: 125 tests passed. Atomic capture: 8 storage tests, 3 mutation tests and 1 bundle test passed, including replay, rollback and actor attribution.
- API suite: 404/405 initially passed; the schema table-count expectation was updated for the two new tables and all 6 schema tests then passed.
- CRM server suite: 156/158 initially passed. Fixed a factory-level access-policy regression and reran its route file with the 1,000-record pagination file that timed out under load: all 14 tests passed.
- Admin suite: 836/845 initially passed. The two navigation files with timing-sensitive failures passed all 34 tests when rerun in isolation. New history UI tests passed in the full suite.
- API, admin and CRM server TypeScript checks passed; 56 contract checks passed.
- Independent review found historical field visibility and embedded-NUL truncation issues; both received regression tests and fixes. Desktop and mobile visual checks covered history details and configuration.
- Local verification is complete. Main integration, CI and preview verification follow this commit.
