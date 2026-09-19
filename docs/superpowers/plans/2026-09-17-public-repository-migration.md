# Public Repository Migration Plan

**Goal:** Publish an audited source snapshot with GitHub-hosted CI and production operations disabled.

**Architecture:** Keep historical branches private. Publish a new root commit with neutral author metadata. Use GitHub environment secrets for production and a disabled-by-default repository variable for all production jobs.

## Constraints

- No production deployment, database reset, or data import during migration.
- No credentials, business records, database dumps, or private personal identifiers in published source or history.
- CI uses ephemeral GitHub-hosted Linux runners with read-only permissions.

## Steps

- [x] Audit tracked source, reachable main history, data files, and credential patterns; keep detailed findings outside Git.
- [x] Update workflow safety contracts before switching runners and disabling production triggers; run the contracts.
- [x] Document manual production enablement and the publication boundary.
- [x] Copy repository configuration and securely transfer available production secrets without logging plaintext.
- [ ] Publish only the audited snapshot and verify public history, repository settings, and CI results.
