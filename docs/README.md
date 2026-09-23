# Documentation

- [External database sources](external-database-sources.md): PostgreSQL, MySQL, SQL Server, MongoDB, CRUD policies, and metadata synchronization.

Savia documentation hub. If you are new, follow the onboarding track in order.

## Onboarding (new developers)

| #   | Doc                                                            | Time      | Outcome                                    |
| --- | -------------------------------------------------------------- | --------- | ------------------------------------------ |
| 1   | [onboarding/01-product.md](onboarding/01-product.md)           | 30 min    | What Savia is, users, product pieces       |
| 2   | [onboarding/02-architecture.md](onboarding/02-architecture.md) | 45 min    | Workers, data, flows between services      |
| 3   | [onboarding/03-local-setup.md](onboarding/03-local-setup.md)   | 1–2 h     | Stack running on your machine + login      |
| 4   | [onboarding/04-workflow.md](onboarding/04-workflow.md)         | 30 min    | Layout, commands, CI, conventions          |
| 5   | [onboarding/05-domains.md](onboarding/05-domains.md)           | reference | Entry points to each code domain           |
| 6   | [onboarding/06-glossary.md](onboarding/06-glossary.md)         | reference | Legacy terms so history makes sense        |
| 7   | [onboarding/07-lowcode.md](onboarding/07-lowcode.md)           | 30 min    | Metadata model, designer, generated API    |
| 8   | [onboarding/08-plugins.md](onboarding/08-plugins.md)           | 45 min    | Trusted extensions: screens, host API, MCP |

## Standing guides

- [Core localization](localization.md) — ES/EN/PT coverage, translated labels, locale formatting and regression checks.

- [PostgreSQL for Docker](guides/self-hosted-postgres.md) — optional database, offline SQLite import, backup and recovery.
- [Licensing](licensing.md): revenue threshold, commercial licensing, source redistribution, and mandatory attribution.

- [Self-hosted Docker](guides/self-hosted-docker.md) — optional native deployment alongside Cloudflare, setup, persistence and operational limits.

- [Remote MCP](remote-mcp.md): connect Claude and ChatGPT to authorized collections and AI employees using OAuth.
- [low-code-fields.md](low-code-fields.md) — field types, temporal values and consistent record display.

- [navigation.md](navigation.md) — sidebar grouping, hidden destinations, direct links, and personal preferences.

- [my-day-widgets.md](my-day-widgets.md) — My Day collection widgets, layout persistence and plugin seam.

- [workflows.md](workflows.md) — general-purpose workflow authoring, execution, permissions and recovery.
- [notifications.md](notifications.md) — durable personal inbox for collection activity, assigned work, administrator messages and authentication events.
- [Direct Office editing](office-editing.md): WASM editor, revision storage, runtime setup and deployment.

- [record-history.md](record-history.md) — opt-in field change history, actor attribution, permission boundaries and bounded retention.
- [record-duplication.md](record-duplication.md) — duplicate safe scalar values into a new local record without copying identity, ownership or relations.
- [related-record-editing.md](related-record-editing.md) — related subforms, editable tables, atomic saves and recoverable drafts.

- [tenant-branding.md](tenant-branding.md) — tenant login pages, logos, colors and administrator permissions.

- [public-forms.md](public-forms.md) — optional public links, captcha, submission-only access and quotas.
- [cookie-consent.md](cookie-consent.md) — mandatory once-per-user cookie consent banner for the SPA and public forms.
- [permissions.md](permissions.md) — scoped roles, record and field permissions, revocation and rollout.

- [local-first-collections.md](local-first-collections.md) — local replicas, synchronization, recovery and deployment.

- [realtime-cost-controls.md](realtime-cost-controls.md) — realtime limits, hibernation and cost controls.

- [Insurance plugin coverage](insurance-plugin-coverage.md) — all 25 optional extensions, activation and provider prerequisites.
- [Insurance operations plugins](insurance-operations.md) — optional worklists, connected operations, installation and release packaging.
- [solution-packages.md](solution-packages.md) — installing/exporting solution packages.
- [legacy-api.md](legacy-api.md) — core API vs legacy API boundary.
- [custom-result-components.md](custom-result-components.md) — custom React result components.
- [runbooks/](runbooks/) — operational procedures (each states owner and review date).
- [../apps/admin/src/features/crm-engine/DESIGN.md](../apps/admin/src/features/crm-engine/DESIGN.md) — Studio engine design (code still lives under `crm-engine/`, rename pending in Fase 2).
- [../packages/crm-server/API.md](../packages/crm-server/API.md) · [../packages/crm-server/INTEGRATIONS.md](../packages/crm-server/INTEGRATIONS.md) — Studio engine contract (package rename pending in Fase 2).

## Rules that keep this from rotting

1. API reference is **generated** (OpenAPI + Scalar at `/docs`), never hand-written.
2. Every operational doc states owner and review date; without that it gets archived.
3. One-off applied work goes to `archive/` (migrations, validation reports).
4. A PR that changes behavior updates its guide or marks it obsolete.
5. Irreversible decisions go to `adr/` (1 page, immutable).
