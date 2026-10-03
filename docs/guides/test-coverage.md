# Test coverage

Savia has a permanent local and CI workflow for measuring coverage across its
JavaScript and TypeScript source. Coverage is reported for source files under
each workspace's `src/` directory, including source that currently has no
tests. Each file is measured by its owning workspace's Vitest suite; a
cross-workspace import is credited only in the imported file's own workspace
suite. A workspace without tests receives zero coverage. Test files, type
declarations, and generated code are excluded. Native Rust code, contract
scripts, and the legacy `store-ports/` tree are outside this coverage run.

Coverage uses Vitest's native V8 provider for Node environments, preserving
functions that are serialized into isolated runtimes. Workspaces using the
Cloudflare Vitest plugin use Istanbul, which supports Workers without V8
inspector access. Keep both providers aligned with the Vitest version.

## Run coverage locally

From the repository root, run the full suite:

```sh
pnpm test:coverage
```

The full command runs every workspace and automatically merges the results into
the report files listed below. Use `pnpm coverage:report` after collecting
separate groups or shards, or to regenerate the merged report from existing
data.

The test command can also run one group or one shard. Admin runs in six shards,
the API in three, and Studio in two. The `core` group covers the remaining
workspaces; the `insurance` group covers insurance solution packages.

```sh
pnpm test:coverage --group admin --shard 1/6
pnpm test:coverage --group api --shard 1/3
pnpm test:coverage --group core
pnpm test:coverage --group insurance
pnpm test:coverage --group studio --shard 1/2
```

Each test run writes a `coverage-final.json` report and a `status.json` file to
its own directory under `coverage/raw/`. A failing test command exits with a
failure status while keeping any coverage data it produced. This makes failed
runs useful for diagnosis and ensures the report can label missing or failed
groups.

The report command merges the available raw data and writes:

- `coverage/index.html` for browsing file and line detail.
- `coverage/lcov.info` for tools that consume LCOV.
- `coverage/coverage-summary.json` for machine-readable totals.
- `coverage/summary.md` for a concise status and totals.

The summary marks the result incomplete or failed when an expected group or
shard is missing or did not pass. It also rejects raw results whose source
fingerprint differs from the current checkout, so grouped runs cannot silently
mix results from different source snapshots. After changing source or dependencies,
rerun the full command to replace old results. The initial baseline has no coverage
thresholds; the reports establish visibility before the team sets targets.

## Continuous integration

The separate **Coverage** workflow runs on pushes to `main`, pull requests, and
manual dispatch. Its 13 parallel lanes execute six Admin shards, three API
shards, the remaining core workspaces, insurance packages, and two Studio
shards. Each lane uploads its raw reports even when tests fail. A final job
downloads those reports, merges them, adds `summary.md` to the workflow run, and
uploads the complete `coverage/` directory as the `coverage-report` artifact
for 14 days.

Coverage describes the exact commit used by that workflow run. It is not a
live badge or a measure of whichever branch currently happens to be checked
out.
