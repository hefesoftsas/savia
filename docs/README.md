# Documentation

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

- [Direct Office editing](office-editing.md): WASM editor, revision storage, runtime setup and deployment.

- [related-record-editing.md](related-record-editing.md) — related subforms, editable tables, atomic saves and recoverable drafts.

- [tenant-branding.md](tenant-branding.md) — tenant login pages, logos, colors and administrator permissions.

- [public-forms.md](public-forms.md) — optional public links, captcha, submission-only access and quotas.

- [local-first-collections.md](local-first-collections.md) — local replicas, synchronization, recovery and deployment.

- [realtime-cost-controls.md](realtime-cost-controls.md) — realtime limits, hibernation and cost controls.

- [solution-packages.md](solution-packages.md) — installing/exporting solution packages.
- [legacy-api.md](legacy-api.md) — core API vs legacy API boundary.
- [custom-result-components.md](custom-result-components.md) — custom React result components.
- [runbooks/](runbooks/) — operational procedures (each states owner and review date).
- [../apps/admin/src/features/crm-engine/DESIGN.md](../apps/admin/src/features/crm-engine/DESIGN.md) — CRM engine design.
- [../packages/crm-server/API.md](../packages/crm-server/API.md) · [../packages/crm-server/INTEGRATIONS.md](../packages/crm-server/INTEGRATIONS.md) — CRM contract.

## Rules that keep this from rotting

1. API reference is **generated** (OpenAPI + Scalar at `/docs`), never hand-written.
2. Every operational doc states owner and review date; without that it gets archived.
3. One-off applied work goes to `archive/` (migrations, validation reports).
4. A PR that changes behavior updates its guide or marks it obsolete.
5. Irreversible decisions go to `adr/` (1 page, immutable).
