# Environment ownership migration — October 19, 2026

Status: implementation prepared in [PR #352](https://github.com/hefesoftsas/savia/pull/352);
live ownership transfer and adoption have not run. This record contains preflight
observations, not completion evidence.

## Verified preflight

Read-only Cloudflare metadata confirms the following intended environment
membership. These counts do not assert that new Pulumi ownership is already live.

| Target environment                         | Workers | DO namespaces |  D1 |  R2 |  KV | Queues | Vectorize |
| ------------------------------------------ | ------: | ------------: | --: | --: | --: | -----: | --------: |
| Preview                                    |      10 |             8 |   3 |   4 |   1 |      2 |         1 |
| Retained `branch-feat-secop-tender-tracke` |       6 |             0 |   2 |   1 |   0 |      0 |         0 |
| Shared registry                            |       1 |             0 |   0 |   1 |   0 |      0 |         0 |
| Management backend                         |       0 |             0 |   0 |   1 |   0 |      0 |         0 |
| Production                                 |       0 |             0 |   0 |   0 |   0 |      0 |         0 |

Preview also has two crons, one custom domain, one route, one Workflow and one
queue consumer. The retained branch has one cron. Every retained Savia resource
in this metadata snapshot matches a defined environment policy; no unclassified
Savia resource was found. Other applications' resources remain outside this
migration.

The original mutating workflow states are recorded privately. Preview, branch,
QuickJS, registry and infrastructure workflows remain active. Production deploy,
backup, freshness and variable-import workflows remain manually disabled.
`PRODUCTION_OPERATIONS_ENABLED` remains disabled. No workflows have been frozen,
no remote checkpoint has moved and no Worker version or business data has changed
as part of this ownership migration.

Local verification passed 632 contract/infrastructure tests plus five boundary
tests, all four Pulumi project typechecks and the runtime fixture typecheck.
Disposable integration fixtures already proved cold bootstrap, dynamic in-place
updates, failed-update recovery and data-preserving retirement/recreation with
the same DO namespace identity and DO/D1/R2/KV values. Their complete cleanup is
recorded in the [probe report](../superpowers/specs/2026-10-19-pulumi-runtime-probe.md).
A fresh whole-branch review and follow-up fixes have no outstanding findings.

## Pending controlled operation

The protected Preview environment allows only `main`. Required GitHub checks
must pass before integrating reviewed source under the recorded workflow freeze,
then running the protected-CI audit and explicit state transfer/adoption from
that exact `main` revision. No access policy or credentials will be broadened.

At preflight time, GitHub Actions runs remained queued during the reported
[Actions, Pages and webhooks availability incident](https://www.githubstatus.com/incidents/8tzbpcnl75jp).
The CI security follow-up pins reviewed preview assets to the producing job's
immutable artifact ID and extracts them outside both checkouts; only static asset
files enter the trusted artifact freezer. Version-2 audit evidence must explicitly
account for all Savia resources before workflow or state mutation.

Follow the [ownership procedure](pulumi-environment-ownership.md). Completion
requires the actual successful audit/migration run IDs, independent management
protection, two stable refreshed plans/metadata comparisons, Preview and registry
verification, and restoration of the original workflow states. Update this
record with that evidence only after those operations succeed.
