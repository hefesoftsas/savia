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

## Preview and retired production

Preview deploys automatically after successful `main` push CI. The hosted Savia
production application deployment has been retired; preview is the only hosted
application environment available. Historical procedures remain in
[the Preview runbook and retired production records](preview-production.md).

The retired production workflows and the standalone production data-import
workflow have been removed. The shared plugin-registry deployment remains a
separate service used by preview.

Historical private branches and tags must not be pushed to the public repository.
External notification webhooks were not duplicated during migration.
