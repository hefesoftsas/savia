# Public repository operations

The public repository is published from a reviewed snapshot with a new root
commit and neutral author metadata. Historical private branches, tags, data,
local environments, and audit reports are not part of that publication.
Never use `git push --mirror` or `git push --all` from the historical checkout.

## Continuous integration

CI runs on standard GitHub-hosted `ubuntu-24.04` runners with read-only
permissions. It requires no deployment secrets. Source changes run unit tests,
contract tests, type checks, and publication safety checks. Gitleaks scans the
reachable history; only two exact synthetic test keys are allowlisted. Manual CI runs are available from Actions.

## Preview and production

Preview deploys automatically after successful `main` push CI. Production is
manual-only, requires successful preview for the same commit, revalidates CI,
and waits for the protected production environment approval. Deployment secrets
remain environment-scoped. See [preview and production operations](preview-production.md).

Production is currently stopped; its definitions and workflows are retained for
a future rebuild. `PRODUCTION_OPERATIONS_ENABLED` is currently `false` and gates
manual application promotion, production Pulumi dispatch, backup/freshness jobs,
and the standalone production data import. Previously disabled workflows must
also be explicitly re-enabled before use. See
[production rebuild](production-rebuild.md); restoring source does not recreate
the deleted environment or its data.

Historical private branches and tags must not be pushed to the public repository.
External notification webhooks were not duplicated during migration.
