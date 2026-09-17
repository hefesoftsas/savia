# 01 — Product (30 min)

Savia is a low-code platform for insurance agencies, deployed on Cloudflare
Workers + D1/R2. Each agency operates in its own space with its customers,
and the platform adds CRM, insurer quoting, and an AI assistant.

## Actors

- **Agency advisor**: quotes, compares offers, manages customers and policies.
- **Platform administrator**: operates across agencies, configures domains,
  integrations, and provider credentials.
- **Insurer (provider)**: Sura, SBS, Equidad, Liberty, Mapfre, Qualitas,
  Bolívar, Allianz, HDI, Zurich — invoked over API/SOAP with per-agency
  credentials, never from the browser.

## Pieces the user sees

1. **Admin web** (`apps/admin`): React Admin panel + low-code designer
   (domains, objects, screens, forms) at `#/crm`.
2. **Quoter (savia-request)**: the advisor requests a quote; every intent and
   offer is persisted before executing against the provider; retries create
   new attempts, they never mutate the previous one.
3. **Assistant**: bar available on authenticated screens; reads data over MCP
   and prepares changes the user explicitly confirms.
4. **CRM**: contacts/companies, HubSpot sync per agency (manual or automatic
   queue).
5. **Solution packages**: configuration installable per space
   (`solutions/insurance/`); see [solution-packages.md](../solution-packages.md).

## What it does NOT do

No policy issuance, no automatic retries against insurers, and no secrets in
the browser (templates and credentials live in Workers).

Next: [02-architecture.md](02-architecture.md).
