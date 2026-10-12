# Central Savia infrastructure implementation plan

> **For agentic workers:** Use the existing worktree and bounded native workers.
> Do not create further agents or mutate cloud resources from delegated work.

**Goal:** Integrate PR #277 first and make `infra/pulumi` the authoritative
Cloudflare resource and Worker configuration project, including disabled Flows.

**Architecture:** Pulumi provisions independent storage and queue resources.
The infrastructure project's renderer generates manifests consumed by Wrangler,
the only Worker publisher. Existing preview imports are adopted before optional
Flows activation.

**Tech stack:** Pulumi, Cloudflare provider, Node.js, TypeScript, Wrangler.

**Spec:** `docs/superpowers/specs/2026-10-12-savia-central-infrastructure.md`.

## Constraints

- Preserve both worktrees and all current Savia Flows changes.
- First cloud apply has zero resource creates, updates, replacements, or deletes.
- The subsequent backend bootstrap may create exactly one private protected R2
  state bucket; existing application resources stay unchanged.
- Flows and paid optional integrations remain disabled by default.
- Keep preview/production IDs, secrets, and namespaces isolated.
- Use one publisher per Worker-attached resource.

## Review focus

- A stack name disagreeing with its resolved environment must fail before writes.
- Disabled Flows must neither provision resources nor add a host service binding.
- Existing settings must survive renderer relocation and main integration.
- Backups must survive relocation and must not claim completeness while writes occur.
- CI must use the same imported state and outputs as the local program.

## Tasks

1. [x] Integrate current main in PR #277, preserving both sides of `.gitignore`
       and all contract test entries in `package.json`; rerun IaC baseline tests.
2. [x] Verify and fix outstanding recovery findings in `backup.mjs`,
       `d1-table-dump.mjs`, `restore.mjs`, `destroy.mjs`, and their tests. Use meaningful
       failing tests before fixes; perform no destructive cloud recovery operation.
3. [x] Move the Worker renderer into `infra/pulumi` with a compatible wrapper in
       `scripts/`; add Flows naming, resources, output validation, and an explicitly
       disabled cloud activation flag. Test isolation, defaults, IDs, and bindings.
4. [x] Connect preview deployment to imported Pulumi state and generated outputs;
       preserve migrations/secrets/Worker publication ownership. Use a configured
       backend, never a fresh empty state against existing resources. Verify contracts.
5. [ ] Review the combined diff, run IaC and deployment checks, refresh the live
       preview, apply only a no-resource-change existing stack, and update PR #277.
       Report exact deployed scope and any concrete external blockers.

## Execution record

- Baseline: 37 helper tests passed; preview remote plan reports `same: 4`.
- Decision: keep Wrangler as sole Worker publisher; all declarations move into
  the infrastructure project. Pulumi/Worker double ownership would cause drift.
- Decision: Flows resource activation is deferred; the user requested IaC first,
  and previously required authorization for billable external services.

- Adoption applied successfully: `same: 4`, no application-resource changes.
- Decision: shared CI state needs its own R2 bucket. Reuse the existing token
  and its S3 credentials; do not create another credential or widen access.

- Shared state migrated successfully to the protected R2 backend, preserving the
  imported application identities. Four preview CI backend secrets configured
  using the existing token permissions, with no new access grants.
- A clean Pulumi home reads the configured remote backend. Explicit backend
  validation/login/select now precedes rendering; no implicit state creation.
- Remote deployment helper applied `same: 5` and generated preview manifests.
- Scope completion: centralize branch preview provisioning/teardown, auxiliary
  Worker manifests, shared registry adoption, explicit Vectorize bootstrap and
  application setup; preserve all existing cloud endpoints and data identities.
- D1 seed replay uses non-deleting UPSERTs, verified against real access-table
  foreign keys in in-memory SQLite.

- Shared plugin registry bucket adopted into the protected independent `shared`
  stack: one stack-state creation and one bucket import, no cloud resource
  changes or Worker publication.
- Final review fixed untrusted restore database names and account disagreement
  across Pulumi, Wrangler, standard/branch/shared profiles and restore.
