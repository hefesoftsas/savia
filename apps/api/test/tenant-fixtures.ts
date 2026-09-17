import { agencies } from "@savia/db/schema";
import { drizzle } from "drizzle-orm/d1";

function tenantAgencyInsert(id: number, timestamp: string) {
  return {
    id,
    idSlug: `agency-${id}`,
    name: `Agency ${id}`,
    shortName: `agency-${id}`,
    address: "Calle 1",
    idCheckDigit: "1",
    idNumber: String(id),
    lrIdNumber: "123",
    lrIdType: "CC",
    lrName: "Representante",
    surnames: "Test",
    paymentsEmail: "pay@example.test",
    isActive: true,
    email: "agency@example.test",
    isInHouse: false,
    emailDomain: "example.test",
    birthdayFromEmail: "birthday@example.test",
    paymentFromEmail: "pay@example.test",
    renewalFromEmail: "renew@example.test",
    homeUrl: "https://example.test",
    sellerRequired: false,
    hasCompliance: false,
    type: "agency",
    theme: "emerald",
    phone: null,
    logo: null,
    cityId: null,
    coordinates: null,
    defaultCcEmails: null,
    retirementDate: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function seedTenantAgency(db: D1Database, id: number) {
  await drizzle(db)
    .insert(agencies)
    .values(tenantAgencyInsert(id, "2026-09-09T00:00:00.000Z"));
}
