# Local legacy data migration into the domain preview

This procedure builds a **new** SQLite database. It never replaces the source or running preview database and makes no network/provider calls. Stop the preview API before a separate installation step; replacing a live SQLite file while its WAL is open is unsafe.

## Table policy

The reviewed allowlist is `BUSINESS_TABLES` in `scripts/migrate-domain-preview.py` (174 tables). It includes agencies and contacts, location/catalog tables, the full legacy customer/natural-person/legal-person/agency relationship/document/seller graph, policy/payment/claim/sales/renewal/compliance and other historical business tables, document ownership, and their explicit foreign-key closure. Every selected table is replaced as a whole; source IDs, row IDs, relationships, and values are preserved and compared by count and SHA-256 of the complete row stream.

The preview schema and migration journal remain authoritative. Schema/column mismatches or unreviewed foreign-key dependencies stop the build. An existing source FK inconsistency is reported separately from any newly introduced inconsistency; the latter prevents publication of the output.

Special cases:

- Retain the preview's local identity, roles, memberships, authentication and session state. Do not import source login identities, roles, memberships or sessions. A source business creator missing locally receives an inactive, synthetic identity with the same historical ID, no grants, and no source email or authentication subject.
- Copy only `connected` rows from `agency_crm_connections`, and retain all `customer_crm_sync_records` to preserve external links. These are connection references/mappings, not OAuth credentials. A working Nango service/environment is still needed for future explicitly requested synchronization.
- Exclude source provider passwords/credentials and audit payloads, personal integrations, assistant settings/actions, OAuth transactions, social tokens, API keys, financial authentication keys and Graph subscription client state. Source CRM integration configuration is not copied.
- Source and preview legacy `user_user` must be empty. A nonempty password-bearing legacy identity table requires a separate reviewed sanitization policy.
- Preserve independent custom domains (including Proyectos), all their CRM records and configuration, and `crm_data_domains`. Clear CRM tenants matching `agency:%`, which contain demo agency data. For `domain:platform`, retain object/schema/view metadata but clear demo projections, custom values, cached request results, audit entries and associated runtime rows. This prevents demo fields from attaching to unrelated real agencies with the same numeric IDs. The separate preview backup preserves the complete demo state.
- Refuse a replacement that would silently redirect retained preview memberships, credentials or other foreign-key-bound state to a different agency after an ID collision. Remapping such access requires a separate deliberate step.
- Merge source ID allocation sequence high-water marks into the preview. Business command allocators also compare against the current source table maximum.

Both inputs are opened read-only and captured through SQLite's backup API (including committed WAL contents) into consistent in-memory snapshots. A complete preview-before backup and the verified output are written with mode `0600`. Output, report and backup paths must be new and distinct from both inputs. No source-secret snapshot is written to disk.

## Build

From the repository root, choose a new output directory on every run:

```sh
python3 scripts/test_migrate_domain_preview.py
python3 scripts/migrate-domain-preview.py \
  --source '/tmp/savia-source/source.sqlite' \
  --preview '/tmp/savia-crm-preview/api-state/v3/d1/miniflare-D1DatabaseObject/2b35d4d42e3c9f6b5ad5b5579a7b1470c66e69f6b33a31e3f5a0095cc6d18656.sqlite' \
  --output '/tmp/savia-domain-migration-NEW/verified-preview.sqlite' \
  --backup '/tmp/savia-domain-migration-NEW/preview-before.sqlite' \
  --report '/tmp/savia-domain-migration-NEW/report.json'
```

Review the report before installation. It contains counts, hashes, table-level FK summaries and provider/status counts, with no customer values, connection identifiers or credentials. The script verifies all selected rows, preserves preview access, checks SQLite integrity and refuses new FK violations. It does not copy file/object-storage bytes; existing document references require their separately configured storage.

Installation is a separate operation owned by the preview service runner: stop the API, checkpoint/close its database, retain the backup, replace the database with the verified output, ensure obsolete live WAL/SHM files are not paired with the replacement, then restart. Keep the source untouched. Do not call synchronization as part of migration or smoke tests.

## Verified local build — 2026-09-08

Final output: `/tmp/savia-domain-migration-20260908-final/verified-preview.sqlite`.
Report and full previous-preview backup are in the same directory.

| Table                       | Rows retained |
| --------------------------- | ------------: |
| agencies                    |            90 |
| customer_client             |        48,745 |
| customer_clientagency       |        50,105 |
| customer_naturalperson      |        32,934 |
| customer_legalperson        |        17,330 |
| customer_address            |        36,982 |
| customer_legalpersoncontact |        13,688 |
| customer_crm_sync_records   |             3 |
| document_ownership          |        50,195 |

The verified output has one connected HubSpot reference, one inactive historical creator placeholder, no source identity grants, zero foreign-key violations (source and previous preview also had zero), and SQLite integrity `ok`. Independent custom domains and preview access remain intact. No provider execution occurred.

Installed into the isolated preview on2026-09-08, followed by migration0025. The original pre-switch preview backup is also retained at `/tmp/savia-domain-migration-20260908/preview-before-switch.sqlite`. Browser smoke checks verified both counts, search/pagination and source-backed editing. Custom demonstration values were saved through the designer/form workflow; temporary source-reference changes were restored. A read-only Nango connection query returned HTTP200 for agency10. No live HubSpot write was executed.
