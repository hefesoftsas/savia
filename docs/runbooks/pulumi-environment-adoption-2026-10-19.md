# Environment ownership migration — October 19, 2026

Status: live adoption completed and independently verified on
`d1d968a95231f5ea9539feaff1fd51d523614654`. Preview remains operational;
production is defined, absent, and disabled.

## Execution evidence

- Implementation and compatibility fixes were integrated through
  [PR #352](https://github.com/hefesoftsas/savia/pull/352),
  [PR #353](https://github.com/hefesoftsas/savia/pull/353),
  [PR #354](https://github.com/hefesoftsas/savia/pull/354),
  [PR #355](https://github.com/hefesoftsas/savia/pull/355), and
  [PR #356](https://github.com/hefesoftsas/savia/pull/356).
- [Final required CI](https://github.com/hefesoftsas/savia/actions/runs/39313930453)
  passed on `075f346ce925d229c5c7e2c4293cb34e257dce40`; the merge into `main`
  preserved exactly that Git tree. Local validation passed 648 contract tests,
  five boundary tests, and all four Pulumi project typechecks.
- [The final audit](https://github.com/hefesoftsas/savia/actions/runs/39315184719)
  verified the exact merged revision. Its three existing checkpoint fingerprints
  matched the preserved post-transfer checkpoints exactly. Cloud metadata matched
  the original baseline and contained no unclassified Savia resources.
- [The successful migration](https://github.com/hefesoftsas/savia/actions/runs/39315572265)
  adopted the retained resources and verified two refreshed plan/metadata passes.
  Independent inspection of its authenticated, encrypted custody artifact
  confirmed all four checkpoints, management protection, environment ownership,
  and both stable passes.

## Verified ownership

| Environment     | Pulumi project/stack                                   | Workers | DO namespaces |  D1 |  R2 |  KV | Queues | Vectorize |
| --------------- | ------------------------------------------------------ | ------: | ------------: | --: | --: | --: | -----: | --------: |
| Preview         | `savia-cloudflare/preview`                             |      10 |             8 |   3 |   4 |   1 |      2 |         1 |
| Retained branch | `savia-branch-preview/branch-feat-secop-tender-tracke` |       6 |             0 |   2 |   1 |   0 |      0 |         0 |
| Shared registry | `savia-shared-registry/shared`                         |       1 |             0 |   0 |   1 |   0 |      0 |         0 |
| Management      | `savia-management/management`                          |       0 |             0 |   0 |   1 |   0 |      0 |         0 |
| Production      | `savia-cloudflare/production` (absent)                 |       0 |             0 |   0 |   0 |   0 |      0 |         0 |

Preview also owns two crons, one custom domain, one route, one Workflow, and one
queue consumer. The retained branch owns one cron. Every retained Savia resource
has its expected project/stack owner; no unclassified resource remains.

The existing `savia-pulumi-state-preview` backend bucket is owned solely by the
management stack and remains protected. The transfer preserved its physical
identity, inputs, outputs, and contents. The successful resume skipped the
already completed state move. No second backend bucket was created.

The cloud metadata fingerprint stayed
`2f66fd5fc7928a40b456d2adf9ccfca9ed7aa89adec85e9598d19f65f90d59ac`
across the baseline and both final passes. Adoption imported existing identities
and recorded runtime ownership without publishing Worker versions or writing
business data. DO identities and persistence resources remain retained.

## Restored operation

All nine original workflow states were independently verified after restoration.
Preview, branch, QuickJS, registry, and infrastructure workflows are active.
Production deployment, backups, freshness, and variable-import workflows remain
manually disabled. `PRODUCTION_OPERATIONS_ENABLED` remains `false`.

Post-adoption checks returned HTTP 200 for Preview health and login, with no
redirect; health reported both service and database `ok`. The shared registry's
protected `/v1/plugins` endpoint retained its expected unauthenticated HTTP 401.

The only approved permission exception was adding account-scoped Vectorize Read
to the existing CI token. No token was created or rotated, and no new write
permission was added. Raw checkpoints, configuration snapshots, and recovery
journals remain in private custody; the CI custody artifact is encrypted.

Use the [ownership procedure](pulumi-environment-ownership.md) for subsequent
operations. Fresh checkouts restore applied public runtime configuration and
reset one-time import flags. Production still requires a separately authorized
operation through its existing gates. Disposable lifecycle fixture evidence is
recorded in the [probe report](../superpowers/specs/2026-10-19-pulumi-runtime-probe.md).
