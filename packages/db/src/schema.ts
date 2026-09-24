import {
  customType,
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

import { tenants } from "./core-schema";
export * from "./core-schema";

// Only live typed projection. Legacy projections were removed 2026-09-24
// (runtime uses raw SQL via dialectFor); see the legacy-tables-cleanup epic.
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
