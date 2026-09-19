// Generated from the restored legacy PostgreSQL schema. Do not edit by hand.
// @internal Raw relational tables for domain repositories; never expose through OpenAPI.
import { customType, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const bigint = customType<{ data: number; driverData: number }>({
  dataType: () => "BIGINT",
});

const table_account_emailaddress = sqliteTable(
  "account_emailaddress",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "email": text("email").notNull(),
    "verified": integer("verified", { mode: "boolean" }).notNull(),
    "primary": integer("primary", { mode: "boolean" }).notNull(),
    "user_id": integer("user_id").notNull(),
  },
);

const table_account_emailconfirmation = sqliteTable(
  "account_emailconfirmation",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "created": text("created").notNull(),
    "sent": text("sent"),
    "key": text("key").notNull(),
    "email_address_id": integer("email_address_id").notNull(),
  },
);

const table_api_customerfile = sqliteTable(
  "api_customerfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "report": text("report").notNull(),
    "response_duration": text("response_duration"),
  },
);

const table_api_key = sqliteTable(
  "api_key",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "name": text("name").notNull(),
    "public_key": text("public_key").notNull(),
    "private_key": text("private_key").notNull(),
    "created_at": text("created_at").notNull(),
  },
);

const table_api_paymentfile = sqliteTable(
  "api_paymentfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "insurance_company": text("insurance_company").notNull(),
    "extension": text("extension").notNull(),
    "csv_data": text("csv_data"),
    "report": text("report").notNull(),
  },
);

const table_api_policyfile = sqliteTable(
  "api_policyfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "report": text("report").notNull(),
    "response_duration": text("response_duration"),
  },
);

const table_api_propertiesfile = sqliteTable(
  "api_propertiesfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "report": text("report").notNull(),
    "response_duration": text("response_duration"),
  },
);

const table_api_proposalscarsfile = sqliteTable(
  "api_proposalscarsfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "report": text("report").notNull(),
    "response_duration": text("response_duration"),
  },
);

const table_api_sarlaftfile = sqliteTable(
  "api_sarlaftfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "report": text("report").notNull(),
    "response_duration": text("response_duration"),
  },
);

const table_app_bank = sqliteTable(
  "app_bank",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "name": text("name").notNull(),
  },
);

const table_app_changelog = sqliteTable(
  "app_changelog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "main_object_id": text("main_object_id").notNull(),
    "object_type": text("object_type").notNull(),
    "section": text("section").notNull(),
    "created_at": text("created_at").notNull(),
    "created_by": text("created_by").notNull(),
    "detail": text("detail").notNull(),
    "type": text("type").notNull(),
  },
);

const table_app_documenttag = sqliteTable(
  "app_documenttag",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "name": text("name").notNull(),
    "color": text("color").notNull(),
    "agency_id": bigint("agency_id"),
    "created_by": text("created_by").notNull(),
  },
);

const table_app_economicactivity = sqliteTable(
  "app_economicactivity",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "code": text("code").notNull(),
    "name": text("name").notNull(),
  },
);

const table_app_importdata = sqliteTable(
  "app_importdata",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "report": text("report").notNull(),
  },
);

const table_app_reporthistory = sqliteTable(
  "app_reporthistory",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "report_type": text("report_type").notNull(),
    "selected_columns": text("selected_columns").notNull(),
    "updated_at": text("updated_at").notNull(),
    "user_id": integer("user_id"),
  },
);

const table_auth_group = sqliteTable(
  "auth_group",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "name": text("name").notNull(),
  },
);

const table_auth_group_permissions = sqliteTable(
  "auth_group_permissions",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "group_id": integer("group_id").notNull(),
    "permission_id": integer("permission_id").notNull(),
  },
);

const table_auth_permission = sqliteTable(
  "auth_permission",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "name": text("name").notNull(),
    "content_type_id": integer("content_type_id").notNull(),
    "codename": text("codename").notNull(),
  },
);

const table_axes_accessattempt = sqliteTable(
  "axes_accessattempt",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "user_agent": text("user_agent").notNull(),
    "ip_address": text("ip_address"),
    "username": text("username"),
    "http_accept": text("http_accept").notNull(),
    "path_info": text("path_info").notNull(),
    "attempt_time": text("attempt_time").notNull(),
    "get_data": text("get_data").notNull(),
    "post_data": text("post_data").notNull(),
    "failures_since_start": integer("failures_since_start").notNull(),
  },
);

const table_axes_accessattemptexpiration = sqliteTable(
  "axes_accessattemptexpiration",
  {
    "access_attempt_id": integer("access_attempt_id").primaryKey().notNull(),
    "expires_at": text("expires_at").notNull(),
  },
);

const table_axes_accessfailurelog = sqliteTable(
  "axes_accessfailurelog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "user_agent": text("user_agent").notNull(),
    "ip_address": text("ip_address"),
    "username": text("username"),
    "http_accept": text("http_accept").notNull(),
    "path_info": text("path_info").notNull(),
    "attempt_time": text("attempt_time").notNull(),
    "locked_out": integer("locked_out", { mode: "boolean" }).notNull(),
  },
);

const table_axes_accesslog = sqliteTable(
  "axes_accesslog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "user_agent": text("user_agent").notNull(),
    "ip_address": text("ip_address"),
    "username": text("username"),
    "http_accept": text("http_accept").notNull(),
    "path_info": text("path_info").notNull(),
    "attempt_time": text("attempt_time").notNull(),
    "logout_time": text("logout_time"),
    "session_hash": text("session_hash").notNull(),
  },
);

const table_business_agency_renewal_task_managers = sqliteTable(
  "business_agency_renewal_task_managers",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "user_id": integer("user_id").notNull(),
  },
);

const table_business_agencycomplementarydata = sqliteTable(
  "business_agencycomplementarydata",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "employee_count": integer("employee_count"),
    "agent_type": text("agent_type").notNull(),
    "portfolio": integer("portfolio").notNull(),
    "focus": text("focus").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "commercial_executive_id": integer("commercial_executive_id").notNull(),
  },
);

const table_business_agencycompliancemailbox = sqliteTable(
  "business_agencycompliancemailbox",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "email": text("email").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "last_sync_at": text("last_sync_at"),
  },
);

const table_business_agencycompliancemailbox_reply_authorized_users = sqliteTable(
  "business_agencycompliancemailbox_reply_authorized_users",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "agencycompliancemailbox_id": bigint("agencycompliancemailbox_id").notNull(),
    "user_id": integer("user_id").notNull(),
  },
);

const table_business_allianzconnectionkey = sqliteTable(
  "business_allianzconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "connection_tag": text("connection_tag").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_axaconnectionkey = sqliteTable(
  "business_axaconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "vehicles_tag": text("vehicles_tag").notNull(),
    "motorcycle_tag": text("motorcycle_tag").notNull(),
    "heavy_vehicles_tag": text("heavy_vehicles_tag").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_bolivarconnectionkey = sqliteTable(
  "business_bolivarconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "connection_tag": text("connection_tag").notNull(),
    "vehicles_tag": text("vehicles_tag").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_chubbconnectionkey = sqliteTable(
  "business_chubbconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "connection_tag": text("connection_tag").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_commercialunit = sqliteTable(
  "business_commercialunit",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "created_by": text("created_by").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "edited_by": text("edited_by").notNull(),
  },
);

const table_business_defaultcommission = sqliteTable(
  "business_defaultcommission",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "commission_percentage": text("commission_percentage").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "insurer_id": bigint("insurer_id").notNull(),
    "ramo_id": bigint("ramo_id").notNull(),
    "migration_slug": text("migration_slug").notNull(),
    "external_id": text("external_id").notNull(),
  },
);

const table_business_equidadconnectionkey = sqliteTable(
  "business_equidadconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "connection_tag": text("connection_tag").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_hdiconnectionkey = sqliteTable(
  "business_hdiconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_mapfreconnectionkey = sqliteTable(
  "business_mapfreconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "connection_tag": text("connection_tag").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_previsoraconnectionkey = sqliteTable(
  "business_previsoraconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "connection_tag": text("connection_tag").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_qualitasconnectionkey = sqliteTable(
  "business_qualitasconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_ramorenewalconfiguration = sqliteTable(
  "business_ramorenewalconfiguration",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "renewal_days": integer("renewal_days").notNull(),
    "ramo_id": bigint("ramo_id").notNull(),
    "configuration_id": bigint("configuration_id").notNull(),
  },
);

const table_business_renewalconfiguration = sqliteTable(
  "business_renewalconfiguration",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "renewal_days": integer("renewal_days").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_sbsconnectionkey = sqliteTable(
  "business_sbsconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "connection_tag": text("connection_tag").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_seller = sqliteTable(
  "business_seller",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "id_number": text("id_number").notNull(),
    "contact_number": text("contact_number").notNull(),
    "contact_email": text("contact_email").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "bank_account_number": text("bank_account_number").notNull(),
    "bank_account_type": text("bank_account_type").notNull(),
    "bank_name": text("bank_name").notNull(),
    "id_type": text("id_type").notNull(),
    "tax_iva": text("tax_iva").notNull(),
    "tax_rete_ica": text("tax_rete_ica").notNull(),
    "tax_rete_iva": text("tax_rete_iva").notNull(),
    "type": text("type").notNull(),
    "tax_regime": text("tax_regime").notNull(),
    "completed_at": text("completed_at"),
    "tax_rete_fuente": text("tax_rete_fuente").notNull(),
    "migration_slug": text("migration_slug").notNull(),
    "external_id": text("external_id").notNull(),
  },
);

const table_business_sellercommission = sqliteTable(
  "business_sellercommission",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "index": integer("index").notNull(),
    "percentage": text("percentage").notNull(),
    "seller_id": bigint("seller_id").notNull(),
  },
);

const table_business_sellerdocument = sqliteTable(
  "business_sellerdocument",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "file": text("file").notNull(),
    "completed_at": text("completed_at"),
    "seller_id": bigint("seller_id").notNull(),
    "uploaded_by_id": integer("uploaded_by_id"),
  },
);

const table_business_sellerdocument_tags = sqliteTable(
  "business_sellerdocument_tags",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "sellerdocument_id": bigint("sellerdocument_id").notNull(),
    "documenttag_id": integer("documenttag_id").notNull(),
  },
);

const table_business_sellerlog = sqliteTable(
  "business_sellerlog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "created_at": text("created_at").notNull(),
    "info": text("info").notNull(),
    "created_by_id": integer("created_by_id"),
    "seller_id": bigint("seller_id").notNull(),
  },
);

const table_business_solidariaconnectionkey = sqliteTable(
  "business_solidariaconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_suraconnectionkey = sqliteTable(
  "business_suraconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "connection_tag": text("connection_tag").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_business_zurichconnectionkey = sqliteTable(
  "business_zurichconnectionkey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "key": text("key").notNull(),
    "username": text("username").notNull(),
    "password": text("password").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_billable": integer("is_billable", { mode: "boolean" }).notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_claim_claim = sqliteTable(
  "claim_claim",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "insurer_number": text("insurer_number").notNull(),
    "incident_at": text("incident_at").notNull(),
    "notified_at": text("notified_at"),
    "adjuster": text("adjuster").notNull(),
    "description": text("description").notNull(),
    "claimed_amount": text("claimed_amount"),
    "deductible": text("deductible").notNull(),
    "paid_amount": text("paid_amount"),
    "completed_at": text("completed_at"),
    "policy_id": bigint("policy_id").notNull(),
    "status_id": bigint("status_id").notNull(),
    "type_id": bigint("type_id").notNull(),
    "closed_at": text("closed_at"),
    "migration_slug": text("migration_slug").notNull(),
    "created_by": text("created_by").notNull(),
    "created_by_slug": text("created_by_slug").notNull(),
    "external_id": text("external_id").notNull(),
    "document_url": text("document_url").notNull(),
  },
);

const table_claim_claimdocument = sqliteTable(
  "claim_claimdocument",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "file": text("file").notNull(),
    "completed_at": text("completed_at"),
    "claim_id": bigint("claim_id").notNull(),
    "uploaded_by_id": integer("uploaded_by_id"),
  },
);

const table_claim_claimdocument_tags = sqliteTable(
  "claim_claimdocument_tags",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "claimdocument_id": bigint("claimdocument_id").notNull(),
    "documenttag_id": integer("documenttag_id").notNull(),
  },
);

const table_claim_claimlog = sqliteTable(
  "claim_claimlog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "created_at": text("created_at").notNull(),
    "info": text("info").notNull(),
    "claim_id": bigint("claim_id").notNull(),
    "created_by_id": integer("created_by_id"),
  },
);

const table_claim_claimstatus = sqliteTable(
  "claim_claimstatus",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "index": integer("index").notNull(),
    "color": text("color").notNull(),
    "is_closed": integer("is_closed", { mode: "boolean" }).notNull(),
  },
);

const table_claim_claimsubstatus = sqliteTable(
  "claim_claimsubstatus",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "index": integer("index").notNull(),
    "show_dropdown": integer("show_dropdown", { mode: "boolean" }).notNull(),
    "status_id": bigint("status_id").notNull(),
  },
);

const table_claim_claimtype = sqliteTable(
  "claim_claimtype",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "show_dropdown": integer("show_dropdown", { mode: "boolean" }).notNull(),
  },
);

const table_claim_coverage = sqliteTable(
  "claim_coverage",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "claimant": text("claimant").notNull(),
    "amount": text("amount").notNull(),
    "claim_id": bigint("claim_id").notNull(),
    "migration_slug": text("migration_slug").notNull(),
    "external_id": text("external_id").notNull(),
  },
);

const table_compliance_compliancecancellationreason = sqliteTable(
  "compliance_compliancecancellationreason",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
  },
);

const table_compliance_compliancelog = sqliteTable(
  "compliance_compliancelog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "created_at": text("created_at").notNull(),
    "info": text("info").notNull(),
    "compliance_id": bigint("compliance_id").notNull(),
    "created_by_id": integer("created_by_id"),
  },
);

const table_compliance_complianceprogramtype = sqliteTable(
  "compliance_complianceprogramtype",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_compliance_compliancerequest = sqliteTable(
  "compliance_compliancerequest",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "closed_at": text("closed_at"),
    "status_trace": text("status_trace").notNull(),
    "due_date": text("due_date"),
    "last_handled_at": text("last_handled_at"),
    "status": text("status").notNull(),
    "request_type": text("request_type").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "cl_policy_id": bigint("cl_policy_id"),
    "client_id": bigint("client_id"),
    "main_policy_id": bigint("main_policy_id"),
    "owner_id": integer("owner_id"),
    "process_steps": text("process_steps"),
    "process_type": text("process_type").notNull(),
    "cl_policy_number": text("cl_policy_number").notNull(),
    "main_policy_number": text("main_policy_number").notNull(),
    "last_email_read_at": text("last_email_read_at"),
    "last_inbound_email_at": text("last_inbound_email_at"),
    "ai_email_summary": text("ai_email_summary"),
    "contract_summary": text("contract_summary").notNull(),
    "contract_summary_attempted_at": text("contract_summary_attempted_at"),
    "modification_subtype": text("modification_subtype").notNull(),
    "cancellation_reason_id": bigint("cancellation_reason_id"),
    "mailbox_id": bigint("mailbox_id").notNull(),
    "contract_summary_failure_count": integer("contract_summary_failure_count").notNull(),
    "insurance_subject": text("insurance_subject").notNull(),
    "program_type_id": bigint("program_type_id"),
    "source_compliance_id": bigint("source_compliance_id"),
  },
);

const table_compliance_compliancerequest_tags = sqliteTable(
  "compliance_compliancerequest_tags",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "compliancerequest_id": bigint("compliancerequest_id").notNull(),
    "compliancetag_id": bigint("compliancetag_id").notNull(),
  },
);

const table_compliance_compliancetag = sqliteTable(
  "compliance_compliancetag",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "name": text("name").notNull(),
    "color": text("color").notNull(),
    "agency_id": bigint("agency_id"),
  },
);

const table_compliance_documentspecification = sqliteTable(
  "compliance_documentspecification",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "request_type": text("request_type").notNull(),
    "client_type": text("client_type").notNull(),
    "name": text("name").notNull(),
    "description": text("description").notNull(),
    "tag_id": integer("tag_id").notNull(),
    "is_mandatory": integer("is_mandatory", { mode: "boolean" }).notNull(),
    "is_contract": integer("is_contract", { mode: "boolean" }).notNull(),
  },
);

const table_compliance_processstepemailtemplate = sqliteTable(
  "compliance_processstepemailtemplate",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "compliance_type": text("compliance_type").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "email_template_id": bigint("email_template_id").notNull(),
  },
);

const table_compliance_requestdocument = sqliteTable(
  "compliance_requestdocument",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "file": text("file").notNull(),
    "completed_at": text("completed_at"),
    "reader_data": text("reader_data"),
    "request_id": bigint("request_id").notNull(),
    "uploaded_by_id": integer("uploaded_by_id"),
  },
);

const table_compliance_requestdocument_tags = sqliteTable(
  "compliance_requestdocument_tags",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "requestdocument_id": bigint("requestdocument_id").notNull(),
    "documenttag_id": integer("documenttag_id").notNull(),
  },
);

const table_constance_constance = sqliteTable(
  "constance_constance",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "key": text("key").notNull(),
    "value": text("value"),
  },
);

const table_customer_address = sqliteTable(
  "customer_address",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "address": text("address").notNull(),
    "city_id": integer("city_id").notNull(),
    "coordinates": text("coordinates"),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "complement": text("complement").notNull(),
  },
);

const table_customer_client = sqliteTable(
  "customer_client",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "id_number": text("id_number").notNull(),
    "migration_slug": text("migration_slug").notNull(),
    "external_id": text("external_id").notNull(),
  },
);

const table_customer_clientagency = sqliteTable(
  "customer_clientagency",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "client_id": bigint("client_id").notNull(),
    "created_by": text("created_by").notNull(),
    "created_by_slug": text("created_by_slug").notNull(),
    "birthday_notification": integer("birthday_notification", { mode: "boolean" }).notNull(),
    "payment_notification": integer("payment_notification", { mode: "boolean" }).notNull(),
    "renewal_notification": integer("renewal_notification", { mode: "boolean" }).notNull(),
    "commercial_unit_id": bigint("commercial_unit_id"),
    "group_id": bigint("group_id"),
    "document_url": text("document_url").notNull(),
    "computed_data": text("computed_data").notNull(),
    "completed_at": text("completed_at"),
    "origin_from_prospects": integer("origin_from_prospects", { mode: "boolean" }).notNull(),
  },
);

const table_customer_clientlog = sqliteTable(
  "customer_clientlog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "created_at": text("created_at").notNull(),
    "info": text("info").notNull(),
    "created_by_id": integer("created_by_id"),
    "client_id": bigint("client_id").notNull(),
  },
);

const table_customer_consortium = sqliteTable(
  "customer_consortium",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "percentage": text("percentage").notNull(),
    "legal_person_id": bigint("legal_person_id"),
    "is_main": integer("is_main", { mode: "boolean" }).notNull(),
    "natural_person_id": bigint("natural_person_id"),
    "client_id": bigint("client_id").notNull(),
    "name_display": text("name_display").notNull(),
  },
);

const table_customer_customersellershare = sqliteTable(
  "customer_customersellershare",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "percentage": text("percentage").notNull(),
    "client_agency_id": bigint("client_agency_id").notNull(),
    "seller_id": bigint("seller_id").notNull(),
  },
);

const table_customer_document = sqliteTable(
  "customer_document",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "file": text("file").notNull(),
    "completed_at": text("completed_at"),
    "uploaded_by_id": integer("uploaded_by_id"),
    "reader_data": text("reader_data"),
    "client_id": bigint("client_id"),
  },
);

const table_customer_document_tags = sqliteTable(
  "customer_document_tags",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "document_id": bigint("document_id").notNull(),
    "documenttag_id": integer("documenttag_id").notNull(),
  },
);

const table_customer_group = sqliteTable(
  "customer_group",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "agency_id": bigint("agency_id"),
    "description": text("description").notNull(),
  },
);

const table_customer_legalperson = sqliteTable(
  "customer_legalperson",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "id_number": text("id_number").notNull(),
    "id_check_digit": text("id_check_digit").notNull(),
    "incorporation_date": text("incorporation_date"),
    "lr_name": text("lr_name").notNull(),
    "lr_id_type": text("lr_id_type").notNull(),
    "lr_id_number": text("lr_id_number").notNull(),
    "address_id": bigint("address_id"),
    "business_activity_id": integer("business_activity_id"),
    "client_id": bigint("client_id").notNull(),
  },
);

const table_customer_legalpersoncontact = sqliteTable(
  "customer_legalpersoncontact",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "surname": text("surname").notNull(),
    "email": text("email").notNull(),
    "phone": text("phone").notNull(),
    "position": text("position").notNull(),
    "legal_person_id": bigint("legal_person_id").notNull(),
    "is_main": integer("is_main", { mode: "boolean" }).notNull(),
    "name": text("name").notNull(),
    "comments": text("comments").notNull(),
  },
);

const table_customer_naturalperson = sqliteTable(
  "customer_naturalperson",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "surname": text("surname").notNull(),
    "birth_date": text("birth_date"),
    "phone": text("phone").notNull(),
    "id_type": text("id_type").notNull(),
    "id_number": text("id_number").notNull(),
    "id_issue_at": text("id_issue_at"),
    "marital_status": text("marital_status").notNull(),
    "occupation": text("occupation").notNull(),
    "company": text("company").notNull(),
    "home_address_id": bigint("home_address_id"),
    "work_address_id": bigint("work_address_id"),
    "genre": text("genre").notNull(),
    "name": text("name").notNull(),
    "email": text("email").notNull(),
    "client_id": bigint("client_id").notNull(),
  },
);

const table_customer_prospect = sqliteTable(
  "customer_prospect",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "status": text("status").notNull(),
    "person_type": text("person_type").notNull(),
    "name": text("name").notNull(),
    "surname": text("surname").notNull(),
    "business_name": text("business_name").notNull(),
    "id_type": text("id_type").notNull(),
    "id_number": text("id_number").notNull(),
    "id_check_digit": text("id_check_digit").notNull(),
    "phone": text("phone").notNull(),
    "email": text("email").notNull(),
    "currency": text("currency").notNull(),
    "annual_premium_potential": text("annual_premium_potential"),
    "annual_commission_potential": text("annual_commission_potential"),
    "closed_at": text("closed_at"),
    "completed_at": text("completed_at"),
    "agency_id": bigint("agency_id").notNull(),
    "origin": text("origin").notNull(),
    "referred_by": text("referred_by").notNull(),
    "referred_by_client_id": bigint("referred_by_client_id"),
    "conversion_client_agency_id": bigint("conversion_client_agency_id"),
    "commercial_analysis_last_attempt_failed": integer("commercial_analysis_last_attempt_failed", { mode: "boolean" }).notNull(),
    "is_commercial_analysis_generating": integer("is_commercial_analysis_generating", { mode: "boolean" }).notNull(),
  },
);

const table_customer_prospectdocument = sqliteTable(
  "customer_prospectdocument",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "file": text("file").notNull(),
    "completed_at": text("completed_at"),
    "is_commercial_analysis": integer("is_commercial_analysis", { mode: "boolean" }).notNull(),
    "prospect_id": bigint("prospect_id").notNull(),
    "uploaded_by_id": integer("uploaded_by_id"),
  },
);

const table_customer_prospectdocument_tags = sqliteTable(
  "customer_prospectdocument_tags",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "prospectdocument_id": bigint("prospectdocument_id").notNull(),
    "documenttag_id": integer("documenttag_id").notNull(),
  },
);

const table_customer_prospectlog = sqliteTable(
  "customer_prospectlog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "created_at": text("created_at").notNull(),
    "info": text("info").notNull(),
    "created_by_id": integer("created_by_id"),
    "prospect_id": bigint("prospect_id").notNull(),
  },
);

const table_django_admin_log = sqliteTable(
  "django_admin_log",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "action_time": text("action_time").notNull(),
    "object_id": text("object_id"),
    "object_repr": text("object_repr").notNull(),
    "action_flag": integer("action_flag").notNull(),
    "change_message": text("change_message").notNull(),
    "content_type_id": integer("content_type_id"),
    "user_id": integer("user_id").notNull(),
  },
);

const table_django_content_type = sqliteTable(
  "django_content_type",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "app_label": text("app_label").notNull(),
    "model": text("model").notNull(),
  },
);

const table_django_migrations = sqliteTable(
  "django_migrations",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "app": text("app").notNull(),
    "name": text("name").notNull(),
    "applied": text("applied").notNull(),
  },
);

const table_django_session = sqliteTable(
  "django_session",
  {
    "session_key": text("session_key").primaryKey().notNull(),
    "session_data": text("session_data").notNull(),
    "expire_date": text("expire_date").notNull(),
  },
);

const table_django_site = sqliteTable(
  "django_site",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "domain": text("domain").notNull(),
    "name": text("name").notNull(),
  },
);

const table_financial_statements_accountnormalization = sqliteTable(
  "financial_statements_accountnormalization",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "original_name": text("original_name").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "account_code": bigint("account_code").notNull(),
    "eeff": text("eeff").notNull(),
    "fp_a": text("fp_a").notNull(),
    "presupuesto": text("presupuesto").notNull(),
    "modelo": text("modelo").notNull(),
  },
);

const table_financial_statements_accountnormalizationfile = sqliteTable(
  "financial_statements_accountnormalizationfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "status": text("status").notNull(),
    "report": text("report").notNull(),
    "created_by_id": integer("created_by_id"),
  },
);

const table_financial_statements_agencyauthentication = sqliteTable(
  "financial_statements_agencyauthentication",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "user": text("user").notNull(),
    "key": text("key").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_financial_statements_financialreportfile = sqliteTable(
  "financial_statements_financialreportfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "month": integer("month").notNull(),
    "year": integer("year").notNull(),
    "status": text("status").notNull(),
    "report": text("report").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_financial_statements_financialreportrequest = sqliteTable(
  "financial_statements_financialreportrequest",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "month_since": integer("month_since").notNull(),
    "month_until": integer("month_until").notNull(),
    "year": integer("year").notNull(),
    "report": text("report").notNull(),
    "created_by_id": integer("created_by_id"),
  },
);

const table_financial_statements_financialreportrequest_agencies = sqliteTable(
  "financial_statements_financialreportrequest_agencies",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "financialreportrequest_id": bigint("financialreportrequest_id").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_financial_statements_financialstatement = sqliteTable(
  "financial_statements_financialstatement",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "level": text("level").notNull(),
    "transactional": text("transactional").notNull(),
    "account_code": bigint("account_code").notNull(),
    "account_name": text("account_name").notNull(),
    "id_number": text("id_number"),
    "branch": text("branch"),
    "third_party_name": text("third_party_name"),
    "initial_balance": text("initial_balance").notNull(),
    "debit_movement": text("debit_movement").notNull(),
    "credit_movement": text("credit_movement").notNull(),
    "final_balance": text("final_balance").notNull(),
    "fp_a": text("fp_a").notNull(),
    "eeff": text("eeff").notNull(),
    "presupuesto": text("presupuesto").notNull(),
    "report_file_id": bigint("report_file_id").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "month": integer("month").notNull(),
    "year": integer("year").notNull(),
    "modelo": text("modelo").notNull(),
  },
);

const table_help_newsletter = sqliteTable(
  "help_newsletter",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "title": text("title").notNull(),
    "image": text("image").notNull(),
    "start_at": text("start_at").notNull(),
    "finish_at": text("finish_at").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
  },
);

const table_help_newsletterusersurvey = sqliteTable(
  "help_newsletterusersurvey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "user_name": text("user_name").notNull(),
    "response": text("response").notNull(),
    "comment": text("comment").notNull(),
    "newsletter_id": bigint("newsletter_id").notNull(),
    "user_id": integer("user_id"),
  },
);

const table_help_request = sqliteTable(
  "help_request",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "title": text("title").notNull(),
    "created_by": text("created_by").notNull(),
    "created_by_slug": text("created_by_slug").notNull(),
    "request_type": text("request_type").notNull(),
    "status": text("status").notNull(),
    "description": text("description").notNull(),
    "need_to_solve": text("need_to_solve").notNull(),
    "problem_impact": text("problem_impact").notNull(),
    "problem_frequency": text("problem_frequency").notNull(),
    "current_alternatives": text("current_alternatives").notNull(),
    "expected_result": text("expected_result").notNull(),
    "acceptance_criteria": text("acceptance_criteria").notNull(),
    "priority": text("priority").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "assigned_to_id": integer("assigned_to_id").notNull(),
    "category_id": bigint("category_id"),
  },
);

const table_help_requestcategory = sqliteTable(
  "help_requestcategory",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "request_type": text("request_type").notNull(),
  },
);

const table_help_requestdocument = sqliteTable(
  "help_requestdocument",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "file": text("file").notNull(),
    "completed_at": text("completed_at"),
    "request_id": bigint("request_id"),
  },
);

const table_help_requestlog = sqliteTable(
  "help_requestlog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "created_at": text("created_at").notNull(),
    "info": text("info").notNull(),
    "created_by_id": integer("created_by_id"),
    "request_id": bigint("request_id").notNull(),
    "attachment": text("attachment"),
  },
);

const table_help_trainingcategory = sqliteTable(
  "help_trainingcategory",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "name_slug": text("name_slug").notNull(),
    "is_main": integer("is_main", { mode: "boolean" }).notNull(),
    "is_reconciliation": integer("is_reconciliation", { mode: "boolean" }).notNull(),
  },
);

const table_help_trainingvideo = sqliteTable(
  "help_trainingvideo",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "youtube_id": text("youtube_id").notNull(),
    "title": text("title").notNull(),
    "description": text("description").notNull(),
    "duration": text("duration").notNull(),
    "order": integer("order").notNull(),
    "category_id": bigint("category_id").notNull(),
  },
);

const table_insurance_agencyshare = sqliteTable(
  "insurance_agencyshare",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "percentage": text("percentage").notNull(),
    "is_main": integer("is_main", { mode: "boolean" }).notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "policy_id": bigint("policy_id").notNull(),
    "commercial_unit_id": bigint("commercial_unit_id"),
  },
);

const table_insurance_beneficiary = sqliteTable(
  "insurance_beneficiary",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "id_number": text("id_number").notNull(),
    "is_borrow": integer("is_borrow", { mode: "boolean" }).notNull(),
    "insured_id": bigint("insured_id").notNull(),
  },
);

const table_insurance_endorsement = sqliteTable(
  "insurance_endorsement",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "number": text("number"),
    "type": text("type").notNull(),
    "start_at": text("start_at"),
    "finish_at": text("finish_at"),
    "issue_at": text("issue_at"),
    "description": text("description").notNull(),
    "basic_premium": text("basic_premium"),
    "additional_costs": text("additional_costs").notNull(),
    "issuing_costs": text("issuing_costs").notNull(),
    "tax_amount": text("tax_amount"),
    "total_premium": text("total_premium"),
    "policy_id": bigint("policy_id").notNull(),
    "completed_at": text("completed_at"),
    "migration_slug": text("migration_slug").notNull(),
    "commission_percentage": text("commission_percentage"),
    "commission_amount": text("commission_amount"),
    "sent_at": text("sent_at"),
    "basic_premium_cop": text("basic_premium_cop"),
    "commission_amount_cop": text("commission_amount_cop"),
    "rmr": text("rmr").notNull(),
    "total_premium_cop": text("total_premium_cop"),
    "computed_data": text("computed_data").notNull(),
    "cancellation_reason_id": bigint("cancellation_reason_id"),
    "term_id": bigint("term_id"),
    "external_id": text("external_id").notNull(),
    "renewal_at": text("renewal_at"),
    "contract_validity_at": text("contract_validity_at"),
  },
);

const table_insurance_endorsementdocument = sqliteTable(
  "insurance_endorsementdocument",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "file": text("file").notNull(),
    "completed_at": text("completed_at"),
    "endorsement_id": bigint("endorsement_id"),
    "uploaded_by_id": integer("uploaded_by_id"),
  },
);

const table_insurance_endorsementdocument_tags = sqliteTable(
  "insurance_endorsementdocument_tags",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "endorsementdocument_id": bigint("endorsementdocument_id").notNull(),
    "documenttag_id": integer("documenttag_id").notNull(),
  },
);

const table_insurance_insured = sqliteTable(
  "insurance_insured",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "id_type": text("id_type").notNull(),
    "id_number": text("id_number").notNull(),
    "phone": text("phone"),
    "email": text("email").notNull(),
    "birth_date": text("birth_date"),
    "endorsement_id": bigint("endorsement_id").notNull(),
    "amount": text("amount"),
    "end_at": text("end_at"),
    "label": text("label").notNull(),
    "start_at": text("start_at"),
  },
);

const table_insurance_insurershare = sqliteTable(
  "insurance_insurershare",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "percentage": text("percentage").notNull(),
    "is_main": integer("is_main", { mode: "boolean" }).notNull(),
    "insurer_company_id": bigint("insurer_company_id").notNull(),
    "policy_id": bigint("policy_id").notNull(),
  },
);

const table_insurance_paymenttaskreminder = sqliteTable(
  "insurance_paymenttaskreminder",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "frequency": text("frequency").notNull(),
    "reminder_at": text("reminder_at").notNull(),
    "owner_id": integer("owner_id").notNull(),
    "policy_id": bigint("policy_id").notNull(),
    "last_reminder_at": text("last_reminder_at"),
  },
);

const table_insurance_policy = sqliteTable(
  "insurance_policy",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "type": text("type").notNull(),
    "currency": text("currency").notNull(),
    "insurance_number": text("insurance_number").notNull(),
    "holder_name": text("holder_name").notNull(),
    "holder_id": text("holder_id").notNull(),
    "client_id": bigint("client_id").notNull(),
    "payment_type": text("payment_type").notNull(),
    "ramo_id": bigint("ramo_id").notNull(),
    "renewal_type": text("renewal_type").notNull(),
    "created_by": text("created_by").notNull(),
    "status": text("status").notNull(),
    "completed_at": text("completed_at"),
    "is_same_insured": integer("is_same_insured", { mode: "boolean" }).notNull(),
    "renewed_policy_id": bigint("renewed_policy_id"),
    "migration_slug": text("migration_slug").notNull(),
    "created_by_slug": text("created_by_slug").notNull(),
    "has_lienholder": integer("has_lienholder", { mode: "boolean" }).notNull(),
    "has_seller": integer("has_seller", { mode: "boolean" }),
    "computed_data": text("computed_data").notNull(),
    "insurance_subject": text("insurance_subject").notNull(),
    "external_id": text("external_id").notNull(),
    "owner_id": integer("owner_id"),
    "allows_endorsement_extended_term": integer("allows_endorsement_extended_term", { mode: "boolean" }).notNull(),
    "document_url": text("document_url").notNull(),
    "prospect_id": bigint("prospect_id"),
  },
);

const table_insurance_policydocument = sqliteTable(
  "insurance_policydocument",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "file": text("file").notNull(),
    "policy_id": bigint("policy_id"),
    "completed_at": text("completed_at"),
    "uploaded_by_id": integer("uploaded_by_id"),
    "reader_data": text("reader_data"),
  },
);

const table_insurance_policydocument_tags = sqliteTable(
  "insurance_policydocument_tags",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "policydocument_id": bigint("policydocument_id").notNull(),
    "documenttag_id": integer("documenttag_id").notNull(),
  },
);

const table_insurance_policylog = sqliteTable(
  "insurance_policylog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "created_at": text("created_at").notNull(),
    "info": text("info").notNull(),
    "created_by_id": integer("created_by_id"),
    "policy_id": bigint("policy_id").notNull(),
  },
);

const table_insurance_reinvestment = sqliteTable(
  "insurance_reinvestment",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "invoice": text("invoice").notNull(),
    "amount": text("amount").notNull(),
    "provider_name": text("provider_name").notNull(),
    "provider_id": text("provider_id").notNull(),
    "provider_id_type": text("provider_id_type").notNull(),
    "provider_id_check_digit": text("provider_id_check_digit").notNull(),
    "activity_at": text("activity_at").notNull(),
    "observation": text("observation").notNull(),
    "policy_id": bigint("policy_id").notNull(),
    "activity_id": bigint("activity_id").notNull(),
    "provider_name_slug": text("provider_name_slug").notNull(),
  },
);

const table_insurance_reinvestmentactivity = sqliteTable(
  "insurance_reinvestmentactivity",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
  },
);

const table_insurance_reinvestmentterm = sqliteTable(
  "insurance_reinvestmentterm",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "total_estimated_amount": text("total_estimated_amount").notNull(),
    "reinvestment_percentage": text("reinvestment_percentage").notNull(),
    "term_id": bigint("term_id").notNull(),
  },
);

const table_insurance_sellershare = sqliteTable(
  "insurance_sellershare",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "percentage": text("percentage").notNull(),
    "policy_id": bigint("policy_id").notNull(),
    "seller_id": bigint("seller_id").notNull(),
  },
);

const table_insurance_term = sqliteTable(
  "insurance_term",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "start_at": text("start_at").notNull(),
    "finish_at": text("finish_at").notNull(),
    "policy_id": bigint("policy_id").notNull(),
    "computed_data": text("computed_data").notNull(),
  },
);

const table_mfa_authenticator = sqliteTable(
  "mfa_authenticator",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "type": text("type").notNull(),
    "data": text("data").notNull(),
    "user_id": integer("user_id").notNull(),
    "created_at": text("created_at").notNull(),
    "last_used_at": text("last_used_at"),
  },
);

const table_notification_attachment = sqliteTable(
  "notification_attachment",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "notification_id": bigint("notification_id").notNull(),
    "name": text("name").notNull(),
    "is_initial": integer("is_initial", { mode: "boolean" }).notNull(),
    "extension": text("extension").notNull(),
    "microsoft_id": text("microsoft_id").notNull(),
  },
);

const table_notification_configuration = sqliteTable(
  "notification_configuration",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "payment_email": text("payment_email").notNull(),
    "renewal_email": text("renewal_email").notNull(),
    "payment_first_notification_days": integer("payment_first_notification_days"),
    "payment_second_notification_days": integer("payment_second_notification_days"),
    "renewal_first_notification_days": integer("renewal_first_notification_days"),
    "renewal_second_notification_days": integer("renewal_second_notification_days"),
    "agency_id": bigint("agency_id").notNull(),
    "birthday_email": text("birthday_email").notNull(),
    "birthday_notification": integer("birthday_notification", { mode: "boolean" }).notNull(),
  },
);

const table_notification_customemailtemplatetype = sqliteTable(
  "notification_customemailtemplatetype",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "description": text("description").notNull(),
    "email_template_id": bigint("email_template_id"),
  },
);

const table_notification_emailtemplate = sqliteTable(
  "notification_emailtemplate",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "type": text("type").notNull(),
    "subject": text("subject").notNull(),
    "body": text("body").notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_notification_emailtemplate_ramos = sqliteTable(
  "notification_emailtemplate_ramos",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "emailtemplate_id": bigint("emailtemplate_id").notNull(),
    "ramo_id": bigint("ramo_id").notNull(),
  },
);

const table_notification_emailtemplateimage = sqliteTable(
  "notification_emailtemplateimage",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "image": text("image"),
    "template_id": bigint("template_id"),
  },
);

const table_notification_externalnotification = sqliteTable(
  "notification_externalnotification",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "mail_to": text("mail_to").notNull(),
    "send_at": text("send_at"),
    "type": text("type").notNull(),
    "subject": text("subject").notNull(),
    "body": text("body").notNull(),
    "status": text("status").notNull(),
    "client_id": bigint("client_id"),
    "policy_id": bigint("policy_id"),
    "agency_id": bigint("agency_id").notNull(),
    "endorsement_id": bigint("endorsement_id"),
    "anymail_id": text("anymail_id").notNull(),
    "from_email": text("from_email").notNull(),
    "user_id": integer("user_id"),
    "cc_to": text("cc_to").notNull(),
    "direction": text("direction").notNull(),
    "microsoft_id": text("microsoft_id"),
    "reply_to_message_id": text("reply_to_message_id").notNull(),
  },
);

const table_notification_graphsubscription = sqliteTable(
  "notification_graphsubscription",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "subscription_id": text("subscription_id").notNull(),
    "resource": text("resource").notNull(),
    "expiration_datetime": text("expiration_datetime").notNull(),
    "client_state": text("client_state").notNull(),
    "mailbox_id": bigint("mailbox_id").notNull(),
  },
);

const table_notification_internalnotification = sqliteTable(
  "notification_internalnotification",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "section": text("section").notNull(),
    "created_by": text("created_by").notNull(),
    "redirect_url": text("redirect_url").notNull(),
    "info": text("info").notNull(),
    "title": text("title").notNull(),
    "read_at": text("read_at"),
    "user_id": integer("user_id").notNull(),
  },
);

const table_notification_microsoftgraphevent = sqliteTable(
  "notification_microsoftgraphevent",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "external_notification_id_slug": text("external_notification_id_slug").notNull(),
    "action": text("action").notNull(),
    "outcome": text("outcome").notNull(),
    "response_data": text("response_data").notNull(),
  },
);

const table_notification_microsoftgraphnotification = sqliteTable(
  "notification_microsoftgraphnotification",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "conversation_id": text("conversation_id").notNull(),
    "internet_message_id": text("internet_message_id").notNull(),
    "compliance_request_id": bigint("compliance_request_id"),
    "notification_id": bigint("notification_id").notNull(),
  },
);

const table_notification_ramoconfiguration = sqliteTable(
  "notification_ramoconfiguration",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "first_notification_days": integer("first_notification_days"),
    "second_notification_days": integer("second_notification_days"),
    "configuration_id": bigint("configuration_id").notNull(),
    "ramo_id": bigint("ramo_id").notNull(),
    "type": text("type").notNull(),
  },
);

const table_operation_collectionfile = sqliteTable(
  "operation_collectionfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "report_file": text("report_file"),
    "report": text("report").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "insurance_company_id": bigint("insurance_company_id"),
  },
);

const table_operation_payment = sqliteTable(
  "operation_payment",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "amount": text("amount").notNull(),
    "commission_amount": text("commission_amount").notNull(),
    "due_date": text("due_date").notNull(),
    "receipt": text("receipt"),
    "status": text("status").notNull(),
    "commissioned_at": text("commissioned_at"),
    "remission": text("remission"),
    "paid_at": text("paid_at"),
    "settlement_id": bigint("settlement_id"),
    "migration_slug": text("migration_slug").notNull(),
    "created_by": text("created_by").notNull(),
    "created_by_slug": text("created_by_slug").notNull(),
    "receipt_number": text("receipt_number").notNull(),
    "installments": integer("installments"),
    "agency_id": bigint("agency_id").notNull(),
    "basic_premium_cop": text("basic_premium_cop"),
    "commission_amount_cop": text("commission_amount_cop"),
    "rmr": text("rmr").notNull(),
    "comments": text("comments").notNull(),
    "reconciliation_slug": text("reconciliation_slug").notNull(),
    "paid_at_set_at": text("paid_at_set_at"),
    "computed_data": text("computed_data").notNull(),
    "external_id": text("external_id").notNull(),
    "term_id": bigint("term_id").notNull(),
  },
);

const table_operation_paymentamount = sqliteTable(
  "operation_paymentamount",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "amount": text("amount").notNull(),
    "commission_amount": text("commission_amount").notNull(),
    "endorsement_id": bigint("endorsement_id").notNull(),
    "payment_id": bigint("payment_id").notNull(),
  },
);

const table_operation_paymentcollectionfollowup = sqliteTable(
  "operation_paymentcollectionfollowup",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "contact_date": text("contact_date").notNull(),
    "contact_type": text("contact_type").notNull(),
    "outcome": text("outcome").notNull(),
    "promise_date": text("promise_date"),
    "promise_amount": text("promise_amount"),
    "comments": text("comments").notNull(),
    "created_by": text("created_by").notNull(),
    "created_by_slug": text("created_by_slug").notNull(),
    "payment_id": bigint("payment_id").notNull(),
    "owner_id": integer("owner_id"),
  },
);

const table_operation_paymentlog = sqliteTable(
  "operation_paymentlog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "created_at": text("created_at").notNull(),
    "info": text("info").notNull(),
    "created_by_id": integer("created_by_id"),
    "payment_id": bigint("payment_id").notNull(),
  },
);

const table_operation_paymentresponsible = sqliteTable(
  "operation_paymentresponsible",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "name": text("name").notNull(),
    "id_type": text("id_type").notNull(),
    "id_number": text("id_number").notNull(),
    "email": text("email").notNull(),
    "payment_id": bigint("payment_id").notNull(),
  },
);

const table_operation_portfolioreconciliationfile = sqliteTable(
  "operation_portfolioreconciliationfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "uploaded_by_name": text("uploaded_by_name").notNull(),
    "uploaded_file": text("uploaded_file").notNull(),
    "report_file": text("report_file"),
    "agency_id": bigint("agency_id").notNull(),
    "insurance_company_id": bigint("insurance_company_id"),
  },
);

const table_operation_reconciliationfile = sqliteTable(
  "operation_reconciliationfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "file_hash": text("file_hash").notNull(),
    "cutoff_date": text("cutoff_date").notNull(),
    "extension": text("extension").notNull(),
    "report": text("report").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "insurance_company_id": bigint("insurance_company_id"),
    "completed_at": text("completed_at"),
    "report_file": text("report_file"),
  },
);

const table_operation_reimbursement = sqliteTable(
  "operation_reimbursement",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "charged_amount": text("charged_amount"),
    "affected": text("affected").notNull(),
    "reason": text("reason").notNull(),
    "subject": text("subject").notNull(),
    "invoice_number": text("invoice_number").notNull(),
    "received_at": text("received_at"),
    "event_date": text("event_date"),
    "payment_at": text("payment_at"),
    "paid_amount": text("paid_amount"),
    "is_foreign": integer("is_foreign", { mode: "boolean" }).notNull(),
    "foreign_charged_amount": text("foreign_charged_amount"),
    "charged_currency": text("charged_currency").notNull(),
    "foreign_paid_amount": text("foreign_paid_amount"),
    "paid_currency": text("paid_currency").notNull(),
    "deductible": text("deductible"),
    "task_id": bigint("task_id").notNull(),
  },
);

const table_operation_reimbursementreport = sqliteTable(
  "operation_reimbursementreport",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "account_number": text("account_number").notNull(),
    "account_type": text("account_type").notNull(),
    "account_holder": text("account_holder").notNull(),
    "observations": text("observations").notNull(),
    "created_by": text("created_by").notNull(),
    "created_by_slug": text("created_by_slug").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "bank_id": integer("bank_id"),
    "term_id": bigint("term_id").notNull(),
  },
);

const table_operation_reimbursementreport_reimbursements = sqliteTable(
  "operation_reimbursementreport_reimbursements",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "reimbursementreport_id": bigint("reimbursementreport_id").notNull(),
    "reimbursement_id": bigint("reimbursement_id").notNull(),
  },
);

const table_operation_settlement = sqliteTable(
  "operation_settlement",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "taxes": text("taxes").notNull(),
    "seller_id": bigint("seller_id").notNull(),
    "agency_commission_amount": text("agency_commission_amount").notNull(),
    "premium_amount": text("premium_amount").notNull(),
    "seller_commission_amount": text("seller_commission_amount").notNull(),
    "tax_withholding": text("tax_withholding").notNull(),
    "total_amount": text("total_amount").notNull(),
    "paid_at": text("paid_at"),
  },
);

const table_operation_settlementdocument = sqliteTable(
  "operation_settlementdocument",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "file": text("file").notNull(),
    "completed_at": text("completed_at"),
    "settlement_id": bigint("settlement_id").notNull(),
    "uploaded_by_id": integer("uploaded_by_id"),
  },
);

const table_operation_settlementdocument_tags = sqliteTable(
  "operation_settlementdocument_tags",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "settlementdocument_id": bigint("settlementdocument_id").notNull(),
    "documenttag_id": integer("documenttag_id").notNull(),
  },
);

const table_operation_settlementlog = sqliteTable(
  "operation_settlementlog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "created_at": text("created_at").notNull(),
    "info": text("info").notNull(),
    "created_by_id": integer("created_by_id"),
    "settlement_id": bigint("settlement_id").notNull(),
  },
);

const table_operation_task = sqliteTable(
  "operation_task",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "status": text("status").notNull(),
    "due_date": text("due_date"),
    "client_id": bigint("client_id"),
    "owner_id": integer("owner_id"),
    "policy_id": bigint("policy_id"),
    "ramo_id": bigint("ramo_id"),
    "agency_id": bigint("agency_id").notNull(),
    "completed_at": text("completed_at"),
    "name": text("name").notNull(),
    "priority": text("priority").notNull(),
    "reminder_at": text("reminder_at"),
    "closed_at": text("closed_at"),
    "type_id": bigint("type_id").notNull(),
    "claim_id": bigint("claim_id"),
    "migration_slug": text("migration_slug").notNull(),
    "computed_data": text("computed_data").notNull(),
    "seller_id": bigint("seller_id"),
    "is_automatic": integer("is_automatic", { mode: "boolean" }).notNull(),
    "created_by": text("created_by").notNull(),
    "created_by_slug": text("created_by_slug").notNull(),
    "external_id": text("external_id").notNull(),
    "days_count": integer("days_count").notNull(),
    "prospect_id": bigint("prospect_id"),
  },
);

const table_operation_task_tags = sqliteTable(
  "operation_task_tags",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "task_id": bigint("task_id").notNull(),
    "tasktag_id": bigint("tasktag_id").notNull(),
  },
);

const table_operation_taskassignmentrule = sqliteTable(
  "operation_taskassignmentrule",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "created_by": text("created_by").notNull(),
    "position": integer("position").notNull(),
    "agency_id": bigint("agency_id").notNull(),
    "owner_id": integer("owner_id").notNull(),
  },
);

const table_operation_taskassignmentrule_insurers = sqliteTable(
  "operation_taskassignmentrule_insurers",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "taskassignmentrule_id": bigint("taskassignmentrule_id").notNull(),
    "insurercompany_id": bigint("insurercompany_id").notNull(),
  },
);

const table_operation_taskassignmentrule_ramos = sqliteTable(
  "operation_taskassignmentrule_ramos",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "taskassignmentrule_id": bigint("taskassignmentrule_id").notNull(),
    "ramo_id": bigint("ramo_id").notNull(),
  },
);

const table_operation_taskassignmentrule_sellers = sqliteTable(
  "operation_taskassignmentrule_sellers",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "taskassignmentrule_id": bigint("taskassignmentrule_id").notNull(),
    "seller_id": bigint("seller_id").notNull(),
  },
);

const table_operation_taskdocument = sqliteTable(
  "operation_taskdocument",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "file": text("file").notNull(),
    "completed_at": text("completed_at"),
    "task_id": bigint("task_id"),
    "uploaded_by_id": integer("uploaded_by_id"),
  },
);

const table_operation_taskdocument_tags = sqliteTable(
  "operation_taskdocument_tags",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "taskdocument_id": bigint("taskdocument_id").notNull(),
    "documenttag_id": integer("documenttag_id").notNull(),
  },
);

const table_operation_tasklog = sqliteTable(
  "operation_tasklog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "created_at": text("created_at").notNull(),
    "info": text("info").notNull(),
    "created_by_id": integer("created_by_id"),
    "task_id": bigint("task_id").notNull(),
  },
);

const table_operation_tasktag = sqliteTable(
  "operation_tasktag",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "name": text("name").notNull(),
    "color": text("color").notNull(),
    "agency_id": bigint("agency_id"),
  },
);

const table_operation_tasktype = sqliteTable(
  "operation_tasktype",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "name": text("name").notNull(),
    "slug": text("slug").notNull(),
    "show_dropdown": integer("show_dropdown", { mode: "boolean" }).notNull(),
    "optional_customer": integer("optional_customer", { mode: "boolean" }).notNull(),
    "prospect_status": text("prospect_status"),
  },
);

const table_production_data_importproductiondatafile = sqliteTable(
  "production_data_importproductiondatafile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "status": text("status").notNull(),
    "report": text("report").notNull(),
    "uploaded_by_id": integer("uploaded_by_id"),
    "agency_id": bigint("agency_id"),
  },
);

const table_production_data_normalizationfile = sqliteTable(
  "production_data_normalizationfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "type": text("type").notNull(),
    "status": text("status").notNull(),
    "report": text("report").notNull(),
    "created_by_id": integer("created_by_id"),
  },
);

const table_production_data_productiondata = sqliteTable(
  "production_data_productiondata",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "policy_number": text("policy_number").notNull(),
    "premium": text("premium").notNull(),
    "commission": text("commission"),
    "insured_id": text("insured_id"),
    "insured_name": text("insured_name").notNull(),
    "admission_date": text("admission_date").notNull(),
    "start_date": text("start_date").notNull(),
    "end_date": text("end_date").notNull(),
    "ramo": text("ramo").notNull(),
    "insurer_name": text("insurer_name").notNull(),
    "agency_name": text("agency_name").notNull(),
    "unique_slug": text("unique_slug").notNull(),
    "report_file_id": bigint("report_file_id"),
  },
);

const table_production_data_standardizeinsurer = sqliteTable(
  "production_data_standardizeinsurer",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "insurer_agency": text("insurer_agency").notNull(),
    "agency_id": bigint("agency_id"),
    "insurer_id": bigint("insurer_id"),
  },
);

const table_production_data_standardizeramo = sqliteTable(
  "production_data_standardizeramo",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "ramo_agency": text("ramo_agency").notNull(),
    "agency_id": bigint("agency_id"),
    "ramo_id": bigint("ramo_id"),
  },
);

const table_redactor_redactorfile = sqliteTable(
  "redactor_redactorfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "file": text("file").notNull(),
    "name": text("name").notNull(),
    "is_image": integer("is_image", { mode: "boolean" }).notNull(),
    "created_at": text("created_at").notNull(),
  },
);

const table_renewal_documentspecification = sqliteTable(
  "renewal_documentspecification",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "client_type": text("client_type").notNull(),
    "name": text("name").notNull(),
    "description": text("description").notNull(),
    "is_mandatory": integer("is_mandatory", { mode: "boolean" }).notNull(),
    "tag_id": integer("tag_id").notNull(),
  },
);

const table_renewal_documentspecification_ramo = sqliteTable(
  "renewal_documentspecification_ramo",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "documentspecification_id": bigint("documentspecification_id").notNull(),
    "ramo_id": bigint("ramo_id").notNull(),
  },
);

const table_renewal_initialstep = sqliteTable(
  "renewal_initialstep",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "step_type": text("step_type").notNull(),
    "step_status": text("step_status").notNull(),
    "owner_id": integer("owner_id"),
    "renewal_id": bigint("renewal_id").notNull(),
  },
);

const table_renewal_initialstepconfig = sqliteTable(
  "renewal_initialstepconfig",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "commercial_notice_required": integer("commercial_notice_required", { mode: "boolean" }).notNull(),
    "claim_notice_required": integer("claim_notice_required", { mode: "boolean" }).notNull(),
    "terms_management_required": integer("terms_management_required", { mode: "boolean" }).notNull(),
    "agency_id": bigint("agency_id").notNull(),
  },
);

const table_renewal_nonrenewalreason = sqliteTable(
  "renewal_nonrenewalreason",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "show_dropdown": integer("show_dropdown", { mode: "boolean" }).notNull(),
    "show_renewal_button": integer("show_renewal_button", { mode: "boolean" }).notNull(),
  },
);

const table_renewal_renewal = sqliteTable(
  "renewal_renewal",
  {
    "updated_at": text("updated_at").notNull(),
    "id_slug": text("id_slug").notNull(),
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "name": text("name").notNull(),
    "reminder_at": text("reminder_at"),
    "closed_at": text("closed_at"),
    "migration_slug": text("migration_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "computed_data": text("computed_data").notNull(),
    "owner_id": integer("owner_id"),
    "policy_id": bigint("policy_id").notNull(),
    "non_renewal_reason_id": bigint("non_renewal_reason_id"),
    "external_id": text("external_id").notNull(),
    "status": text("status").notNull(),
    "process_steps": text("process_steps"),
    "extension_date": text("extension_date"),
    "renewal_type": text("renewal_type").notNull(),
    "insurance_company_id": bigint("insurance_company_id"),
    "send_terms_comments": text("send_terms_comments").notNull(),
    "main_renewal_id": bigint("main_renewal_id"),
  },
);

const table_renewal_renewaldocument = sqliteTable(
  "renewal_renewaldocument",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "file": text("file").notNull(),
    "completed_at": text("completed_at"),
    "renewal_id": bigint("renewal_id").notNull(),
    "uploaded_by_id": integer("uploaded_by_id"),
    "has_review": integer("has_review", { mode: "boolean" }).notNull(),
  },
);

const table_renewal_renewaldocument_tags = sqliteTable(
  "renewal_renewaldocument_tags",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "renewaldocument_id": bigint("renewaldocument_id").notNull(),
    "documenttag_id": integer("documenttag_id").notNull(),
  },
);

const table_renewal_renewallog = sqliteTable(
  "renewal_renewallog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "info": text("info").notNull(),
    "created_at": text("created_at").notNull(),
    "created_by_id": integer("created_by_id"),
    "renewal_id": bigint("renewal_id").notNull(),
  },
);

const table_sales_contractlead = sqliteTable(
  "sales_contractlead",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "contract_number": text("contract_number").notNull(),
    "stratum": integer("stratum"),
    "neighborhood": text("neighborhood").notNull(),
    "address": text("address").notNull(),
    "credit_or_request_number": text("credit_or_request_number").notNull(),
    "reference_number": text("reference_number").notNull(),
    "extra_info": text("extra_info").notNull(),
    "credit_acquisition_date": text("credit_acquisition_date"),
    "credit_installments": integer("credit_installments"),
    "city_id": integer("city_id").notNull(),
    "entity_id": bigint("entity_id").notNull(),
    "holder_id": bigint("holder_id"),
    "provider_id": bigint("provider_id").notNull(),
    "is_prepaid": integer("is_prepaid", { mode: "boolean" }).notNull(),
  },
);

const table_sales_contractleadsimportfile = sqliteTable(
  "sales_contractleadsimportfile",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "file": text("file").notNull(),
    "notify_email": text("notify_email").notNull(),
  },
);

const table_sales_entity = sqliteTable(
  "sales_entity",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "vendu_id": text("vendu_id").notNull(),
    "commercial_collective_end_day": integer("commercial_collective_end_day"),
    "commercial_collective_start_day": integer("commercial_collective_start_day"),
    "operational_collective_end_day": integer("operational_collective_end_day"),
    "operational_collective_start_day": integer("operational_collective_start_day"),
    "skip_otp": integer("skip_otp", { mode: "boolean" }).notNull(),
    "vendu_code": text("vendu_code").notNull(),
  },
);

const table_sales_entitycity = sqliteTable(
  "sales_entitycity",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "code": text("code").notNull(),
    "city_id": integer("city_id").notNull(),
    "entity_id": bigint("entity_id").notNull(),
    "department_smartflex": text("department_smartflex").notNull(),
    "locality_smartflex": text("locality_smartflex").notNull(),
  },
);

const table_sales_holder = sqliteTable(
  "sales_holder",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "id_type": text("id_type").notNull(),
    "id_number": text("id_number").notNull(),
    "id_issue_date": text("id_issue_date"),
    "email": text("email").notNull(),
    "birth_date": text("birth_date"),
    "phones": text("phones").notNull(),
  },
);

const table_sales_operator = sqliteTable(
  "sales_operator",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "has_ai_audit": integer("has_ai_audit", { mode: "boolean" }).notNull(),
    "ai_instruction": text("ai_instruction").notNull(),
  },
);

const table_sales_plan = sqliteTable(
  "sales_plan",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "vendu_id": text("vendu_id").notNull(),
    "description": text("description").notNull(),
    "price": text("price"),
    "product_id": bigint("product_id"),
    "vendu_code": text("vendu_code").notNull(),
  },
);

const table_sales_product = sqliteTable(
  "sales_product",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "prompt": text("prompt").notNull(),
    "vendu_id": text("vendu_id").notNull(),
    "entity_id": bigint("entity_id"),
    "insurer_company_id": bigint("insurer_company_id"),
    "vendu_code": text("vendu_code").notNull(),
    "transactional_export_config": text("transactional_export_config").notNull(),
    "allowed_duplicates": integer("allowed_duplicates").notNull(),
    "operator_id": bigint("operator_id").notNull(),
  },
);

const table_sales_provider = sqliteTable(
  "sales_provider",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
  },
);

const table_sales_sale = sqliteTable(
  "sales_sale",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "vendu_id": text("vendu_id").notNull(),
    "price": text("price").notNull(),
    "contract_number": text("contract_number").notNull(),
    "sales_mode": text("sales_mode").notNull(),
    "status": text("status").notNull(),
    "otp_code": text("otp_code").notNull(),
    "extra_info": text("extra_info").notNull(),
    "created_by_name": text("created_by_name").notNull(),
    "is_otp_verified": integer("is_otp_verified", { mode: "boolean" }).notNull(),
    "created_by_id": integer("created_by_id"),
    "entity_id": bigint("entity_id").notNull(),
    "plan_id": bigint("plan_id").notNull(),
    "product_id": bigint("product_id").notNull(),
    "insurer_company_id": bigint("insurer_company_id").notNull(),
    "transaction_id": text("transaction_id"),
    "positive_at": text("positive_at"),
    "contract_id": bigint("contract_id"),
    "is_reviewed": integer("is_reviewed", { mode: "boolean" }).notNull(),
    "reviewed_at": text("reviewed_at"),
    "reviewed_by_email": text("reviewed_by_email").notNull(),
    "reviewed_by_name": text("reviewed_by_name").notNull(),
    "client_id": bigint("client_id").notNull(),
  },
);

const table_sales_saleaudio = sqliteTable(
  "sales_saleaudio",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "audio_s3_key": text("audio_s3_key").notNull(),
    "sale_id": bigint("sale_id").notNull(),
  },
);

const table_sales_saletranscription = sqliteTable(
  "sales_saletranscription",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "sale_id": bigint("sale_id").notNull(),
    "audited_at": text("audited_at"),
    "audition_analysis": text("audition_analysis").notNull(),
    "transcription": text("transcription").notNull(),
  },
);

const table_socialaccount_socialaccount = sqliteTable(
  "socialaccount_socialaccount",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "provider": text("provider").notNull(),
    "uid": text("uid").notNull(),
    "last_login": text("last_login").notNull(),
    "date_joined": text("date_joined").notNull(),
    "extra_data": text("extra_data").notNull(),
    "user_id": integer("user_id").notNull(),
  },
);

const table_socialaccount_socialapp = sqliteTable(
  "socialaccount_socialapp",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "provider": text("provider").notNull(),
    "name": text("name").notNull(),
    "client_id": text("client_id").notNull(),
    "secret": text("secret").notNull(),
    "key": text("key").notNull(),
    "provider_id": text("provider_id").notNull(),
    "settings": text("settings").notNull(),
  },
);

const table_socialaccount_socialapp_sites = sqliteTable(
  "socialaccount_socialapp_sites",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "socialapp_id": integer("socialapp_id").notNull(),
    "site_id": integer("site_id").notNull(),
  },
);

const table_socialaccount_socialtoken = sqliteTable(
  "socialaccount_socialtoken",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "token": text("token").notNull(),
    "token_secret": text("token_secret").notNull(),
    "expires_at": text("expires_at"),
    "account_id": integer("account_id").notNull(),
    "app_id": integer("app_id"),
  },
);

const table_survey_npsresponse = sqliteTable(
  "survey_npsresponse",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "score": integer("score").notNull(),
    "user_id": integer("user_id").notNull(),
    "user_name": text("user_name").notNull(),
    "user_email": text("user_email").notNull(),
    "agency_id_slug_snapshot": text("agency_id_slug_snapshot").notNull(),
    "agency_name_snapshot": text("agency_name_snapshot").notNull(),
    "agency_short_name_snapshot": text("agency_short_name_snapshot").notNull(),
    "role_name": text("role_name").notNull(),
    "question": text("question").notNull(),
    "nps_classification": text("nps_classification").notNull(),
    "comment": text("comment").notNull(),
    "responded_at": text("responded_at").notNull(),
    "survey_id": bigint("survey_id").notNull(),
  },
);

const table_survey_npssurvey = sqliteTable(
  "survey_npssurvey",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "id_slug": text("id_slug").notNull(),
    "created_at": text("created_at").notNull(),
    "updated_at": text("updated_at").notNull(),
    "name": text("name").notNull(),
    "question": text("question").notNull(),
    "periodicity": text("periodicity").notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "is_mandatory": integer("is_mandatory", { mode: "boolean" }).notNull(),
  },
);

const table_user_mfaauthenticationlog = sqliteTable(
  "user_mfaauthenticationlog",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "auth_method": text("auth_method").notNull(),
    "result": text("result").notNull(),
    "ip_address": text("ip_address").notNull(),
    "user_agent": text("user_agent").notNull(),
    "created_at": text("created_at").notNull(),
    "user_id": integer("user_id").notNull(),
  },
);

const table_user_role = sqliteTable(
  "user_role",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "name": text("name").notNull(),
    "read_sections": text("read_sections").notNull(),
    "write_sections": text("write_sections").notNull(),
    "export_sections": text("export_sections").notNull(),
    "is_default": integer("is_default", { mode: "boolean" }).notNull(),
  },
);

const table_user_trusteddevice = sqliteTable(
  "user_trusteddevice",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "device_hash": text("device_hash").notNull(),
    "ip_address": text("ip_address").notNull(),
    "user_agent": text("user_agent").notNull(),
    "created_at": text("created_at").notNull(),
    "last_used_at": text("last_used_at").notNull(),
    "user_id": integer("user_id").notNull(),
    "expires_at": text("expires_at").notNull(),
  },
);

const table_user_user = sqliteTable(
  "user_user",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "password": text("password").notNull(),
    "last_login": text("last_login"),
    "is_superuser": integer("is_superuser", { mode: "boolean" }).notNull(),
    "email": text("email").notNull(),
    "first_name": text("first_name").notNull(),
    "last_name": text("last_name").notNull(),
    "is_staff": integer("is_staff", { mode: "boolean" }).notNull(),
    "is_active": integer("is_active", { mode: "boolean" }).notNull(),
    "created_at": text("created_at").notNull(),
    "utm_source": text("utm_source").notNull(),
    "utm_medium": text("utm_medium").notNull(),
    "utm_campaign": text("utm_campaign").notNull(),
    "agency_id": bigint("agency_id"),
    "avatar": text("avatar"),
    "seller_id": bigint("seller_id"),
    "export_sections": text("export_sections").notNull(),
    "read_sections": text("read_sections").notNull(),
    "write_sections": text("write_sections").notNull(),
    "role_id": integer("role_id"),
    "manage_requests": integer("manage_requests", { mode: "boolean" }).notNull(),
    "mfa_enabled": integer("mfa_enabled", { mode: "boolean" }).notNull(),
    "document_number": text("document_number").notNull(),
    "document_type": text("document_type").notNull(),
    "mobile_number": text("mobile_number").notNull(),
    "email_signature": text("email_signature").notNull(),
    "origin": text("origin").notNull(),
  },
);

const table_user_user_groups = sqliteTable(
  "user_user_groups",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "user_id": integer("user_id").notNull(),
    "group_id": integer("group_id").notNull(),
  },
);

const table_user_user_user_permissions = sqliteTable(
  "user_user_user_permissions",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "user_id": integer("user_id").notNull(),
    "permission_id": integer("permission_id").notNull(),
  },
);

const table_user_usercomplementarydata = sqliteTable(
  "user_usercomplementarydata",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "rut": text("rut").notNull(),
    "gender": text("gender").notNull(),
    "branch_id": integer("branch_id").notNull(),
    "user_id": integer("user_id").notNull(),
    "id_number": text("id_number").notNull(),
    "position": text("position").notNull(),
  },
);

export const internalTables = {
  "account_emailaddress": table_account_emailaddress,
  "account_emailconfirmation": table_account_emailconfirmation,
  "api_customerfile": table_api_customerfile,
  "api_key": table_api_key,
  "api_paymentfile": table_api_paymentfile,
  "api_policyfile": table_api_policyfile,
  "api_propertiesfile": table_api_propertiesfile,
  "api_proposalscarsfile": table_api_proposalscarsfile,
  "api_sarlaftfile": table_api_sarlaftfile,
  "app_bank": table_app_bank,
  "app_changelog": table_app_changelog,
  "app_documenttag": table_app_documenttag,
  "app_economicactivity": table_app_economicactivity,
  "app_importdata": table_app_importdata,
  "app_reporthistory": table_app_reporthistory,
  "auth_group": table_auth_group,
  "auth_group_permissions": table_auth_group_permissions,
  "auth_permission": table_auth_permission,
  "axes_accessattempt": table_axes_accessattempt,
  "axes_accessattemptexpiration": table_axes_accessattemptexpiration,
  "axes_accessfailurelog": table_axes_accessfailurelog,
  "axes_accesslog": table_axes_accesslog,
  "business_agency_renewal_task_managers": table_business_agency_renewal_task_managers,
  "business_agencycomplementarydata": table_business_agencycomplementarydata,
  "business_agencycompliancemailbox": table_business_agencycompliancemailbox,
  "business_agencycompliancemailbox_reply_authorized_users": table_business_agencycompliancemailbox_reply_authorized_users,
  "business_allianzconnectionkey": table_business_allianzconnectionkey,
  "business_axaconnectionkey": table_business_axaconnectionkey,
  "business_bolivarconnectionkey": table_business_bolivarconnectionkey,
  "business_chubbconnectionkey": table_business_chubbconnectionkey,
  "business_commercialunit": table_business_commercialunit,
  "business_defaultcommission": table_business_defaultcommission,
  "business_equidadconnectionkey": table_business_equidadconnectionkey,
  "business_hdiconnectionkey": table_business_hdiconnectionkey,
  "business_mapfreconnectionkey": table_business_mapfreconnectionkey,
  "business_previsoraconnectionkey": table_business_previsoraconnectionkey,
  "business_qualitasconnectionkey": table_business_qualitasconnectionkey,
  "business_ramorenewalconfiguration": table_business_ramorenewalconfiguration,
  "business_renewalconfiguration": table_business_renewalconfiguration,
  "business_sbsconnectionkey": table_business_sbsconnectionkey,
  "business_seller": table_business_seller,
  "business_sellercommission": table_business_sellercommission,
  "business_sellerdocument": table_business_sellerdocument,
  "business_sellerdocument_tags": table_business_sellerdocument_tags,
  "business_sellerlog": table_business_sellerlog,
  "business_solidariaconnectionkey": table_business_solidariaconnectionkey,
  "business_suraconnectionkey": table_business_suraconnectionkey,
  "business_zurichconnectionkey": table_business_zurichconnectionkey,
  "claim_claim": table_claim_claim,
  "claim_claimdocument": table_claim_claimdocument,
  "claim_claimdocument_tags": table_claim_claimdocument_tags,
  "claim_claimlog": table_claim_claimlog,
  "claim_claimstatus": table_claim_claimstatus,
  "claim_claimsubstatus": table_claim_claimsubstatus,
  "claim_claimtype": table_claim_claimtype,
  "claim_coverage": table_claim_coverage,
  "compliance_compliancecancellationreason": table_compliance_compliancecancellationreason,
  "compliance_compliancelog": table_compliance_compliancelog,
  "compliance_complianceprogramtype": table_compliance_complianceprogramtype,
  "compliance_compliancerequest": table_compliance_compliancerequest,
  "compliance_compliancerequest_tags": table_compliance_compliancerequest_tags,
  "compliance_compliancetag": table_compliance_compliancetag,
  "compliance_documentspecification": table_compliance_documentspecification,
  "compliance_processstepemailtemplate": table_compliance_processstepemailtemplate,
  "compliance_requestdocument": table_compliance_requestdocument,
  "compliance_requestdocument_tags": table_compliance_requestdocument_tags,
  "constance_constance": table_constance_constance,
  "customer_address": table_customer_address,
  "customer_client": table_customer_client,
  "customer_clientagency": table_customer_clientagency,
  "customer_clientlog": table_customer_clientlog,
  "customer_consortium": table_customer_consortium,
  "customer_customersellershare": table_customer_customersellershare,
  "customer_document": table_customer_document,
  "customer_document_tags": table_customer_document_tags,
  "customer_group": table_customer_group,
  "customer_legalperson": table_customer_legalperson,
  "customer_legalpersoncontact": table_customer_legalpersoncontact,
  "customer_naturalperson": table_customer_naturalperson,
  "customer_prospect": table_customer_prospect,
  "customer_prospectdocument": table_customer_prospectdocument,
  "customer_prospectdocument_tags": table_customer_prospectdocument_tags,
  "customer_prospectlog": table_customer_prospectlog,
  "django_admin_log": table_django_admin_log,
  "django_content_type": table_django_content_type,
  "django_migrations": table_django_migrations,
  "django_session": table_django_session,
  "django_site": table_django_site,
  "financial_statements_accountnormalization": table_financial_statements_accountnormalization,
  "financial_statements_accountnormalizationfile": table_financial_statements_accountnormalizationfile,
  "financial_statements_agencyauthentication": table_financial_statements_agencyauthentication,
  "financial_statements_financialreportfile": table_financial_statements_financialreportfile,
  "financial_statements_financialreportrequest": table_financial_statements_financialreportrequest,
  "financial_statements_financialreportrequest_agencies": table_financial_statements_financialreportrequest_agencies,
  "financial_statements_financialstatement": table_financial_statements_financialstatement,
  "help_newsletter": table_help_newsletter,
  "help_newsletterusersurvey": table_help_newsletterusersurvey,
  "help_request": table_help_request,
  "help_requestcategory": table_help_requestcategory,
  "help_requestdocument": table_help_requestdocument,
  "help_requestlog": table_help_requestlog,
  "help_trainingcategory": table_help_trainingcategory,
  "help_trainingvideo": table_help_trainingvideo,
  "insurance_agencyshare": table_insurance_agencyshare,
  "insurance_beneficiary": table_insurance_beneficiary,
  "insurance_endorsement": table_insurance_endorsement,
  "insurance_endorsementdocument": table_insurance_endorsementdocument,
  "insurance_endorsementdocument_tags": table_insurance_endorsementdocument_tags,
  "insurance_insured": table_insurance_insured,
  "insurance_insurershare": table_insurance_insurershare,
  "insurance_paymenttaskreminder": table_insurance_paymenttaskreminder,
  "insurance_policy": table_insurance_policy,
  "insurance_policydocument": table_insurance_policydocument,
  "insurance_policydocument_tags": table_insurance_policydocument_tags,
  "insurance_policylog": table_insurance_policylog,
  "insurance_reinvestment": table_insurance_reinvestment,
  "insurance_reinvestmentactivity": table_insurance_reinvestmentactivity,
  "insurance_reinvestmentterm": table_insurance_reinvestmentterm,
  "insurance_sellershare": table_insurance_sellershare,
  "insurance_term": table_insurance_term,
  "mfa_authenticator": table_mfa_authenticator,
  "notification_attachment": table_notification_attachment,
  "notification_configuration": table_notification_configuration,
  "notification_customemailtemplatetype": table_notification_customemailtemplatetype,
  "notification_emailtemplate": table_notification_emailtemplate,
  "notification_emailtemplate_ramos": table_notification_emailtemplate_ramos,
  "notification_emailtemplateimage": table_notification_emailtemplateimage,
  "notification_externalnotification": table_notification_externalnotification,
  "notification_graphsubscription": table_notification_graphsubscription,
  "notification_internalnotification": table_notification_internalnotification,
  "notification_microsoftgraphevent": table_notification_microsoftgraphevent,
  "notification_microsoftgraphnotification": table_notification_microsoftgraphnotification,
  "notification_ramoconfiguration": table_notification_ramoconfiguration,
  "operation_collectionfile": table_operation_collectionfile,
  "operation_payment": table_operation_payment,
  "operation_paymentamount": table_operation_paymentamount,
  "operation_paymentcollectionfollowup": table_operation_paymentcollectionfollowup,
  "operation_paymentlog": table_operation_paymentlog,
  "operation_paymentresponsible": table_operation_paymentresponsible,
  "operation_portfolioreconciliationfile": table_operation_portfolioreconciliationfile,
  "operation_reconciliationfile": table_operation_reconciliationfile,
  "operation_reimbursement": table_operation_reimbursement,
  "operation_reimbursementreport": table_operation_reimbursementreport,
  "operation_reimbursementreport_reimbursements": table_operation_reimbursementreport_reimbursements,
  "operation_settlement": table_operation_settlement,
  "operation_settlementdocument": table_operation_settlementdocument,
  "operation_settlementdocument_tags": table_operation_settlementdocument_tags,
  "operation_settlementlog": table_operation_settlementlog,
  "operation_task": table_operation_task,
  "operation_task_tags": table_operation_task_tags,
  "operation_taskassignmentrule": table_operation_taskassignmentrule,
  "operation_taskassignmentrule_insurers": table_operation_taskassignmentrule_insurers,
  "operation_taskassignmentrule_ramos": table_operation_taskassignmentrule_ramos,
  "operation_taskassignmentrule_sellers": table_operation_taskassignmentrule_sellers,
  "operation_taskdocument": table_operation_taskdocument,
  "operation_taskdocument_tags": table_operation_taskdocument_tags,
  "operation_tasklog": table_operation_tasklog,
  "operation_tasktag": table_operation_tasktag,
  "operation_tasktype": table_operation_tasktype,
  "production_data_importproductiondatafile": table_production_data_importproductiondatafile,
  "production_data_normalizationfile": table_production_data_normalizationfile,
  "production_data_productiondata": table_production_data_productiondata,
  "production_data_standardizeinsurer": table_production_data_standardizeinsurer,
  "production_data_standardizeramo": table_production_data_standardizeramo,
  "redactor_redactorfile": table_redactor_redactorfile,
  "renewal_documentspecification": table_renewal_documentspecification,
  "renewal_documentspecification_ramo": table_renewal_documentspecification_ramo,
  "renewal_initialstep": table_renewal_initialstep,
  "renewal_initialstepconfig": table_renewal_initialstepconfig,
  "renewal_nonrenewalreason": table_renewal_nonrenewalreason,
  "renewal_renewal": table_renewal_renewal,
  "renewal_renewaldocument": table_renewal_renewaldocument,
  "renewal_renewaldocument_tags": table_renewal_renewaldocument_tags,
  "renewal_renewallog": table_renewal_renewallog,
  "sales_contractlead": table_sales_contractlead,
  "sales_contractleadsimportfile": table_sales_contractleadsimportfile,
  "sales_entity": table_sales_entity,
  "sales_entitycity": table_sales_entitycity,
  "sales_holder": table_sales_holder,
  "sales_operator": table_sales_operator,
  "sales_plan": table_sales_plan,
  "sales_product": table_sales_product,
  "sales_provider": table_sales_provider,
  "sales_sale": table_sales_sale,
  "sales_saleaudio": table_sales_saleaudio,
  "sales_saletranscription": table_sales_saletranscription,
  "socialaccount_socialaccount": table_socialaccount_socialaccount,
  "socialaccount_socialapp": table_socialaccount_socialapp,
  "socialaccount_socialapp_sites": table_socialaccount_socialapp_sites,
  "socialaccount_socialtoken": table_socialaccount_socialtoken,
  "survey_npsresponse": table_survey_npsresponse,
  "survey_npssurvey": table_survey_npssurvey,
  "user_mfaauthenticationlog": table_user_mfaauthenticationlog,
  "user_role": table_user_role,
  "user_trusteddevice": table_user_trusteddevice,
  "user_user": table_user_user,
  "user_user_groups": table_user_user_groups,
  "user_user_user_permissions": table_user_user_user_permissions,
  "user_usercomplementarydata": table_user_usercomplementarydata,
} as const;
