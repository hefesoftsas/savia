# 01 — Product (30 min)

Savia is a general-purpose low-code platform, deployed on Cloudflare
Workers + D1/R2. Workspaces organize collections, screens, integrations,
and workflows. Industry-specific capabilities, including insurance,
are optional solution packages rather than prerequisites of the core.

## Actors

- **Workspace user**: works with records, screens and assigned activities.
- **Workspace administrator**: configures collections and workflows within an authorized space.
- **Platform administrator**: operates across workspaces, configures domains,
  integrations, and provider credentials.
- **Optional insurance solution provider**: Sura, SBS, Equidad, Liberty, Mapfre, Qualitas,
  Bolívar, Allianz, HDI, Zurich — invoked over API/SOAP with per-agency
  credentials, never from the browser.

## Pieces the user sees

1. **Admin web** (`apps/admin`): React Admin panel + low-code designer
   (domains, objects, screens, forms) at `#/studio` (`#/crm` remains as
   a legacy alias).
2. **Quoter (savia-request)**: the advisor requests a quote; every intent and
   offer is persisted before executing against the provider; retries create
   new attempts, they never mutate the previous one.
3. **Assistant**: bar available on authenticated screens; reads data over MCP
   and prepares changes the user explicitly confirms.
4. **External CRM**: contacts/companies, HubSpot sync per agency (manual or
   automatic queue). "CRM" elsewhere in the UI now means this integration —
   the low-code designer itself is called **Studio**.
5. **Solution packages**: configuration installable per space
   (`solutions/insurance/`); see [solution-packages.md](../solution-packages.md).
6. **Workflows**: native record events, manual actions and schedules connected
   to versioned steps; see [workflows.md](../workflows.md). No industry solution
   is required.

## What it does NOT do

No policy issuance, no automatic retries against insurers, and no secrets in
the browser (templates and credentials live in Workers).

Next: [02-architecture.md](02-architecture.md).
