// Generated from the restored legacy PostgreSQL schema. Do not edit by hand.
// Tables dropped by 0069_drop_unused_legacy_tables.sql were removed here (109 tables, 2026-09-24).
// @internal Raw relational tables for domain repositories; never expose through OpenAPI.
import { customType, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const bigint = customType<{ data: number; driverData: number }>({
  dataType: () => "BIGINT",
});

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

const table_app_economicactivity = sqliteTable(
  "app_economicactivity",
  {
    "id": integer("id").primaryKey({ autoIncrement: true }).notNull(),
    "code": text("code").notNull(),
    "name": text("name").notNull(),
  },
);

export const internalTables = {
  "app_economicactivity": table_app_economicactivity,
  "business_commercialunit": table_business_commercialunit,
  "customer_address": table_customer_address,
  "customer_client": table_customer_client,
  "customer_clientagency": table_customer_clientagency,
  "customer_group": table_customer_group,
  "customer_legalperson": table_customer_legalperson,
  "customer_legalpersoncontact": table_customer_legalpersoncontact,
  "customer_naturalperson": table_customer_naturalperson,
} as const;
