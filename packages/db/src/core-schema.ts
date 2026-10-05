import { sql } from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
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

export const accessRevisions = sqliteTable("access_revisions", {
  scope: text("scope").primaryKey().notNull(),
  revision: integer("revision").notNull().default(0),
});
export const accessRoles = sqliteTable(
  "access_roles",
  {
    id: text("id").notNull(),
    scope: text("scope")
      .notNull()
      .references(() => accessRevisions.scope),
    name: text("name").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    protected: integer("protected", { mode: "boolean" })
      .notNull()
      .default(false),
    legacyRole: text("legacy_role"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.id] }),
    uniqueIndex("access_roles_scope_name").on(table.scope, table.name),
  ],
);
export const accessGrants = sqliteTable(
  "access_grants",
  {
    id: text("id").primaryKey().notNull(),
    scope: text("scope").notNull(),
    roleId: text("role_id").notNull(),
    resource: text("resource").notNull(),
    action: text("action").notNull(),
    predicate: text("predicate").notNull(),
    fields: text("fields").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.scope, table.roleId],
      foreignColumns: [accessRoles.scope, accessRoles.id],
    }).onDelete("cascade"),
  ],
);
export const accessAssignments = sqliteTable(
  "access_assignments",
  {
    scope: text("scope").notNull(),
    principalId: text("principal_id")
      .notNull()
      .references(() => identityPrincipals.id, { onDelete: "cascade" }),
    roleId: text("role_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.principalId, table.roleId] }),
    foreignKey({
      columns: [table.scope, table.roleId],
      foreignColumns: [accessRoles.scope, accessRoles.id],
    }).onDelete("cascade"),
  ],
);
export const accessAudit = sqliteTable("access_audit", {
  id: text("id").primaryKey().notNull(),
  scope: text("scope").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  targetId: text("target_id").notNull(),
  beforeState: text("before_state"),
  afterState: text("after_state"),
  createdAt: text("created_at").notNull(),
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

export const tenantSlugAliases = sqliteTable(
  "tenant_slug_aliases",
  {
    slug: text("slug").primaryKey().notNull(),
    tenantId: bigint("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (table) => [index("tenant_slug_aliases_tenant_id").on(table.tenantId)],
);

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

export const tenantCrmConnections = sqliteTable(
  "tenant_crm_connections",
  {
    id: text("id").primaryKey().notNull(),
    tenantId: bigint("tenant_id")
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
    uniqueIndex("tenant_crm_connections_nango_active_unique")
      .on(table.nangoIntegrationId, table.nangoConnectionId)
      .where(sql`${table.disconnectedAt} IS NULL`),
    uniqueIndex("tenant_crm_connections_organization_active_unique")
      .on(table.tenantId)
      .where(sql`${table.disconnectedAt} IS NULL`),
    index("tenant_crm_connections_owner_index").on(
      table.createdByPrincipalId,
      table.tenantId,
      table.provider,
    ),
    index("tenant_crm_connections_tenant_provider_index").on(
      table.tenantId,
      table.provider,
    ),
  ],
);

export const tenantWhatsappConnections = sqliteTable(
  "tenant_whatsapp_connections",
  {
    id: text("id").primaryKey().notNull(),
    tenantId: bigint("tenant_id")
      .notNull()
      .references(() => tenants.id),
    createdByPrincipalId: text("created_by_principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    nangoConnectionId: text("nango_connection_id").notNull(),
    nangoIntegrationId: text("nango_integration_id").notNull(),
    status: text("status").notNull(),
    phoneNumberId: text("phone_number_id"),
    displayPhoneNumber: text("display_phone_number"),
    wabaId: text("waba_id"),
    externalAccountLabel: text("external_account_label"),
    lastValidatedAt: text("last_validated_at"),
    disconnectedAt: text("disconnected_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("tenant_whatsapp_connections_tenant_active_unique")
      .on(table.tenantId)
      .where(sql`${table.disconnectedAt} IS NULL`),
    uniqueIndex("tenant_whatsapp_connections_nango_active_unique")
      .on(table.nangoIntegrationId, table.nangoConnectionId)
      .where(sql`${table.disconnectedAt} IS NULL`),
    index("tenant_whatsapp_connections_owner_index").on(
      table.createdByPrincipalId,
      table.tenantId,
    ),
  ],
);

export const jiraPrivacyAccounts = sqliteTable(
  "jira_privacy_accounts",
  {
    integrationId: text("integration_id").notNull(),
    accountId: text("account_id").notNull(),
    oldestDataAt: text("oldest_data_at").notNull(),
    version: integer("version").notNull().default(1),
    lastReportedAt: text("last_reported_at"),
    nextReportAt: text("next_report_at").notNull(),
    retryAt: text("retry_at"),
    leaseToken: text("lease_token"),
    leaseUntil: text("lease_until"),
    pendingErasure: text("pending_erasure"),
    blockedReason: text("blocked_reason"),
  },
  (table) => [
    primaryKey({ columns: [table.integrationId, table.accountId] }),
    index("jira_privacy_accounts_due_index").on(
      table.integrationId,
      table.nextReportAt,
      table.retryAt,
    ),
  ],
);

export const jiraPrivacyConnections = sqliteTable(
  "jira_privacy_connections",
  {
    generation: text("generation").primaryKey().notNull(),
    connectionId: text("connection_id"),
    principalId: text("principal_id"),
    integrationId: text("integration_id").notNull(),
    nangoConnectionId: text("nango_connection_id").notNull(),
    accountId: text("account_id"),
    retrievedAt: text("retrieved_at").notNull(),
    cleanupReason: text("cleanup_reason"),
    cleanupRetryAt: text("cleanup_retry_at"),
  },
  (table) => [
    index("jira_privacy_connections_account_index").on(
      table.integrationId,
      table.accountId,
    ),
    uniqueIndex("jira_privacy_connections_nango_unique").on(
      table.integrationId,
      table.nangoConnectionId,
    ),
  ],
);

export const jiraPrivacyIntegrations = sqliteTable(
  "jira_privacy_integrations",
  {
    integrationId: text("integration_id").primaryKey().notNull(),
    ownerAuthorizationRequired: integer("owner_authorization_required")
      .notNull()
      .default(0),
    revokedReportingConnectionId: text("revoked_reporting_connection_id"),
    cycleBlocked: integer("cycle_blocked").notNull().default(0),
    reporterRetryAt: text("reporter_retry_at"),
  },
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
    jiraPrivacyGeneration: text("jira_privacy_generation"),
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

export const zoomPersonalMeetings = sqliteTable(
  "zoom_personal_meetings",
  {
    principalId: text("principal_id")
      .notNull()
      .references(() => identityPrincipals.id, { onDelete: "cascade" }),
    resourceKey: text("resource_key").notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => personalIntegrationConnections.id),
    nangoConnectionId: text("nango_connection_id").notNull(),
    nangoIntegrationId: text("nango_integration_id").notNull(),
    immutableRequest: text("immutable_request"),
    meetingId: text("meeting_id"),
    joinUrl: text("join_url"),
    calendarConnectionId: text("calendar_connection_id"),
    calendarNangoConnectionId: text("calendar_nango_connection_id"),
    calendarNangoIntegrationId: text("calendar_nango_integration_id"),
    calendarProvider: text("calendar_provider"),
    calendarEventId: text("calendar_event_id"),
    state: text("state").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.principalId, table.resourceKey] }),
    index("zoom_personal_meetings_calendar_event_idx").on(
      table.principalId,
      table.calendarProvider,
      table.calendarEventId,
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

export const personalCollaborationMessages = sqliteTable(
  "personal_collaboration_messages",
  {
    id: text("id").primaryKey().notNull(),
    principalId: text("principal_id")
      .notNull()
      .references(() => identityPrincipals.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    provider: text("provider").notNull(),
    state: text("state").notNull(),
    messageId: text("message_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("personal_collaboration_messages_principal_request_unique").on(
      table.principalId,
      table.requestId,
    ),
    index("personal_collaboration_messages_principal_created").on(
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

export const userMyDayWidgets = sqliteTable("user_my_day_widgets", {
  principalId: text("principal_id")
    .primaryKey()
    .notNull()
    .references(() => identityPrincipals.id),
  layout: text("layout").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const studioSettings = sqliteTable("studio_settings", {
  tenantId: text("tenant_id").primaryKey().notNull(),
  menuLayout: text("menu_layout"),
  updatedAt: text("updated_at").notNull(),
});

export const studioExtensionInstallations = sqliteTable(
  "studio_extension_installations",
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

export const tenantCrmConnectionAuditEvents = sqliteTable(
  "tenant_crm_connection_audit_events",
  {
    id: text("id").primaryKey().notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => tenantCrmConnections.id),
    tenantId: bigint("tenant_id")
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
    index("tenant_crm_connection_audit_events_connection_created_at_index").on(
      table.connectionId,
      table.createdAt,
    ),
    index("tenant_crm_connection_audit_events_tenant_created_at_index").on(
      table.tenantId,
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
    allowedModels: text("allowed_models"),
    transcriptionModel: text("transcription_model"),
    transcriptionEndpoint: text("transcription_endpoint"),
    summaryModel: text("summary_model"),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").notNull(),
  },
  (table) => [
    uniqueIndex("assistant_openrouter_settings_agency_unique").on(
      table.agencyId,
    ),
  ],
);

export const assistantActiveTenants = sqliteTable(
  "assistant_active_tenants",
  {
    principalId: text("principal_id")
      .primaryKey()
      .notNull()
      .references(() => identityPrincipals.id, { onDelete: "cascade" }),
    tenantId: bigint("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("assistant_active_tenants_tenant_index").on(table.tenantId),
  ],
);

export const requestPageRuns = sqliteTable(
  "request_page_runs",
  {
    id: text("id").primaryKey().notNull(),
    principalId: text("principal_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    pageName: text("page_name").notNull(),
    actionId: text("action_id").notNull(),
    actionLabel: text("action_label").notNull(),
    mode: text("mode", { enum: ["mock", "live"] }).notNull(),
    status: text("status", {
      enum: ["running", "complete", "failed"],
    }).notNull(),
    formValues: text("form_values").notNull(),
    result: text("result"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("request_page_runs_owner_page").on(
      table.principalId,
      table.tenantId,
      table.pageName,
      table.createdAt,
    ),
  ],
);

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

export const tenantWhatsappAssistantBindings = sqliteTable(
  "tenant_whatsapp_assistant_bindings",
  {
    tenantId: bigint("tenant_id")
      .primaryKey()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => tenantWhatsappConnections.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => assistantVirtualEmployees.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    allowedContacts: text("allowed_contacts").notNull().default("[]"),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => identityPrincipals.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "tenant_whatsapp_assistant_bindings_enabled_check",
      sql`${table.enabled} IN (0, 1)`,
    ),
    check(
      "tenant_whatsapp_assistant_bindings_contacts_check",
      sql`json_valid(${table.allowedContacts}) AND json_type(${table.allowedContacts}) = 'array'`,
    ),
    uniqueIndex("tenant_whatsapp_assistant_bindings_connection_unique").on(
      table.connectionId,
    ),
  ],
);

export const whatsappInbox = sqliteTable(
  "whatsapp_inbox",
  {
    messageId: text("message_id").primaryKey().notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    wabaId: text("waba_id").notNull(),
    contactPhone: text("contact_phone").notNull(),
    normalizedContact: text("normalized_contact").notNull(),
    messageText: text("message_text").notNull(),
    providerTimestamp: text("provider_timestamp").notNull(),
    tenantId: bigint("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => tenantWhatsappConnections.id, { onDelete: "cascade" }),
    state: text("state").notNull().default("pending"),
    generationAttempts: integer("generation_attempts").notNull().default(0),
    retryAt: text("retry_at"),
    leaseToken: text("lease_token"),
    leaseUntil: text("lease_until"),
    replyText: text("reply_text"),
    sendStartedAt: text("send_started_at"),
    outboundMessageId: text("outbound_message_id"),
    deliveryStatus: text("delivery_status"),
    deliveryRank: integer("delivery_rank").notNull().default(0),
    deliveryErrorCodes: text("delivery_error_codes").notNull().default("[]"),
    failureCode: text("failure_code"),
    receivedAt: text("received_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    check(
      "whatsapp_inbox_state_check",
      sql`${table.state} IN ('pending', 'generating', 'responding', 'completed', 'failed')`,
    ),
    check(
      "whatsapp_inbox_attempts_check",
      sql`${table.generationAttempts} >= 0`,
    ),
    check(
      "whatsapp_inbox_delivery_rank_check",
      sql`${table.deliveryRank} >= 0`,
    ),
    check(
      "whatsapp_inbox_errors_check",
      sql`json_valid(${table.deliveryErrorCodes}) AND json_type(${table.deliveryErrorCodes}) = 'array'`,
    ),
    uniqueIndex("whatsapp_inbox_outbound_unique").on(table.outboundMessageId),
    index("whatsapp_inbox_pending_idx").on(
      table.state,
      table.retryAt,
      table.receivedAt,
    ),
    index("whatsapp_inbox_contact_history_idx").on(
      table.connectionId,
      table.normalizedContact,
      table.state,
      table.receivedAt,
    ),
    index("whatsapp_inbox_sender_idx").on(
      table.phoneNumberId,
      table.wabaId,
      table.receivedAt,
    ),
    uniqueIndex("whatsapp_inbox_active_contact_unique")
      .on(table.connectionId, table.normalizedContact)
      .where(sql`${table.state} IN ('generating', 'responding')`),
  ],
);

export const whatsappDeliveryReceipts = sqliteTable(
  "whatsapp_delivery_receipts",
  {
    phoneNumberId: text("phone_number_id").notNull(),
    wabaId: text("waba_id").notNull(),
    messageId: text("message_id").notNull(),
    status: text("status").notNull(),
    deliveryRank: integer("delivery_rank").notNull(),
    errorCode: text("error_code"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "whatsapp_delivery_receipts_status_check",
      sql`${table.status} IN ('sent', 'delivered', 'read', 'failed')`,
    ),
    check(
      "whatsapp_delivery_receipts_rank_check",
      sql`${table.deliveryRank} >= 0`,
    ),
    primaryKey({
      columns: [table.phoneNumberId, table.wabaId, table.messageId],
    }),
    index("whatsapp_delivery_receipts_message_idx").on(table.messageId),
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

export const emailRegistrationLedger = sqliteTable(
  "email_registration_ledger",
  {
    attemptId: text("attempt_id").primaryKey().notNull(),
    authSubject: text("auth_subject").notNull().unique(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    revision: text("revision").notNull(),
    principalId: text("principal_id")
      .notNull()
      .unique()
      .references(() => identityPrincipals.id, { onDelete: "cascade" }),
    membershipId: text("membership_id")
      .notNull()
      .unique()
      .references(() => identityTenantMemberships.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
);
export const emailRegistrationAudit = sqliteTable(
  "email_registration_audit",
  {
    id: text("id").primaryKey().notNull(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id").notNull(),
    event: text("event").notNull(),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("email_registration_audit_tenant_created_index").on(
      table.tenantId,
      table.createdAt,
    ),
  ],
);
export const emailRegistrationCancellation = sqliteTable(
  "email_registration_cancellation",
  {
    attemptId: text("attempt_id").primaryKey().notNull(),
    cancelled: integer("cancelled").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
);
export const registrationCaptchaConsumption = sqliteTable(
  "registration_captcha_consumption",
  {
    proofHash: text("proof_hash").primaryKey().notNull(),
    requestId: text("request_id").notNull().unique(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    status: text("status").notNull(),
    expiresAt: bigint("expires_at").notNull(),
  },
  (table) => [
    index("registration_captcha_consumption_expiry_index").on(table.expiresAt),
  ],
);

export const personalApiKeys = sqliteTable(
  "personal_api_keys",
  {
    id: text("id").primaryKey().notNull(),
    principalId: text("principal_id")
      .notNull()
      .references(() => identityPrincipals.id, { onDelete: "cascade" }),
    tenantId: bigint("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    deploymentId: text("deployment_id").notNull(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    secretDigest: text("secret_digest").notNull().unique(),
    scopes: text("scopes").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    lastUsedAt: text("last_used_at"),
  },
  (table) => [
    index("personal_api_keys_owner").on(table.principalId, table.expiresAt),
  ],
);

export const personalCalendarSources = sqliteTable(
  "personal_calendar_sources",
  {
    id: text("id").primaryKey().notNull(),
    principalId: text("principal_id")
      .notNull()
      .references(() => identityPrincipals.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["subscription", "import"] }).notNull(),
    name: text("name").notNull(),
    color: text("color", {
      enum: ["blue", "emerald", "violet", "amber", "rose", "slate"],
    }).notNull(),
    visible: integer("visible", { mode: "boolean" }).notNull().default(true),
    timeZone: text("time_zone").notNull(),
    hostname: text("hostname"),
    encryptedPayload: text("encrypted_payload").notNull(),
    encryptedValidators: text("encrypted_validators"),
    lastSyncedAt: text("last_synced_at"),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("personal_calendar_sources_principal_created").on(
      table.principalId,
      table.createdAt,
    ),
  ],
);

export const userCalendarPreferences = sqliteTable(
  "user_calendar_preferences",
  {
    principalId: text("principal_id")
      .primaryKey()
      .notNull()
      .references(() => identityPrincipals.id, { onDelete: "cascade" }),
    settings: text("settings").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);
