# Epic: Drop Unused Legacy Tables (D1 + Postgres + Generated Code)

**Goal:** Remove 194 of 199 legacy Django tables (phases 1–2: 190 dead tables; phase 3: rebuild the 5 live customer tables without FKs to 4 retired parents and drop them). Keep exactly the 5 live sync tables. Shrink D1 333 → 139 tables with Postgres in parity, without breaking replay, sync, or tests.

**Context:** `packages/db/migrations/0006_full_source_schema.sql` projected 199 legacy tables into D1 (251 KB, 4.582 lines) with a matching `packages/db/src/internal-schema.generated.ts` (3.161 lines, `internalTables` with zero importers) and `packages/db/postgres/0001_baseline.sql` (4.412 lines). The system runs on raw SQL via `dialectFor` (`studio_*`, `workflows`, `tenants`, `identity_*`, `crm_*`) plus 5 live `customer_*` tables. A full-repo audit (runtime SQL, post-0006 triggers/views/FKs, tests, `scripts/*.mjs`) plus FK-closure analysis set the final tally: drop 194, retain 5. `apps/api/test/schema.test.ts` froze the total first at 333, then 224, then 143, now 139.

**Phase 3 note (2026-09-24):** removing the 4 FK parents required rebuilding the 5 live tables without those constraint clauses (`0071`, generated — never hand-written). Two SQLite mechanics forced the design, both proven empirically: (1) deferred FK violations are recorded at `DROP` time and only cleared by a _later_ parent-key insert, so drop+rename+insert-before-drop fails at `COMMIT` — the migration stages data through `__stg` tables and copies back _after_ the drops; (2) `RENAME TO` fails while any trigger references the transiently-missing name, so the design uses create-new/drop-old with final names and recreates the 13 triggers (byte-identical from `0042`) plus `0006` indexes afterward. Verified with FK-linked seed data in one explicit transaction: row-identical copy, triggers fire with parity output, 0 FK violations. PG side needs no rebuild (`ALTER TABLE … DROP CONSTRAINT`, `0013`). App not in production, so no concurrent-write window applied.

**Architecture:** Additive, immutable-migration style. `0006` is never edited. `0069_drop_unused_legacy_tables.sql` dropped the first 109 dead tables and `0070_drop_remaining_legacy_tables.sql` drops 81 more (`DROP TABLE IF EXISTS`, children-first topological order; the single self-reference cycle `renewal_renewal -> renewal_renewal` needs no ordering). Both run after `0046` (whose DML touches dropped tables while they still exist). `0071` rebuilds the 5 (see phase-3 note). The generated Drizzle mirror is trimmed by script to the final 5. Postgres gets matching `0011`/`0012` drops plus `0013` (constraint drops). Tests and manifests track the inventory (333 → 224 → 143 → 139 D1 tables).

**Tech Stack:** TypeScript, SQLite/D1, PostgreSQL, Drizzle (generated mirror only), Vitest, Node contract tests. No new dependencies.

**FK closure (2026-09-24 verification):** phase 1 kept 8 extra tables as FK parents; phase 2 recomputed the closure around the 5 sync tables and found only 4 true parents must stay (`customer_client`, `customer_group`, `business_commercialunit`, `app_economicactivity`). Final tally: drop 190, retain 9. Full replay of migrations `0000`–`0070` in scratch SQLite with `PRAGMA foreign_keys=ON` passes: 143 tables, 55 triggers intact, 0 FK violations.

**Spec:** Audit evidence in this epic (tables lists below). No separate spec doc.

## Global Constraints

- Old migrations are immutable (see `0068_rename_engine_crm_to_studio.sql` header). Only add new migrations.
- `0046_tenant_user_invariant.sql` does `UPDATE/DELETE` across 51 legacy tables — all 51 stay until migrations are squashed (phase 2).
- Import scripts (`import-customer-domain.mjs`, `import-business-sample.mjs`, `parametric-catalog-migration.mjs`) still read ~40 legacy tables — those stay.
- CRM sync triggers (`0040`, `0042`) own the 5 `customer_*` tables — those stay.
- Code, tests, and docs in English. Conventional commits. A behavior change updates its guide or marks it obsolete.
- Work only in this worktree/branch. No deploys, no real user data changes.

## Retain vs drop

**Retain (5 legacy, all live sync tables):** `customer_clientagency`, `customer_naturalperson`, `customer_legalperson`, `customer_address`, `customer_legalpersoncontact`. Their 4 former FK parents are gone (see phase-3 note).

**Drop (190 total across both phases; phase-2 list = phase-1 list plus):** `api_key`, `app_bank`, `app_documenttag`, `business_agency_renewal_task_managers`, `business_agencycomplementarydata`, `business_agencycompliancemailbox`, `business_allianzconnectionkey`, `business_axaconnectionkey`, `business_bolivarconnectionkey`, `business_chubbconnectionkey`, `business_defaultcommission`, `business_equidadconnectionkey`, `business_hdiconnectionkey`, `business_mapfreconnectionkey`, `business_previsoraconnectionkey`, `business_qualitasconnectionkey`, `business_renewalconfiguration`, `business_sbsconnectionkey`, `business_seller`, `business_solidariaconnectionkey`, `business_suraconnectionkey`, `business_zurichconnectionkey`, `claim_claim`, `claim_claimstatus`, `claim_claimsubstatus`, `claim_claimtype`, `compliance_compliancecancellationreason`, `compliance_complianceprogramtype`, `compliance_compliancerequest`, `compliance_compliancetag`, `compliance_processstepemailtemplate`, `customer_clientlog`, `customer_consortium`, `customer_customersellershare`, `customer_document`, `customer_document_tags`, `customer_prospect`, `customer_prospectdocument`, `customer_prospectdocument_tags`, `customer_prospectlog`, `financial_statements_accountnormalization`, `financial_statements_agencyauthentication`, `financial_statements_financialreportfile`, `financial_statements_financialreportrequest`, `financial_statements_financialreportrequest_agencies`, `financial_statements_financialstatement`, `help_request`, `help_requestcategory`, `insurance_agencyshare`, `insurance_endorsement`, `insurance_policy`, `insurance_reinvestmentactivity`, `insurance_term`, `notification_configuration`, `notification_emailtemplate`, `notification_externalnotification`, `operation_collectionfile`, `operation_payment`, `operation_portfolioreconciliationfile`, `operation_reconciliationfile`, `operation_reimbursementreport`, `operation_settlement`, `operation_task`, `operation_taskassignmentrule`, `operation_tasktag`, `operation_tasktype`, `production_data_importproductiondatafile`, `production_data_standardizeinsurer`, `production_data_standardizeramo`, `renewal_initialstepconfig`, `renewal_nonrenewalreason`, `sales_contractlead`, `sales_entity`, `sales_holder`, `sales_operator`, `sales_plan`, `sales_product`, `sales_provider`, `sales_sale`, `user_role`, `user_user`, plus the 4 phase-3 parents (`customer_client`, `customer_group`, `business_commercialunit`, `app_economicactivity`) and the 109 phase-1 tables (full 194-name inventory enforced by migrations `0069`/`0070`/`0071` and the generator exclusion set).

## Tasks

- [x] Task 1 — D1 migrations `0069` (109 drops) + `0070` (81 drops) + `0071` (rebuild 5 without legacy FKs, drop 4 parents).
- [x] Task 2 — Trim `internal-schema.generated.ts` to the final 5 (script-filtered, header kept).
- [x] Task 3 — Update `apps/api/test/schema.test.ts` count 333 → 224 → 143 → 139; dropped-table assertions removed/repointed at `customer_clientagency`; `identity.test.ts` fixture updated.
- [x] Task 4 — Postgres `0011` + `0012` + `0013` (all apply cleanly on live PG16) + manifests: 80 sourceMigrations, tables 325 → 131, objects pruned (0 triggers touched). Checksum-pin test green.
- [x] Task 5 — Refresh `docs/full-d1-schema-manifest.json` (tables 209 → 19) and retire the 3 legacy import scripts + tests with their `package.json` lint/contracts entries.
- [x] Task 6 — Verify: `pnpm run typecheck` clean; `apps/api` 547/547; `studio-server` 213/213; contracts 60/60; migration contract 7/7; D1 replay `0000→0071` with FKs on (139 tables, 0 violations); seeded single-transaction replay of `0071` (row-identical copy, triggers fire with parity, 0 violations); PG `0011`/`0012`/`0013` apply clean standalone with manifest parity; checksum-pin green. Pre-existing failures identical on main: 2 admin UI timing tests, 1 savia-request suite timing test, 9 PG-live tests (env issue in untouched `0005`).

## Out of scope (done or consciously left)

- The 5 kept legacy tables: the live sync path needs them relational (triggers + worker reads). Nothing else legacy remains: 194/199 removed.
- [x] Dead Drizzle exports pruned 2026-09-24: `schema.ts` keeps only `agencies` (sole importer: `tenant-fixtures.ts`); 3 misleading aliases removed from `core-schema.ts` (`agencyCrmConnections`, `agencyCrmConnectionAuditEvents`, `assistantActiveAgencies` — zero importers; the `agency_*` names live on as DB views from `0063`). Physical tables untouched (runtime uses raw SQL).
- [x] Legacy import scripts retired 2026-09-24 (`import-customer-domain`, `import-business-sample`, `parametric-catalog-migration` + tests): they populated dropped tables. Restorable from git if a re-import is ever needed.
- `api_key` quoted-identifier ambiguity — left retained by caution, recheck separately.

## Review focus

1. Migration replay from zero still passes with FKs on (drop order matters).
2. `0046` replay untouched (all its tables retained).
3. CRM sync triggers (`0040`/`0042`) untouched (all 5 tables retained).
4. No `src/` runtime SQL references a dropped table (audit says zero; re-grep in review).
