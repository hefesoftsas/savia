# Savia Flows workflow replacement verification

Date: 2026-10-12. Environment: managed local worktree, Miniflare, synthetic
tenants and principals. No deployment, external delivery or paid service activation.

## Result

The original Studio workflow editor entry now opens Savia Flows with its tenant.
Flows lists the existing workflows and edits them in a visual graph with typed
properties. The transactional engine lives in `apps/flows/packages/native`;
Core executes it against the same canonical definitions, published versions,
jobs, tasks, notifications and webhook records. Adoption does not copy definitions
or start runs. Only one native scheduler processes those records.

Compatibility HTTP paths, public webhook URLs, SQL objects and old import shims
remain because notifications, bundles and existing clients depend on them. The
old sequence editor is no longer mounted; its source and fixtures remain for
compatibility coverage. This replaces the authoring surface and relocates the
engine without dropping its dependencies.

## Local end-to-end evidence

`apps/flows/scripts/native-workflows.test.mjs` exercises actual Core/Flows
migrations and the signed host bridge. It verifies:

- Existing compatibility-created workflows appear in Flows with the same IDs
  and definitions; inventory stays stable through adoption and restart.
- Saved graph positions, immutable publication, draft changes, activation and
  manual start idempotency/conflict handling.
- Condition, transform, equality query, unique matched create, update, task,
  internal notification, relative/absolute wait and outgoing webhook steps.
- Assigned task inbox resolution, same-step retry after a unique constraint
  failure, and cancellation of a waiting execution after runtime restart.
- Incoming webhook once-only secrets, rotation, duplicate receipts and payload
  conflicts; outgoing destination revision pinning and disabled delivery.
- Scheduled owner identity and fresh permission revocation before native jobs
  or host operations run.

The original engine contracts additionally cover collection triggers and filter
operators, transaction checkpoints, leases/recovery, failed/blocked retries,
webhook delivery and retries through an injected local transport, and bundles.
Core integration tests cover compiled extension registry forwarding, forged and
expired authority, tenant isolation, body binding, and native/graph ancestry.

Core migration 0058 preserves the existing native record-history cause contract
(`cause_id = execution ID`) while collection outbox events receive structured
ancestry from transactional write context. The mixed-runtime test starts at
graph depth two, admits native depth three, writes depth four, and refuses the
native depth-five boundary. Checkpoint context is cleared after the write.

## Commands and results

Counts overlap where focused suites also belong to a complete suite; they are
not summed as independent coverage.

| Check                                                       | Result                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm --filter @savia/flows test`                           | 13 local integration tests passed                             |
| `pnpm --filter @savia/flows-api test`                       | 869 tests passed, 65 files                                    |
| `pnpm --filter @savia/flows-app test`                       | 117 tests passed, 18 files                                    |
| `pnpm --filter @savia/studio-server test`                   | 324 passed, 7 skipped; 47 passed and 2 skipped files          |
| `pnpm --filter @savia/flows-native test`                    | 45 original workflow/webhook contracts passed                 |
| Focused Core Flows and scheduler suites                     | 56 tests passed, 7 files                                      |
| Focused shared workflows/positions/ancestry suites          | 16 tests passed, 3 files                                      |
| Focused Admin bridge/entry suites                           | 35 tests passed, 3 files                                      |
| Focused original history/outbox/workflow suites             | 31 tests passed, 3 files                                      |
| Core, Flows API, Flows app and native package type checks   | Passed                                                        |
| Admin type check, generated API types and production build  | Passed, including child Flows assets                          |
| Flows API Wrangler dry-run bundle                           | Passed locally, no deployment                                 |
| `pnpm --filter @savia/flows verify:source`                  | 1,897 imported files, 526 unchanged node files, 48 categories |
| Scoped Prettier and indexed/working-tree `git diff --check` | Passed                                                        |

## Browser evidence

Native Chrome used the actual parent bridge, Core D1 and local Worker with a
synthetic tenant. The sample flow has a condition branch, create, assigned task
and durable wait. Verification included:

- Editing a transform label and saving it.
- Moving the transform node with the pointer, saving, reloading, and confirming
  the changed backend coordinates and label.
- Running the published version while a different draft revision exists.
- Seeing a completed execution, resolving its assigned task, then reloading
  with no pending inbox task.
- Expanding completed step details and reading the persisted transform output.
- Opening the inspector at 390 by 844 and closing it to return to the canvas.

Browser review corrected cramped nested value controls, parent theme token
propagation, and labels for composite/empty values. The latter has a five-case
regression test that failed for the three missing label targets before the fix.
The editor also follows the parent light/dark colors. The two earlier Inter
font findings were fixed by adopting Savia's local Avenir Next/Helvetica Neue
stack; no findings were suppressed or left standing from those two warnings.

The browser fixture is an isolated preview, not the complete authenticated
Admin login flow. The full Admin shell is covered by build/type checks and
focused bridge/entry tests. The blocked retry action is covered by rendered UI
regression tests and the original backend retry contracts.

A subsequent [live collection demonstration](2026-10-12-savia-flows-live-demo.md)
also verifies the complete authenticated Admin application, collection editing,
automatic durable execution and its details inside Savia. It records two
integration fixes discovered beyond this initial isolated preview.

## Boundaries

The SQLite/D1 migrations ran under Miniflare. PostgreSQL 0058 and its manifest
were reviewed and source hashes checked; no PostgreSQL server was started.
Whole-monorepo tests/lint were not run; root formatting has known unrelated
failures, and verification focused on the affected packages and contracts.
Builds retain upstream sourcemap/module-directive and large-chunk warnings.

Already queued pre-upgrade runs with opaque legacy causes keep their depth cap
but cannot reconstruct earlier workflow identities for own-change filtering.
New mixed-runtime writes retain both identities and depth. The user identified
existing data as disposable test data; no destructive reset was needed.

The local native scheduler denies outbound delivery, including loopback.
Provider implementations retained from Dafthunk remain unavailable unless
their dependencies are supplied and activation is explicitly authorized.
The optional native-subflow composition node is a later capability, not part
of the prior Studio functionality or this replacement.
