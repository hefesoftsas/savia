import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";
import { upsertPrincipal } from "../src/auth/identity-repository";
import { WhatsappInboundRepository } from "../src/whatsapp/inbound-repository";
import { processWhatsappInbox } from "../src/whatsapp/inbound-processor";
import type { WhatsappAssistantSettings } from "../src/whatsapp/inbound-contracts";

const migrationFiles = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));

beforeAll(async () => {
  for (const [, sql] of migrationFiles)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((part) =>
        part
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});

let tenantSequence = 985000;

export async function setupChannelFixture() {
  const tenantId = ++tenantSequence;
  const now = new Date().toISOString();
  const phoneNumberId = String(123456789012345 + tenantId);
  const wabaId = String(1234567890 + tenantId);
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,kind,created_at,updated_at) VALUES(?,?,?,1,'commercial',?,?)",
  )
    .bind(tenantId, `wa-inbound-${tenantId}`, "WhatsApp inbound test", now, now)
    .run();
  const principal = await upsertPrincipal(env.DB, {
    issuer: "whatsapp-inbound-test",
    subject: String(tenantId),
    email: `${tenantId}@wa-inbound.test`,
    displayName: "Inbound owner",
  });
  await env.DB.prepare(
    `INSERT INTO identity_tenant_membership
     (id,principal_id,tenant_id,role,is_active,created_at,updated_at)
     VALUES(?,?,?,'tenant_admin',1,?,?)`,
  )
    .bind(`membership-${tenantId}`, principal.id, tenantId, now, now)
    .run();
  const connectionId = `wa-connection-${tenantId}`;
  await env.DB.prepare(
    `INSERT INTO tenant_whatsapp_connections
     (id,tenant_id,created_by_principal_id,nango_connection_id,nango_integration_id,status,
      phone_number_id,display_phone_number,waba_id,created_at,updated_at)
     VALUES(?,?,?,?,'whatsapp-business','connected',?,NULL,?,?,?)`,
  )
    .bind(
      connectionId,
      tenantId,
      principal.id,
      `nango-${tenantId}`,
      phoneNumberId,
      wabaId,
      now,
      now,
    )
    .run();
  const employeeId = `employee-${tenantId}`;
  await env.DB.prepare(
    `INSERT INTO assistant_virtual_employees
     (id,agency_id,name,handle,system_prompt,allowed_collections,status,created_at,updated_at,created_by)
     VALUES(?,?,'Test employee','test','Answer safely','[]','active',?,?,?)`,
  )
    .bind(employeeId, tenantId, now, now, principal.id)
    .run();

  const repository = new WhatsappInboundRepository(env.DB);
  const settings: WhatsappAssistantSettings = {
    connectionId,
    tenantId,
    employeeId,
    enabled: true,
    allowedContacts: ["+57 300-123-4567"],
    updatedBy: principal.id,
  };
  await repository.configure(settings);
  return {
    tenantId,
    connectionId,
    employeeId,
    phoneNumberId,
    wabaId,
    principal,
    repository,
    settings,
  };
}
