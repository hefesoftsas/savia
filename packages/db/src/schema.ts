import {
  customType,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const bigint = customType<{ data: number; driverData: number }>({
  dataType() {
    return "BIGINT";
  },
});

import { identityPrincipals, tenants } from "./core-schema";
export * from "./core-schema";

export const agencies = sqliteTable(
  "agencies",
  {
    id: bigint("id").primaryKey().notNull(),
    tenantId: bigint("tenant_id").references(() => tenants.id),
    idSlug: text("id_slug").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    idCheckDigit: text("id_check_digit").notNull(),
    idNumber: text("id_number").notNull(),
    phone: text("phone"),
    logo: text("logo"),
    cityId: integer("city_id"),
    coordinates: text("coordinates"),
    lrIdNumber: text("lr_id_number").notNull(),
    lrIdType: text("lr_id_type").notNull(),
    lrName: text("lr_name").notNull(),
    paymentsEmail: text("payments_email").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull(),
    email: text("email").notNull(),
    isInHouse: integer("is_in_house", { mode: "boolean" }).notNull(),
    emailDomain: text("email_domain").notNull(),
    birthdayFromEmail: text("birthday_from_email").notNull(),
    paymentFromEmail: text("payment_from_email").notNull(),
    renewalFromEmail: text("renewal_from_email").notNull(),
    homeUrl: text("home_url").notNull(),
    shortName: text("short_name").notNull(),
    sellerRequired: integer("seller_required", { mode: "boolean" }).notNull(),
    hasCompliance: integer("has_compliance", { mode: "boolean" }).notNull(),
    defaultCcEmails: text("default_cc_emails"),
    surnames: text("surnames").notNull(),
    type: text("type").notNull(),
    theme: text("theme").notNull(),
    retirementDate: text("retirement_date"),
  },
  (table) => [
    uniqueIndex("agencies_tenant_unique").on(table.tenantId),
    uniqueIndex("agencies_id_slug_unique").on(table.idSlug),
    uniqueIndex("agencies_short_name_unique").on(table.shortName),
  ],
);

export const agencyContacts = sqliteTable(
  "agency_contacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    idSlug: text("id_slug").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    name: text("name").notNull(),
    surname: text("surname").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    position: text("position").notNull(),
    agencyId: bigint("agency_id")
      .notNull()
      .references(() => agencies.id),
  },
  (table) => [
    uniqueIndex("agency_contacts_id_slug_unique").on(table.idSlug),
    index("agency_contacts_agency_id_index").on(table.agencyId),
  ],
);

export const countries = sqliteTable(
  "countries",
  {
    id: integer("id").primaryKey().notNull(),
    name: text("name").notNull(),
    code: text("code").notNull(),
  },
  (table) => [
    uniqueIndex("countries_name_unique").on(table.name),
    uniqueIndex("countries_code_unique").on(table.code),
  ],
);

export const departments = sqliteTable(
  "departments",
  {
    id: integer("id").primaryKey().notNull(),
    name: text("name").notNull(),
    countryId: integer("country_id")
      .notNull()
      .references(() => countries.id),
    externalId: integer("external_id").notNull(),
  },
  (table) => [
    index("departments_country_id_index").on(table.countryId),
    uniqueIndex("departments_external_id_unique").on(table.externalId),
  ],
);

export const cities = sqliteTable(
  "cities",
  {
    id: integer("id").primaryKey().notNull(),
    name: text("name").notNull(),
    departmentId: integer("department_id")
      .notNull()
      .references(() => departments.id),
    externalId: integer("external_id").notNull(),
  },
  (table) => [
    index("cities_department_id_index").on(table.departmentId),
    uniqueIndex("cities_external_id_unique").on(table.externalId),
  ],
);

export const agencyBranches = sqliteTable(
  "agency_branches",
  {
    id: bigint("id").primaryKey().notNull(),
    idSlug: text("id_slug").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    name: text("name").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull(),
    agencyId: bigint("agency_id")
      .notNull()
      .references(() => agencies.id),
    cityId: integer("city_id")
      .notNull()
      .references(() => cities.id),
  },
  (table) => [
    uniqueIndex("agency_branches_id_slug_unique").on(table.idSlug),
    index("agency_branches_agency_id_index").on(table.agencyId),
    index("agency_branches_city_id_index").on(table.cityId),
  ],
);

export const insurerCompanies = sqliteTable(
  "insurer_companies",
  {
    id: bigint("id").primaryKey().notNull(),
    idSlug: text("id_slug").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    name: text("name").notNull(),
    idNumber: text("id_number").notNull(),
    nameLong: text("name_long").notNull(),
    idCheckDigit: text("id_check_digit").notNull(),
    externalId: integer("external_id"),
    reconciliationType: text("reconciliation_type").notNull(),
    paymentUrl: text("payment_url").notNull(),
    venduCode: text("vendu_code").notNull(),
    collectionReconciliationType: text(
      "collection_reconciliation_type",
    ).notNull(),
    paymentInformation: text("payment_information").notNull(),
    assistanceLine: text("assistance_line").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("insurer_companies_id_slug_unique").on(table.idSlug),
    index("insurer_companies_reconciliation_type_index").on(
      table.reconciliationType,
    ),
    index("insurer_companies_collection_reconciliation_type_index").on(
      table.collectionReconciliationType,
    ),
  ],
);

export const attachmentUploads = sqliteTable(
  "attachment_uploads",
  {
    id: text("id").primaryKey().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    agencyId: bigint("agency_id")
      .notNull()
      .references(() => agencies.id),
    domain: text("domain").notNull(),
    collection: text("collection").notNull(),
    aggregateId: bigint("aggregate_id").notNull(),
    objectKey: text("object_key").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256"),
    status: text("status").notNull(),
    sourceTable: text("source_table"),
    sourceDocumentId: bigint("source_document_id"),
  },
  (table) => [
    uniqueIndex("attachment_uploads_object_key_unique").on(table.objectKey),
    index("attachment_uploads_target_index").on(
      table.domain,
      table.collection,
      table.aggregateId,
    ),
    index("attachment_uploads_agency_status_index").on(
      table.agencyId,
      table.status,
    ),
  ],
);

export const identityAgencyMemberships = sqliteTable(
  "identity_tenant_membership",
  {
    id: text("id").primaryKey().notNull(),
    principalId: text("principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    agencyId: bigint("tenant_id")
      .notNull()
      .references(() => tenants.id),
    role: text("role").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
);

export const agencyProviderCredentials = sqliteTable(
  "user_provider_credentials",
  {
    id: text("id").primaryKey().notNull(),
    ownerPrincipalId: text("owner_principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    provider: text("provider").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    credentialCiphertext: text("credential_ciphertext").notNull(),
    credentialIv: text("credential_iv").notNull(),
    lastValidationStatus: text("last_validation_status"),
    lastValidationErrorCode: text("last_validation_error_code"),
    lastValidatedAt: text("last_validated_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdByPrincipalId: text("created_by_principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    updatedByPrincipalId: text("updated_by_principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
  },
  (table) => [
    uniqueIndex("user_provider_credentials_user_provider_unique").on(
      table.ownerPrincipalId,
      table.provider,
    ),
    index("user_provider_credentials_owner_index").on(table.ownerPrincipalId),
  ],
);

export const agencyProviderCredentialAuditEvents = sqliteTable(
  "user_provider_credential_audit_events",
  {
    id: text("id").primaryKey().notNull(),
    ownerPrincipalId: text("owner_principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    provider: text("provider").notNull(),
    actorPrincipalId: text("actor_principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    eventType: text("event_type").notNull(),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("user_provider_credential_audit_events_owner_created_at_index").on(
      table.ownerPrincipalId,
      table.createdAt,
    ),
  ],
);

export const customerCrmSyncRecords = sqliteTable(
  "customer_crm_sync_records",
  {
    principalId: text("principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    agencyId: bigint("agency_id")
      .notNull()
      .references(() => agencies.id),
    customerProfileId: bigint("customer_profile_id").notNull(),
    provider: text("provider").notNull(),
    objectKind: text("object_kind").notNull(),
    externalObjectId: text("external_object_id").notNull(),
    lastSyncedAt: text("last_synced_at"),
    lastFailureCode: text("last_failure_code"),
    lastFailureAt: text("last_failure_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("customer_crm_sync_records_unique").on(
      table.principalId,
      table.agencyId,
      table.customerProfileId,
      table.provider,
      table.objectKind,
    ),
    index("customer_crm_sync_records_customer_provider_index").on(
      table.customerProfileId,
      table.provider,
    ),
  ],
);

export const autoLightQuoteRequests = sqliteTable(
  "auto_light_quote_requests",
  {
    id: text("id").primaryKey().notNull(),
    agencyId: bigint("agency_id")
      .notNull()
      .references(() => agencies.id),
    createdByPrincipalId: text("created_by_principal_id")
      .notNull()
      .references(() => identityPrincipals.id),
    plate: text("plate").notNull(),
    vehicleSource: text("vehicle_source").notNull(),
    vehicleSnapshot: text("vehicle_snapshot").notNull(),
    applicantSnapshot: text("applicant_snapshot").notNull(),
    coveragePreferences: text("coverage_preferences").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("auto_light_quote_requests_agency_created_at_index").on(
      table.agencyId,
      table.createdAt,
    ),
  ],
);

export const autoLightQuoteOffers = sqliteTable(
  "auto_light_quote_offers",
  {
    id: text("id").primaryKey().notNull(),
    quoteRequestId: text("quote_request_id")
      .notNull()
      .references(() => autoLightQuoteRequests.id),
    provider: text("provider").notNull(),
    operationId: text("operation_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    credentialOwnerPrincipalId: text(
      "credential_owner_principal_id",
    ).references(() => identityPrincipals.id),
    status: text("status").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    httpStatus: integer("http_status"),
    providerReference: text("provider_reference"),
    normalizedResult: text("normalized_result"),
    sanitizedResponse: text("sanitized_response"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("auto_light_quote_offers_request_operation_attempt_unique").on(
      table.quoteRequestId,
      table.operationId,
      table.attemptNumber,
    ),
    index("auto_light_quote_offers_request_created_at_index").on(
      table.quoteRequestId,
      table.createdAt,
    ),
  ],
);

export const categories = sqliteTable(
  "categories",
  {
    id: bigint("id").primaryKey().notNull(),
    idSlug: text("id_slug").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    name: text("name").notNull(),
    externalId: integer("external_id"),
  },
  (table) => [uniqueIndex("categories_id_slug_unique").on(table.idSlug)],
);

export const subRamos = sqliteTable(
  "sub_ramos",
  {
    id: bigint("id").primaryKey().notNull(),
    idSlug: text("id_slug").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    name: text("name").notNull(),
    categoryId: bigint("category_id")
      .notNull()
      .references(() => categories.id),
    externalIds: text("external_ids"),
  },
  (table) => [
    uniqueIndex("sub_ramos_id_slug_unique").on(table.idSlug),
    index("sub_ramos_category_id_index").on(table.categoryId),
  ],
);

export const ramos = sqliteTable(
  "ramos",
  {
    id: bigint("id").primaryKey().notNull(),
    idSlug: text("id_slug").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    name: text("name").notNull(),
    subRamoId: bigint("sub_ramo_id")
      .notNull()
      .references(() => subRamos.id),
    taxIva: text("tax_iva").notNull(),
    externalId: integer("external_id"),
    manageReinvestment: integer("manage_reinvestment", {
      mode: "boolean",
    }).notNull(),
    hasMonthlyPayment: integer("has_monthly_payment", {
      mode: "boolean",
    }).notNull(),
    allowCustomRenewalDays: integer("allow_custom_renewal_days", {
      mode: "boolean",
    }).notNull(),
    isNonRenewable: integer("is_non_renewable", {
      mode: "boolean",
    }).notNull(),
    insuranceSubjectValidation: text("insurance_subject_validation").notNull(),
    insuranceSubjectValidationMessage: text(
      "insurance_subject_validation_message",
    ).notNull(),
    monthlyPaymentFormLabel: text("monthly_payment_form_label").notNull(),
    compliancePolicyType: text("compliance_policy_type").notNull(),
  },
  (table) => [
    uniqueIndex("ramos_id_slug_unique").on(table.idSlug),
    index("ramos_sub_ramo_id_index").on(table.subRamoId),
  ],
);

export const extensionConnections = sqliteTable(
  "extension_connections",
  {
    tenantId: text("tenant_id").notNull(),
    extensionId: text("extension_id").notNull(),
    id: text("id").notNull(),
    connectorId: text("connector_id").notNull(),
    credentialCiphertext: text("credential_ciphertext").notNull(),
    credentialIv: text("credential_iv").notNull(),
    createdByPrincipalId: text("created_by_principal_id").notNull(),
    updatedByPrincipalId: text("updated_by_principal_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("extension_connections_tenant_extension_id_unique").on(
      table.tenantId,
      table.extensionId,
      table.id,
    ),
    index("extension_connections_tenant_updated_index").on(
      table.tenantId,
      table.updatedAt,
    ),
  ],
);

export const extensionConnectionAuditEvents = sqliteTable(
  "extension_connection_audit_events",
  {
    id: text("id").primaryKey().notNull(),
    tenantId: text("tenant_id").notNull(),
    extensionId: text("extension_id").notNull(),
    connectionId: text("connection_id").notNull(),
    actorPrincipalId: text("actor_principal_id").notNull(),
    eventType: text("event_type").notNull(),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("extension_connection_audit_events_tenant_created_index").on(
      table.tenantId,
      table.createdAt,
    ),
  ],
);

export const extensionActionRuns = sqliteTable(
  "extension_action_runs",
  {
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    extensionId: text("extension_id").notNull(),
    actionId: text("action_id").notNull(),
    connectionId: text("connection_id").notNull(),
    principalId: text("principal_id").notNull(),
    status: text("status").notNull(),
    input: text("input").notNull(),
    output: text("output"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("extension_action_runs_tenant_run_unique").on(
      table.tenantId,
      table.runId,
    ),
    index("extension_action_runs_tenant_updated_index").on(
      table.tenantId,
      table.updatedAt,
    ),
  ],
);
