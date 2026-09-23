import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

type TableInfo = { name: string; type: string };
type ForeignKey = { table: string; from: string; to: string };
type IndexInfo = { name: string; unique: number };

function migrationStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

async function applyMigrations() {
  for (const migration of migrationSqls) {
    for (const statement of migrationStatements(migration)) {
      await env.DB.exec(statement);
    }
  }
}

describe("full D1 schema projection", () => {
  beforeAll(applyMigrations);

  it("projects every application table and omits PostGIS", async () => {
    const tables = await env.DB.prepare(
      "SELECT name, sql AS type FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    ).all<TableInfo>();
    const names = tables.results.map((table) => table.name);

    expect(names).toHaveLength(333);
    expect(names).toEqual(
      expect.arrayContaining([
        "access_revisions",
        "access_roles",
        "access_grants",
        "access_assignments",
        "access_audit",
        "crm_access_deliveries",
        "crm_file_revisions",
        "workflows",
        "workflow_versions",
        "workflow_events",
        "workflow_executions",
        "workflow_jobs",
        "workflow_tasks",
        "workflow_write_context",
        "workflow_webhook_endpoints",
        "workflow_webhook_receipts",
        "workflow_webhook_admissions",
        "workflow_webhook_destinations",
        "workflow_webhook_destination_versions",
        "workflow_webhook_deliveries",
        "workflow_webhook_attempts",

        "assistant_virtual_employees",
        "assistant_virtual_employee_files",
        "assistant_virtual_employee_chunks",
        "request_page_runs",
        "public_forms",
        "public_form_short_links",
        "tenant_branding",
        "tenant_branding_assets",
        "public_form_submissions",
        "crm_objects",
        "crm_collection_versions",
        "crm_sync_changes",
        "crm_sync_receipts",
        "crm_record_history",
        "crm_record_history_context",
        "offline_collection_policies",
        "crm_solution_installations",
        "crm_extension_installations",
        "extension_connections",
        "extension_connection_audit_events",
        "extension_action_runs",
        "extension_settings",
        "crm_solution_objects",
        "crm_business_links",
        "crm_data_domains",
        "managed_customer_extensions",
        "managed_customer_requests",
        "crm_collection_sources",
        "crm_collection_bindings",
        "crm_collection_requests",
        "crm_collection_relations",
        "crm_record_links",
        "crm_native_relation_overrides",
        "crm_records",
        "crm_views",
        "crm_integrations",
        "crm_audit",
        "crm_unique_values",
        "crm_write_guards",
        "crm_requests",
        "crm_schema_versions",
        "crm_schema_data",
        "crm_studio_settings",
        "crm_integration_runs",
        "crm_notes",
        "crm_files",
        "crm_file_revisions",
        "crm_access_deliveries",
        "workflows",
        "workflow_versions",
        "workflow_events",
        "workflow_executions",
        "workflow_jobs",
        "workflow_tasks",
        "workflow_write_context",
        "workflow_webhook_endpoints",
        "workflow_webhook_receipts",
        "workflow_webhook_admissions",
        "workflow_webhook_destinations",
        "workflow_webhook_destination_versions",
        "workflow_webhook_deliveries",
        "workflow_webhook_attempts",

        "access_revisions",
        "access_roles",
        "access_grants",
        "access_assignments",
        "access_audit",
        "crm_file_drafts",
        "crm_automations",
        "crm_automation_runs",
        "crm_tasks",
        "flows",
        "flow_versions",
        "flow_variables",
        "flow_runs",
        "folders",
        "agencies",
        "server_id_sequences",
        "admin_oauth_transactions",
        "legacy_import_snapshots",
        "legacy_import_streams",
        "insurer_companies",
        "customer_address",
        "insurance_policy",
        "operation_payment",
        "attachment_uploads",
        "identity_principal",
        "identity_global_role",
        "identity_tenant_membership",
        "tenants",
        "tenant_consolidation_sources",
        "tenant_consolidation_discards",
        "tenant_consolidation_agency_bootstraps",
        "document_ownership",
        "assistant_pending_actions",
        "tenant_crm_connections",
        "tenant_crm_connection_audit_events",
        "personal_integration_connections",
        "personal_integration_audit_events",
        "user_navigation_preferences",
        "user_appearance_preferences",
        "user_my_day_widgets",
        "user_provider_credentials",
        "user_provider_credential_audit_events",
        "customer_crm_sync_records",
        "assistant_openrouter_settings",
        "assistant_active_tenants",
        "auto_light_quote_requests",
        "auto_light_quote_offers",
        "notification_events",
        "notification_deliveries",
        "notification_recipient_retries",
        "notification_subscriptions",
        "notification_admin_audit",
        "notification_send_limits",
        "notification_scope_settings",
        "notification_maintenance_checkpoints",
        "user_user",
      ]),
    );

    const views = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name",
    ).all<{ name: string }>();
    const viewNames = views.results.map((view) => view.name);
    expect(viewNames).toEqual(
      expect.arrayContaining([
        "agency_crm_connections",
        "agency_crm_connection_audit_events",
        "assistant_active_agencies",
      ]),
    );

    const crmConnectionColumns = await env.DB.prepare(
      "PRAGMA table_info(tenant_crm_connections)",
    ).all<{ name: string }>();
    expect(crmConnectionColumns.results.map((column) => column.name)).toContain(
      "external_account_id",
    );
    expect(crmConnectionColumns.results.map((column) => column.name)).toContain(
      "tenant_id",
    );
    const legacyCrmConnectionColumns = await env.DB.prepare(
      "PRAGMA table_info(agency_crm_connections)",
    ).all<{ name: string }>();
    expect(
      legacyCrmConnectionColumns.results.map((column) => column.name),
    ).toContain("agency_id");
    const personalConnectionIndexes = await env.DB.prepare(
      "PRAGMA index_list(personal_integration_connections)",
    ).all<IndexInfo>();
    expect(personalConnectionIndexes.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "personal_integration_connections_active_unique",
          unique: 1,
        }),
      ]),
    );
    expect(names).not.toContain("spatial_ref_sys");
    expect(names).not.toContain("geography_columns");

    const tenantColumns = await env.DB.prepare(
      "PRAGMA table_info(tenants)",
    ).all<TableInfo>();
    expect(tenantColumns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "kind", type: "TEXT" }),
      ]),
    );
  });

  it("keeps portable types and relational constraints in the internal schema", async () => {
    const [addressColumns, paymentColumns, paymentForeignKeys] =
      await Promise.all([
        env.DB.prepare("PRAGMA table_info(customer_address)").all<TableInfo>(),
        env.DB.prepare("PRAGMA table_info(operation_payment)").all<TableInfo>(),
        env.DB.prepare(
          "PRAGMA foreign_key_list(operation_payment)",
        ).all<ForeignKey>(),
      ]);

    expect(addressColumns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "coordinates", type: "TEXT" }),
      ]),
    );
    expect(paymentColumns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", type: "INTEGER" }),
      ]),
    );
    expect(paymentForeignKeys.results.length).toBeGreaterThan(0);
  });

  it("projects the private attachment metadata relation", async () => {
    const [columns, foreignKeys] = await Promise.all([
      env.DB.prepare("PRAGMA table_info(attachment_uploads)").all<TableInfo>(),
      env.DB.prepare(
        "PRAGMA foreign_key_list(attachment_uploads)",
      ).all<ForeignKey>(),
    ]);

    expect(columns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "object_key", type: "TEXT" }),
        expect.objectContaining({ name: "status", type: "TEXT" }),
      ]),
    );
    expect(foreignKeys.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "agency_id", table: "agencies" }),
      ]),
    );
  });

  it("projects the one-agency document ownership registry", async () => {
    const [columns, foreignKeys] = await Promise.all([
      env.DB.prepare("PRAGMA table_info(document_ownership)").all<TableInfo>(),
      env.DB.prepare(
        "PRAGMA foreign_key_list(document_ownership)",
      ).all<ForeignKey>(),
    ]);

    expect(columns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "domain", type: "TEXT" }),
        expect.objectContaining({ name: "collection", type: "TEXT" }),
        expect.objectContaining({ name: "document_id", type: "TEXT" }),
        expect.objectContaining({ name: "agency_id", type: "BIGINT" }),
      ]),
    );
    expect(foreignKeys.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "agency_id", table: "agencies" }),
      ]),
    );
  });

  it("records immutable proof for every legacy import stream", async () => {
    const [snapshots, streams, foreignKeys] = await Promise.all([
      env.DB.prepare(
        "PRAGMA table_info(legacy_import_snapshots)",
      ).all<TableInfo>(),
      env.DB.prepare(
        "PRAGMA table_info(legacy_import_streams)",
      ).all<TableInfo>(),
      env.DB.prepare(
        "PRAGMA foreign_key_list(legacy_import_streams)",
      ).all<ForeignKey>(),
    ]);

    expect(snapshots.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "manifest_sha256", type: "TEXT" }),
        expect.objectContaining({ name: "stream_count", type: "INTEGER" }),
      ]),
    );
    expect(streams.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "snapshot_id", type: "TEXT" }),
        expect.objectContaining({ name: "sha256", type: "TEXT" }),
      ]),
    );
    expect(foreignKeys.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "snapshot_id",
          table: "legacy_import_snapshots",
          to: "id",
        }),
      ]),
    );
  });

  it("stores encrypted provider bundles with agency-scoped audit evidence", async () => {
    const [
      credentialColumns,
      credentialForeignKeys,
      credentialIndexes,
      auditColumns,
      auditForeignKeys,
    ] = await Promise.all([
      env.DB.prepare("PRAGMA table_info(user_provider_credentials)").all<{
        name: string;
        type: string;
      }>(),
      env.DB.prepare(
        "PRAGMA foreign_key_list(user_provider_credentials)",
      ).all<ForeignKey>(),
      env.DB.prepare(
        "PRAGMA index_list(user_provider_credentials)",
      ).all<IndexInfo>(),
      env.DB.prepare(
        "PRAGMA table_info(user_provider_credential_audit_events)",
      ).all<{ name: string; type: string }>(),
      env.DB.prepare(
        "PRAGMA foreign_key_list(user_provider_credential_audit_events)",
      ).all<ForeignKey>(),
    ]);

    expect(credentialColumns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "credential_ciphertext",
          type: "TEXT",
        }),
        expect.objectContaining({ name: "credential_iv", type: "TEXT" }),
        expect.objectContaining({ name: "schema_version", type: "INTEGER" }),
        expect.objectContaining({
          name: "last_validation_status",
          type: "TEXT",
        }),
        expect.objectContaining({
          name: "last_validation_error_code",
          type: "TEXT",
        }),
      ]),
    );
    expect(credentialIndexes.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "user_provider_credentials_owner_provider_unique",
          unique: 1,
        }),
      ]),
    );
    expect(credentialForeignKeys.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "owner_principal_id",
          table: "identity_principal",
        }),
        expect.objectContaining({
          from: "created_by_principal_id",
          table: "identity_principal",
        }),
        expect.objectContaining({
          from: "updated_by_principal_id",
          table: "identity_principal",
        }),
      ]),
    );
    expect(auditColumns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "event_type", type: "TEXT" }),
        expect.objectContaining({ name: "outcome", type: "TEXT" }),
        expect.objectContaining({ name: "error_code", type: "TEXT" }),
      ]),
    );
    expect(auditForeignKeys.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "owner_principal_id",
          table: "identity_principal",
        }),
        expect.objectContaining({
          from: "actor_principal_id",
          table: "identity_principal",
        }),
      ]),
    );
  });
});
