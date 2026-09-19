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

The old repository workflows remain disabled. The standalone production data
import workflow is disabled and additionally gated by
`PRODUCTION_OPERATIONS_ENABLED=false`. This variable does not control manual
application promotion.

Historical private branches and tags must not be pushed to the public repository.
External notification webhooks were not duplicated during migration.
