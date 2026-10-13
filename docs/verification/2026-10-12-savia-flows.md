# Savia Flows local edition verification

Date: 2026-10-12. Scope: the local Miniflare edition in `apps/flows`, its
Savia identity/tenant bridge, Admin assets and developer workflow.

## Source and availability

Dafthunk baseline: `66be3083dc6c5349e150de5c9631477942399896`.
The source verifier confirms 1,897 imported files, 526 unchanged node
implementations in 48 categories, and the original MIT license. There are
24 template definitions and 359 configured local node types. Source inventory
and locally available services are distinct; provider-dependent templates and
nodes cannot establish full live-provider parity in this edition.

No resource was deployed or provisioned. No cloud AI, remote binding, OAuth
provider, billable API, external delivery or container service was activated.
Outbound requests, including loopback HTTP, are denied by the local runtime.
Retained external integration/evaluation configs throw before test startup;
remote AI bindings and the upstream D1 HTTP migration credentials were removed.

## Automated checks

Each suite was run with its package-local Vitest binary to preserve the
Cloudflare Workers pool's matching peer context. These are distinct test cases,
not a sum of repeated executions.

| Check                                                               | Result                               |
| ------------------------------------------------------------------- | ------------------------------------ |
| Imported runtime                                                    | 382 files; 3,757 passed, 7 skipped   |
| Flows API                                                           | 58 files; 847 passed                 |
| Flows app                                                           | 12 files; 93 passed                  |
| Flows geo                                                           | 14 files; 265 passed                 |
| Flows utilities                                                     | 2 files; 34 passed                   |
| Host gateway, public routes and Savia Request regression            | 3 files; 29 passed                   |
| Host user preferences                                               | 1 file; 20 passed                    |
| Admin bridge/auth/assets/navigation                                 | 4 files; 59 passed                   |
| Root local runtime/developer contracts                              | 6 passed                             |
| Real local Miniflare integration and runtime policy                 | 8 passed; process exits successfully |
| API, app, runtime, types, geo, utils, core API and Admin TypeScript | Passed                               |
| API Wrangler dry-run bundle                                         | Passed; no deployment                |
| Admin production build, including `/flows-ui/`                      | Passed                               |
| Frozen offline lockfile install                                     | Passed; build scripts ignored        |
| Pinned source/license verification                                  | Passed                               |

Relevant commands:

```sh
pnpm flows:verify
pnpm flows:typecheck
pnpm flows:test
pnpm --filter @savia/api test -- test/savia-flows.test.ts test/savia-flows-public.test.ts test/savia-request.test.ts
pnpm --filter @savia/api test -- test/user-preferences.test.ts
node --test scripts/dev-api-runtime.test.mjs scripts/dev-local.test.mjs
pnpm --filter @savia/admin build
pnpm install --frozen-lockfile --offline --ignore-scripts
```

The package suites, build and source checks above were also executed separately
during implementation. The repository-wide test/typecheck suites and the
pre-existing failing repository-wide formatting lane were not rerun as final
completion checks. Changed integration files were formatted and checked, and
`git diff --check` passed.

## Actual local runtime evidence

The Node integration tests use the bundled product Worker in Miniflare, apply
all 67 migrations, and use local D1/R2/SQLite Durable Objects, Workflows,
queues and WorkerLoader. They verify:

- Workflow creation, graph save/reload, synchronous and durable execution,
  result/history receipt and progress while waiting for human input.
- A signed human input link resumes the waiting execution; a second submission
  returns 409. Public form triggers validate and run a submitted form locally.
- JavaScript isolation produces the expected result; actual image WASM resizes
  a PNG to 16 by 16 pixels.
- Queue and scheduled triggers execute against local services.
- Secrets, binary objects and database data persist across restart with the
  same local state and keys. Cross-tenant objects are denied both through the
  object API and when inserted as graph parameter references.
- Flows API keys can be created and revoked. Savia Authorization, Cookie and
  signed bridge headers do not become execution inputs or persisted history.
- The actual host gateway/private service binding obtains an editor ticket,
  upgrades the socket and saves a graph. Revoking the role in the host causes
  the next socket command to close with 1008 and leaves the saved graph intact.
- Separate local runtimes resolve their private bindings in both directions
  using the shared `WRANGLER_REGISTRY_PATH`.
- Egress and remote-provider test activation are blocked without importing
  shell cloud credentials into the Worker.

The host/browser fixture uses a synthetic identity and an isolated disposable
role store. It is test-only code, never a product authentication bypass.

## Native browser evidence

On continuation, native Chrome was available even though its extension control
remained unavailable. The browser fixture served the actual built child app,
Savia host bridge, host gateway and Flows Worker with disposable local storage.
Desktop and 390-by-844 mobile screenshots were inspected.

The browser created **Savia visual smoke**, added Addition, entered `a=2` and
`b=3`, saved the graph and completed the run. Reload retained the workflow.
The execution list/detail showed completed history. A second run from the
final editor also completed; an authenticated fixture API read confirmed
execution `29793bf6-455e-47a7-adc8-091d2db5ab8e` stored inputs 2 and 3 and
output `result=5`. Overview/wiring and fit controls worked on desktop. The
dashboard displayed local workflow and execution counts without billing.

Mobile checks verified header navigation, closing it after navigation,
opening workflow properties and returning with **Back to canvas**, and the
graph's corrected initial frame. Dark theme propagation was visually checked.
The AI-authoring button is visibly disabled in the final local edition.

## Regressions repaired and checked

Fresh local execution exposed obsolete Miniflare persistence options,
non-SQLite Durable Object declarations, unsupported module rules and a durable
RPC header object that could not be cloned. The final integration tests use
the corrected native configuration and ordinary credential-filtered headers.

The imported API-key generator used `Uint8Array.toString("hex")`; its local
route failed before the byte conversion was corrected. Local key mint/revoke
now passes. Human input initially disappeared from history until the final
run completed; durable progress is now saved in local D1 before broadcasting.

Object reference conversion initially lacked organization ownership checks;
the red runtime tests and actual foreign-object graph execution now pass with
access denied. Socket identity originally retained revoked host roles until
lease expiration; every incoming command now obtains current authorization
through the private host binding. A clean lease expiry reconnects with a fresh
ticket, while clean revocation closes without retrying. The selected platform
workspace is also included for administrators with no tenant membership.

The final storage scan found an unused imported sidebar cookie writer. It was
removed; sidebar visibility is transient React state. The module has no
localStorage, sessionStorage, IndexedDB, Cache API or document-cookie persistence.

The subsequent design-hook font findings referred to inherited Inter rules.
Those rules were removed, and body/sans-serif typography now uses the same
`Avenir Next`, `Helvetica Neue`, sans-serif stack as Savia Admin. The child app
build and source/license checks passed after the correction. No hook suppression
was added; subsequent native screenshots verified the interface as noted above.

Native browser inspection found that the inherited dashboard gated rendering
on a cloud billing endpoint deliberately blocked by Savia. Billing/promotional
controls and Describe entrypoints were removed; regression tests verify local
statistics remain usable and read-only members cannot create workflows.
The manual tour no longer fetches or updates the standalone profile service.
Editor controls now have accessible names, and unavailable AI authoring has no
active generator branch.

The mobile inspector initially occupied the full canvas width. It now opens as
an overlay with a return action. A separate first-frame issue measured the
desktop layout before mobile detection, leaving the graph at minimum zoom.
Mobile detection now reads the media query synchronously; its regression test
failed before the change, and the final browser screenshot shows the saved
node framed correctly on a narrow screen. Temporary diagnostic attributes
were removed before the final build.

Miniflare 5's dev-registry watcher intermittently survived disposal after
queue activity. The managed local runtime withdraws bindings/closes the
registry watcher before disposal; the complete eight-test runner now exits.

## Limits

Live provider and billed integration/evaluation suites were deliberately not
run. Their unit tests use mocks; that evidence does not certify live external
compatibility. Container language/video nodes and AI authoring remain unavailable.

The browser check used a synthetic host wrapper rather than the complete
authenticated Admin shell. Native coordinate actions failed, so pointer drag,
port-to-port dragging and sidebar resizing were not verified interactively;
keyboard/accessible actions and the runtime graph/save tests provide the
recorded evidence. Touch input and other browser engines were not tested.

This record verifies the first local edition. Full external-service parity
requires a separately authorized implementation and verification phase.

An independent review identified the socket revocation window that was repaired
and covered by the actual host/Worker test. An earlier follow-up review stalled
and was stopped. On continuation, completed bounded UI reviews identified the
dashboard billing gate and inspected the final UI corrections; the final
read-only report found no concrete material bug in those files. That review
did not cover the full source import or certify external provider behavior.
