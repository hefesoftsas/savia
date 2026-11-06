# 06 — Glossary and archaeology (reference)

Old terms that show up in history, issues, and archived docs. None of this is
the current path.

| Term                                   | What it is                                                                            | Current path                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `auto_light_quotes` / light quoter     | First quoter (`/v1/auto-light-quotes`, `auto_light_quote_*` tables), retired Sep-2026 | savia-request (`/v1/savia-request/*`)                                                |
| Bruno (`.bru`, `integrations/bruno`)   | Provider collections + generation pipeline (`sync/export/import*`)                    | savia-request `catalog.json`; the `bru.*` shim in hooks is its own API, not the tool |
| `provider-gateway` (`savia-providers`) | Worker with Bruno-converted templates                                                 | Out of the live path; the runtime uses savia-request                                 |
| `legacy-api` vs `api`                  | Legacy API (Postgres) vs core API (D1)                                                | they coexist; boundary in [legacy-api.md](../legacy-api.md)                          |
| `spatial_ref_sys`, `geography_columns` | PostGIS tables from the legacy source                                                 | don't exist in D1 (see `schema.test.ts`)                                             |

Next: [07-lowcode.md](07-lowcode.md).
