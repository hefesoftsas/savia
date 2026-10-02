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

- [Workspace layout](guides/workspace-layout.md) — mobile and desktop assistant access.
- [Savia Companion](companion/README.md) — desktop meeting capture validation, architecture, detailed epics and cross-platform evidence gates.

- [Codex orchestration](guides/codex-orchestration.md) — Astra coordination, Luna workers, and local permissions.

- [Core localization](localization.md) — ES/EN/PT coverage, translated labels, locale formatting and regression checks.

- [PostgreSQL for Docker](guides/self-hosted-postgres.md) — optional database, offline SQLite import, backup and recovery.
- [Licensing](licensing.md): revenue threshold, commercial licensing, source redistribution, and mandatory attribution.

- [Self-hosted Docker](guides/self-hosted-docker.md) — optional native deployment alongside Cloudflare, setup, persistence and operational limits.

- [Remote MCP](remote-mcp.md): connect Claude and ChatGPT to authorized collections and AI employees using OAuth.
- [Virtual AI employees](guides/virtual-employees.md) — tenant ownership, employee access, files and collection scope.
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
- [Record read performance](guides/record-read-performance.md) — exact counts, cursor pages, revisioned reads and indexed substring search.
- [Local D1 stress tests](guides/d1-local-stress.md) — isolated volume and concurrency probes.
- [Authentication loading](guides/authentication-loading.md) — shared app and OAuth pending states.
- [Tenant SAML SSO](guides/tenant-sso.md) — tenant identity providers, SSO-only access and account policy.
- [Keycloak SAML testing](guides/keycloak-saml-testing.md) — disposable real SAML integration tests.
- [Account email](guides/account-email.md) — email verification, password recovery, tenant SMTP settings and local Mailpit testing.
- [Social sign-in](guides/social-sign-in.md) — optional Google, Microsoft and ChatGPT sign-in, provider registration and tenant controls.

- [public-forms.md](public-forms.md) — optional public links, captcha, submission-only access and quotas.
- [cookie-consent.md](cookie-consent.md) — mandatory once-per-user cookie consent banner for the SPA and public forms.
- [permissions.md](permissions.md) — scoped roles, record and field permissions, revocation and rollout.

- [local-first-collections.md](local-first-collections.md) — local replicas, synchronization, recovery and deployment.

- [realtime-cost-controls.md](realtime-cost-controls.md) — realtime limits, hibernation and cost controls.

- [Insurance plugin coverage](insurance-plugin-coverage.md) — all 25 optional extensions, activation and provider prerequisites.
- [Insurance operations plugins](insurance-operations.md) — optional worklists, connected operations, installation and release packaging.
- [Insurance quoting](insurance-quoting.md) — quote history, performance, snapshots and deletion.
- [solution-packages.md](solution-packages.md) — installing/exporting solution packages.
- [plugin-store.md](plugin-store.md) — per-tenant ZIP plugin uploads, sandbox and activation.
- [legacy-api.md](legacy-api.md) — core API vs legacy API boundary.
- [custom-result-components.md](custom-result-components.md) — custom React result components.
- [runbooks/](runbooks/) — operational procedures (each states owner and review date).
- [../apps/admin/src/features/studio-engine/DESIGN.md](../apps/admin/src/features/studio-engine/DESIGN.md) — Studio engine design.
- [../packages/studio-server/API.md](../packages/studio-server/API.md) · [../packages/studio-server/INTEGRATIONS.md](../packages/studio-server/INTEGRATIONS.md) — Studio engine contract.

## Rules that keep this from rotting

1. API reference is **generated** (OpenAPI + Scalar at `/docs`), never hand-written.
2. Every operational doc states owner and review date; without that it gets archived.
3. One-off applied work goes to `archive/` (migrations, validation reports).
4. A PR that changes behavior updates its guide or marks it obsolete.
5. Irreversible decisions go to `adr/` (1 page, immutable).

- [Automatic refresh coverage and remaining gaps](guides/realtime-coverage.md)
- [Identity email uniqueness](guides/identity-email-uniqueness.md)
- [Tenant user capacity](guides/tenant-user-capacity.md)

- [Documents and deliveries](guides/document-delivery.md): saved attachments, OneDrive copies and confirmed Outlook sends.
- [Personal pages](guides/pages.md): private and shared documents, collection views, history and attachments.
- [Jira and Linear issue links](guides/issue-links.md): read-only personal connections and safe transient previews.

- [Initial database baseline](guides/database-initial-baseline.md) — fresh installation and pre-production reset.

- [Shared private plugin registry](guides/plugin-registry.md): publish immutable releases once and import them across environments.

- [Tenant email registration](guides/tenant-registration.md): independent tenant opt-in, Turnstile/ALTCHA configuration, verified Viewer provisioning and quota handling.

- [Plugin development kit](guides/plugin-development.md): scaffold, SDK, generic UI, local iframe development, and testing.
