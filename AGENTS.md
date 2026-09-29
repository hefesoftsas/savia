# AGENTS.md

Repo: Savia — general-purpose low-code platform (Cloudflare Workers +
D1/R2, pnpm monorepo). Human docs in `docs/` (index: `docs/README.md`);
onboarding in `docs/onboarding/`.
Industry capabilities are optional solution packages, not assumptions of the platform core.

## Commands

- `pnpm dev` local stack · `pnpm install` after dep changes
- `pnpm test` (unit + contracts) · lanes: `test:unit:admin`, `test:unit:api`,
  `test:unit:workspace`, `test:contracts`
- `pnpm run typecheck` · `pnpm run lint` (prettier; pre-existing red on main)
- One package: `pnpm --filter @savia/<name> test`

## Rules

- Conventional commits (`feat|fix|docs|chore|ci|refactor|test:`), English.
- Code, tests, and docs in English.
- Don't resurrect retired tooling: Bruno, `provider-gateway`, `bruno-runner`,
  `auto_light_quotes` (see `docs/onboarding/06-glossary.md`).
- API reference is generated (OpenAPI/Scalar), never hand-written.
- A behavior change updates its guide in `docs/` or marks it obsolete.
- Ports: admin 5173, api 8787, auth 8788, mcp 8789, legacy 8790,
  savia-request 8797. Local secrets in `infra/secrets/` (gitignored).

## Codex orchestration

- Astra owns planning, architecture decisions, integration, and final review.
  Delegate bounded, independent work to Luna when it improves speed or context
  isolation. Complete small changes and tightly dependent steps directly.
- Use `gpt-6-luna` with `high` reasoning for delegated work; set both explicitly
  when supported. Give workers a fresh context with the relevant requirements,
  file ownership, dependencies, acceptance criteria, and expected report.
- Keep at most two workers active across the task. Workers should report back
  rather than create further agents. Use native subagents; create sidebar tasks
  only when the user explicitly requests a new task.
- Assign disjoint files to concurrent writers. Serialize changes to shared files
  or use isolated worktrees when needed. Preserve other contributors' edits.
- Workers report completed changes, checks performed, and meaningful blockers.
  Continue useful local work while they run; use event-based waiting when idle.
  Avoid repeated status polling and re-reading unchanged output.
- Reuse a worker for follow-up fixes. Escalate unresolved design decisions to
  Astra. Review the combined diff and perform checks appropriate to the change
  before reporting completion; state checks that were not performed.
- Read `docs/guides/codex-orchestration.md` for setup and permission details.
