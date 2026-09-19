# Access-control enforcement inventory

Status: characterization; enforcement work in progress. Do not enable configurable role editing until every protected path is covered.

| Entry point | Current owner / guard | Required policy boundary |
| --- | --- | --- |
| Agency CRM and published aliases | routes/dynamic-crm.ts; manager or shared-collection check | Active tenant, collection/action, rows and fields |
| Independent/platform domains | routes/data-domains.ts; platform administrator | Domain authorization and collection policy |
| Native records/counts/search | crm-server/index.ts, services.ts, query.ts | Predicate before pagination; projection before serialization |
| Schema/bootstrap/menu metadata | crm-server/schema.ts, menu-layout.ts, index.ts | Configure separately from record reads |
| Bulk/import/export/restore | crm-server/operations.ts, index.ts | Explicit action plus each record and field |
| Relations/options/managed collections | crm/collection-*.ts | Source field and target record authorization |
| Files/downloads | crm-server/index.ts | Parent collection/record authorization before R2 access |
| Extensions/connections/settings | crm-server/extension-*.ts | Execute separately from configure; no secret projection |
| Integration/manual/automatic synchronization | crm/customer-sync.ts, auto-sync.ts; crm-server/integrations.ts | Current principal policy before side effects |
| Local manifest/pull/push/receipts | crm-server/local-sync.ts | Principal, scope, revision, projection and removals |
| Domain operational API | apps/api runtime domain registration | Same record and field decisions for command/document paths |
| Request pages/results | apps/api/src/request-pages and request-results | Current scoped execution permission |
| Assistant and MCP | assistant/service.ts, apps/mcp/src/index.ts | Protected service entrypoints; no raw-data bypass |
| Identity/tenant administration | routes/identity.ts, tenants.ts | Protected global identity; tenant assignment editing separate |
| Public forms | public-forms routes/service | Explicit public capability; never inherited administrator |
| Admin resource navigation | auth/react-admin-auth-provider.ts | Effective permission summary; server remains authoritative |

Legacy behavior: operators can modify operational customers but cannot access arbitrary native CRM collections. Do not replace these distinct boundaries with a global CRUD grant. Existing shared HubSpot collections permit member reads but not schema/bootstrap mutation; preserve existing hubspot-workspace tests alongside parity tests.

New parity evidence: access-control-parity.test.ts covers the five initial roles, cross-tenant rejection, independent domains and operational customer capabilities. Existing dynamic-crm.test.ts covers file/export isolation and persistence; hubspot-workspace.test.ts covers shared/private provider behavior. Remaining entrypoint evidence is added with enforcement.
