# Production backups in private R2

> **For agentic workers:** Use the existing native subagents for the independent infrastructure and archive-client tasks; the coordinator owns integration and deployment.

**Goal:** Keep production recovery archives in private Cloudflare R2, remove production database artifacts from GitHub, and exercise the protected production infrastructure/release path.

**Architecture:** Pulumi owns a protected production-only Standard bucket and its 30-day lifecycle. GitHub orchestrates capture, encryption, verified S3 upload, and freshness checks; it never retains database artifacts. Source D1/R2 credentials, state-backend credentials, archive credentials, and the archive encryption key remain separate.

**Tech stack:** Cloudflare D1/R2, Pulumi, Wrangler, Node.js 22, AWS CLI, GitHub Actions.

**Specification:** The user's approved request and `docs/runbooks/pulumi-infrastructure.md` define the production-only scope and existing hybrid deployment model.

## Constraints and acceptance

- Preserve production data, database identities, namespace identities, and deletion protection. Reject destructive Pulumi plans.
- Use `savia-production-backups`, a `production/` object prefix, encrypted archives, verified readback, and a committed completion record.
- Keep preview isolated and exclude the backup bucket from its resources and production application-data snapshots.
- Remove both daily and release database artifact uploads from GitHub. Move and verify existing copies before deleting those artifacts.
- Require a successful retained R2 copy within 36 hours; check every six hours.
- Preserve branch checks, verified-preview promotion, and production environment review policies.

## Tasks

1. Infrastructure worker: add validated production-only bucket configuration, protected bucket/lifecycle resources, authoritative outputs, and naming/output regression tests. Typecheck all Pulumi programs.
2. Archive worker: implement the S3 upload/readback/commit protocol and R2 freshness checks with secret-safe failure handling. Test incomplete uploads, corruption, pagination, stale copies, and credential isolation.
3. Coordinator: replace daily and production-release artifact uploads, wire isolated archive credentials, strengthen workflow/preflight contracts, and update the runbook.
4. Review the combined diff, run contracts/typechecks, create a PR, and satisfy required checks. Apply only a reviewed saved Pulumi plan.
5. Seed bucket-scoped archive credentials securely; verify private access and lifecycle. Migrate and restore the existing encrypted GitHub copy from R2 before removing its GitHub artifact.
6. Merge and run the daily backup/freshness workflows from main. Download the exact R2 object and rehearse isolated restore.
7. Promote the verified main commit through the protected production workflow, inspect its Pulumi plan and deployment results, and verify gateway/auth health. Report any real blocker without bypassing policy.
