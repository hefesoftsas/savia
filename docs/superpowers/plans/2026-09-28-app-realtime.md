# App-wide realtime implementation plan

**Goal:** Complete automatic refresh for Savia-owned mutations across operational and administrative screens while preserving tenant isolation and drafts.

**Architecture:** Keep authenticated hint-only WebSocket transport. Platform topics cover global administration; tenant topics cover records, ACL, Studio metadata, settings, integrations and workflows; principal topics cover notifications, personal integrations and account state. Every subscriber reloads authoritative data through the normal API and catches up on reconnect. Do not replace push with global polling or reload pages.

**Execution:** Continue in the existing workspace preserving prior work. Backend worker owns API/protocol/publishers, Studio worker owns Studio frontend, coordinator owns remaining frontend, integration, tests and documentation. No deployment, external messages or production data changes.

- [x] Backend: extend protocol and authorization, emit after successful durable writes, include async workflow and notification delivery; verify scope isolation and failed-write silence.
- [x] Shared frontend: debounced scoped refresh with reconnect, cancellation and dirty-draft preservation; verify bursts and scope changes.
- [x] Administrative frontend: roles/member assignment, identity detail, tenants, branding, credentials, AI configuration and employees; verify dirty forms retain data and clean read models refresh.
- [x] Personal frontend: notifications, account, integrations and My Day surfaces; principal-only events, authenticated refetch.
- [x] Studio frontend: metadata/configuration, records/details/relations/attachments/history, workflows and catalog; no cross-tenant cache invalidation.
- [x] Integration: regenerate OpenAPI types; focused tests plus appropriate broader admin/API suites and typechecks; local multi-tab smoke with temporary fixtures only.
- [x] Documentation: replace the coverage inventory with verified behavior and explicit external-source limitations. Do not claim unverified external writes are observed.

External-provider writes outside Savia are out of scope for push unless an existing webhook/sync ingestion path observes them. Those ingestion paths should publish hints when Savia persists the resulting changes.

## Verification record

- Admin full run: 231 files / 1,244 tests exercised; 1,239 passed and five failed during integration. Two stale UI/localization expectations were corrected; three realtime failures were caused by the run loading source before the concurrent test/mapping updates. All five affected files pass against the final source in the consolidated 11-file / 82-test regression run.
- Backend: API TypeScript passed; focused realtime, mutation-hint and access-control suites passed (3 files / 22 tests). Studio-server notification/workflow suites passed (2 files / 27 tests), including durable recipient/author and execution-transition callbacks.
- Additional targeted frontend runs: 49 settings/account/ACL/notification tests; 110 transport/cache/widget/CRM/form tests; 38 Studio tests. Final credentials check: 1 passed. Admin TypeScript check passed; generated OpenAPI client types were refreshed.
- Two-tab local browser smoke: create a temporary Studio object, observe automatic catalog/sidebar update in the other tab, create a record and observe the table update, edit it and observe an already-open detail update, then keep a local unsaved name while saving a different remote name. The draft survived. Deleting the temporary object and its one record propagated to both tabs. Existing tenant/user/role data was preserved.
- The local API needed a restart after a Wrangler development-proxy crash during testing. The resumed API and admin remain available at ports 8787 and 5173.
- External-provider writes, platform-wide marketplace releases and arbitrary third-party iframe internals are documented boundaries in `docs/guides/realtime-coverage.md`.
