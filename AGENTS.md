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
