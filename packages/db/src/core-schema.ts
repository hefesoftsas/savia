import {
  customType,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const bigint = customType<{ data: number; driverData: number }>({
  dataType() {
    return "BIGINT";
  },
});

export const serverIdSequences = sqliteTable("server_id_sequences", {
  resource: text("resource").primaryKey().notNull(),
  nextId: bigint("next_id").notNull(),
});

export const tenants = sqliteTable("tenants", {
  id: bigint("id").primaryKey().notNull(),
  idSlug: text("id_slug").notNull().unique(),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull(),
  kind: text("kind", { enum: ["commercial", "platform"] }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const identityPrincipals = sqliteTable(
  "identity_principal",
  {
    id: text("id").primaryKey().notNull(),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("identity_principal_issuer_subject_unique").on(
      table.issuer,
      table.subject,
    ),
  ],
);

export const identityGlobalRoles = sqliteTable(
  "identity_global_role",
  {
    principalId: text("principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("identity_global_role_principal_role_unique").on(
      table.principalId,
      table.role,
    ),
  ],
);

export const identityTenantMemberships = sqliteTable(
  "identity_tenant_membership",
  {
    id: text("id").primaryKey().notNull(),
    principalId: text("principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    tenantId: bigint("tenant_id")
      .notNull()
      .references(() => tenants.id),
    role: text("role").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("identity_tenant_membership_principal_unique").on(
      table.principalId,
    ),
  ],
);

export const agencyCrmConnections = sqliteTable(
  "agency_crm_connections",
  {
    id: text("id").primaryKey().notNull(),
    agencyId: bigint("agency_id")
      .notNull()
      .references(() => tenants.id),
    createdByPrincipalId: text("created_by_principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    provider: text("provider").notNull(),
    nangoConnectionId: text("nango_connection_id").notNull(),
    nangoIntegrationId: text("nango_integration_id").notNull(),
    status: text("status").notNull(),
    externalAccountLabel: text("external_account_label"),
    externalAccountId: text("external_account_id"),
    scopes: text("scopes").notNull(),
    lastValidatedAt: text("last_validated_at"),
    disconnectedAt: text("disconnected_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("agency_crm_connections_owner_index").on(
      table.createdByPrincipalId,
      table.agencyId,
      table.provider,
    ),
    index("agency_crm_connections_agency_provider_index").on(
      table.agencyId,
      table.provider,
    ),
  ],
);

export const personalIntegrationConnections = sqliteTable(
  "personal_integration_connections",
  {
    id: text("id").primaryKey().notNull(),
    principalId: text("principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    provider: text("provider").notNull(),
    nangoConnectionId: text("nango_connection_id").notNull(),
    nangoIntegrationId: text("nango_integration_id").notNull(),
    status: text("status").notNull(),
    externalAccountLabel: text("external_account_label"),
    externalAccountId: text("external_account_id"),
    scopes: text("scopes").notNull(),
    lastValidatedAt: text("last_validated_at"),
    disconnectedAt: text("disconnected_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("personal_integration_connections_principal_provider_index").on(
      table.principalId,
      table.provider,
    ),
  ],
);

export const personalIntegrationAuditEvents = sqliteTable(
  "personal_integration_audit_events",
  {
    id: text("id").primaryKey().notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => personalIntegrationConnections.id),
    principalId: text("principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("personal_integration_audit_events_connection_created_at_index").on(
      table.connectionId,
      table.createdAt,
    ),
    index("personal_integration_audit_events_principal_created_at_index").on(
      table.principalId,
      table.createdAt,
    ),
  ],
);

export const userNavigationPreferences = sqliteTable(
  "user_navigation_preferences",
  {
    principalId: text("principal_id")
      .primaryKey()
      .notNull()
      .references(() => identityPrincipals.id),
    layout: text("layout").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const userAppearancePreferences = sqliteTable(
  "user_appearance_preferences",
  {
    principalId: text("principal_id")
      .primaryKey()
      .notNull()
      .references(() => identityPrincipals.id),
    settings: text("settings").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const crmStudioSettings = sqliteTable("crm_studio_settings", {
  tenantId: text("tenant_id").primaryKey().notNull(),
  menuLayout: text("menu_layout"),
  updatedAt: text("updated_at").notNull(),
});

export const crmExtensionInstallations = sqliteTable(
  "crm_extension_installations",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    version: text("version").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    manifest: text("manifest").notNull(),
    installedAt: text("installed_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

export const agencyCrmConnectionAuditEvents = sqliteTable(
  "agency_crm_connection_audit_events",
  {
    id: text("id").primaryKey().notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => agencyCrmConnections.id),
    agencyId: bigint("agency_id")
      .notNull()
      .references(() => tenants.id),
    principalId: text("principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("agency_crm_connection_audit_events_connection_created_at_index").on(
      table.connectionId,
      table.createdAt,
    ),
    index("agency_crm_connection_audit_events_agency_created_at_index").on(
      table.agencyId,
      table.createdAt,
    ),
  ],
);

export const assistantOpenRouterSettings = sqliteTable(
  "assistant_openrouter_settings",
  {
    id: text("id").primaryKey().notNull(),
    scope: text("scope").notNull(),
    agencyId: bigint("agency_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    apiKeyCiphertext: text("api_key_ciphertext"),
    apiKeyIv: text("api_key_iv"),
    model: text("model"),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").notNull(),
  },
  (table) => [
    uniqueIndex("assistant_openrouter_settings_agency_unique").on(
      table.agencyId,
    ),
  ],
);

export const assistantActiveAgencies = sqliteTable(
  "assistant_active_agencies",
  {
    principalId: text("principal_id")
      .primaryKey()
      .notNull()
      .references(() => identityPrincipals.id, { onDelete: "cascade" }),
    agencyId: bigint("agency_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("assistant_active_agencies_agency_index").on(table.agencyId),
  ],
);

export const requestPageRuns = sqliteTable('request_page_runs', {
  id: text('id').primaryKey().notNull(),
  principalId: text('principal_id').notNull(),
  domainId: text('domain_id').notNull(),
  pageName: text('page_name').notNull(),
  actionId: text('action_id').notNull(),
  actionLabel: text('action_label').notNull(),
  mode: text('mode', {enum:['mock','live']}).notNull(),
  status: text('status', {enum:['running','complete','failed']}).notNull(),
  formValues: text('form_values').notNull(),
  result: text('result'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('request_page_runs_owner_page').on(table.principalId,table.domainId,table.pageName,table.createdAt)]);

export const assistantVirtualEmployees = sqliteTable(
  "assistant_virtual_employees",
  {
    id: text("id").primaryKey().notNull(),
    agencyId: bigint("agency_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    handle: text("handle").notNull(),
    position: text("position"),
    avatar: text("avatar"),
    greeting: text("greeting"),
    systemPrompt: text("system_prompt").notNull(),
    allowedCollections: text("allowed_collections").notNull().default('["*"]'),
    model: text("model"),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by"),
  },
  (table) => [
    uniqueIndex("assistant_virtual_employees_agency_handle").on(
      table.agencyId,
      table.handle,
    ),
    index("assistant_virtual_employees_agency_index").on(table.agencyId),
  ],
);

export const assistantVirtualEmployeeFiles = sqliteTable(
  "assistant_virtual_employee_files",
  {
    id: text("id").primaryKey().notNull(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => assistantVirtualEmployees.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    r2Key: text("r2_key").notNull(),
    ragStatus: text("rag_status", { enum: ["pending", "indexed", "failed"] })
      .notNull()
      .default("indexed"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("assistant_virtual_employee_files_employee_index").on(
      table.employeeId,
    ),
  ],
);

export const assistantVirtualEmployeeChunks = sqliteTable(
  "assistant_virtual_employee_chunks",
  {
    id: text("id").primaryKey().notNull(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => assistantVirtualEmployees.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => assistantVirtualEmployeeFiles.id, {
        onDelete: "cascade",
      }),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    vectorId: text("vector_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("assistant_virtual_employee_chunks_lookup").on(
      table.employeeId,
      table.fileId,
    ),
  ],
);
