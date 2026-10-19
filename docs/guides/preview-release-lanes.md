# Preview release lanes

Shared Preview remains `https://savia-preview.hefesoft.com`. Successful CI for a
push to `main` triggers the existing release workflow. The workflow checks out
the exact tested commit and rejects superseded or foreign-repository runs.

## Compatible plugin updates

The fast lane accepts existing `packages/plugin-*` or `store-ports/*` packages
whose frontend files change with a strictly increased extension version. The
manifest must be identical apart from its version, and store declarations,
dependencies, build settings, permissions and schema must remain unchanged.
Unknown paths or metadata select a complete platform release. Tests-only changes
are checked without publishing another artifact; documentation does not change
the running platform.

CI executes the classifier from the trusted base revision, not the proposed PR
code. Missing trusted code falls back to full checks. The existing **Contract
tests** required check also guards classification and plugin validation failures,
so skipped platform jobs cannot hide an invalid plugin build. Shared code,
dependencies, infrastructure and uncertain changes still run Flows checks.

Publication compares the tested commit with the last successful Preview release
ancestor, rather than only its parent commit. Therefore an earlier failed
platform deployment cannot be skipped by a later plugin-only commit. Missing
history selects the full lane. A successful workflow without an unexpired
`preview-release` artifact for its exact main commit does not advance the baseline.

The publisher packages only changed plugins and updates their existing enabled
installations. It does not install optional plugins in new workspaces, reactivate
disabled installations, apply migrations, upload secrets, replace Workers, or
copy unrelated R2 state. Before any mutation it verifies live manifest/store
compatibility and writes a durable checkpoint with prior installation and
artifact data. Plugin ZIPs use fixed timestamps and modes so the same source produces the
same digest on retry. It publishes and verifies exact versions and digests. Partial
failure triggers rollback; a concurrent manual disable/version change is not
overwritten. Recovery checkpoints are retained as GitHub Actions artifacts under the
repository’s artifact access policy. They contain plugin source and installation
metadata, but no connector credentials or business documents.

Prior plugin artifacts remain available for recovery. The publisher fails
explicitly when the store quota is full; it never deletes history automatically.
The existing store limit remains ten versions per plugin. Review and archive
inactive versions through the normal management process when needed.

## Full platform updates

The complete lane preserves the established write pause, drain, Durable Object
snapshot, coherent D1/R2 backup, encrypted archive, infrastructure, migration,
Worker publication and recovery sequence. Production promotion remains separate.
The existing production gate still requires the full **Deploy preview** job; a
plugin-only Preview publication alone does not authorize production promotion.

API-based R2 downloads use four concurrent workers by default. Set
`--r2-concurrency 1` through `--r2-concurrency 8` on `infra/pulumi/backup.mjs` to
adjust the bound. Each object retains its expected size and content encoding.
An error stops new downloads and waits for in-flight downloads before failing;
no successful backup manifest is produced. Partial files may remain in a failed
backup directory and are not evidence of a restorable snapshot.

## Operations and measurements

Use one Actions watcher and verify the final tested commit, release kind,
artifact digest and enabled installation. Measure CI, publication and feature
development separately. A two-to-five-minute artifact publication is an
optimization target, not a guarantee for every feature or a replacement for
complete platform checks.

For coherent backup and failed-release recovery details, see
[Preview and production operations](../runbooks/preview-production.md).
