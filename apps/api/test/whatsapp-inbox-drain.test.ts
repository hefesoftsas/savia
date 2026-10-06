import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
import { upsertPrincipal } from "../src/auth/identity-repository";
import { drainWhatsappInbox } from "../src/whatsapp/inbound-processor";
import { WhatsappInboundRepository } from "../src/whatsapp/inbound-repository";

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

let fixtureSequence = 0;

async function setupDrainFixture() {
  const tenantId = 1_700_000_000 + fixtureSequence++;
  const now = new Date().toISOString();
  const phoneNumberId = String(900_000_000_000_000 + tenantId);
  const wabaId = String(800_000_000_000_000 + tenantId);
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,kind,created_at,updated_at) VALUES(?,?,?,1,'commercial',?,?)",
  )
    .bind(tenantId, `wa-drain-${tenantId}`, "WhatsApp drain test", now, now)
    .run();
  const principal = await upsertPrincipal(env.DB, {
    issuer: "whatsapp-drain-test",
    subject: String(tenantId),
    email: `${tenantId}@wa-drain.test`,
    displayName: "Drain owner",
  });
  await env.DB.prepare(
    `INSERT INTO identity_tenant_membership
     (id,principal_id,tenant_id,role,is_active,created_at,updated_at)
     VALUES(?,?,?,'tenant_admin',1,?,?)`,
  )
    .bind(`membership-drain-${tenantId}`, principal.id, tenantId, now, now)
    .run();
  const connectionId = `wa-drain-${tenantId}`;
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
      `nango-drain-${tenantId}`,
      phoneNumberId,
      wabaId,
      now,
      now,
    )
    .run();
  const employeeId = `drain-employee-${tenantId}`;
  await env.DB.prepare(
    `INSERT INTO assistant_virtual_employees
     (id,agency_id,name,handle,system_prompt,allowed_collections,status,created_at,updated_at,created_by)
     VALUES(?,?,'Drain employee','drain','Answer safely','[]','active',?,?,?)`,
  )
    .bind(employeeId, tenantId, now, now, principal.id)
    .run();
  const repository = new WhatsappInboundRepository(env.DB);
  const settings = {
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

async function queueMessages(count: number) {
  const fixture = await setupDrainFixture();
  const ids: string[] = [];
  const originalCandidates = fixture.repository.candidates.bind(
    fixture.repository,
  );
  for (let i = 0; i < count; i++) {
    const messageId = `drain-${fixture.tenantId}-${i}`;
    ids.push(messageId);
    await fixture.repository.receive({
      phoneNumberId: fixture.phoneNumberId,
      wabaId: fixture.wabaId,
      messageId,
      contactPhone: "+57 300 123 4567",
      text: `Message ${i}`,
      timestamp: new Date().toISOString(),
    });
  }
  vi.spyOn(fixture.repository, "candidates").mockImplementation(
    async (limit, now) =>
      (await originalCandidates(10_000, now))
        .filter((id) => ids.includes(id))
        .slice(0, limit),
  );
  return { ...fixture, ids };
}

function dependencies() {
  return {
    generate: vi.fn(
      async (_binding: unknown, _history: unknown, text: string) =>
        `Reply to ${text}`,
    ),
    send: vi.fn(async () => `wamid-drain-reply-${crypto.randomUUID()}`),
  };
}

it("drains more than ten queued messages across small batches in one call", async () => {
  const fixture = await queueMessages(12);
  const deps = dependencies();

  const result = await drainWhatsappInbox(fixture.repository, deps, {
    batchSize: 2,
    maxBatches: 100,
  });

  expect(result).toEqual({ processed: 12, failed: 0 });
  expect(deps.generate).toHaveBeenCalledTimes(12);
  expect(deps.send).toHaveBeenCalledTimes(12);
});

it("stops after the configured maximum number of batches", async () => {
  const fixture = await queueMessages(5);
  const deps = dependencies();

  const result = await drainWhatsappInbox(fixture.repository, deps, {
    batchSize: 2,
    maxBatches: 2,
  });
  expect(result).toEqual({ processed: 2, failed: 0 });
  expect(deps.generate).toHaveBeenCalledTimes(2);
  const queued = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM whatsapp_inbox WHERE connection_id=? AND state='pending'",
  )
    .bind(fixture.connectionId)
    .first<{ count: number }>();
  expect(queued?.count).toBe(3);
});

it("stops before starting another batch when the wall budget expires", async () => {
  const fixture = await queueMessages(5);
  const deps = dependencies();
  let time = 0;
  deps.generate.mockImplementation(async (_binding, _history, text) => {
    time = 1000;
    return `Reply to ${text}`;
  });

  const result = await drainWhatsappInbox(fixture.repository, deps, {
    batchSize: 2,
    maxBatches: 100,
    wallBudgetMs: 1000,
    now: () => time,
  });

  expect(result).toEqual({ processed: 1, failed: 0 });
  expect(deps.generate).toHaveBeenCalledTimes(1);
});

it("stops after one empty candidate scan", async () => {
  const fixture = await queueMessages(0);
  const candidates = vi.spyOn(fixture.repository, "candidates");
  candidates.mockResolvedValue([]);

  expect(
    await drainWhatsappInbox(fixture.repository, dependencies(), {
      batchSize: 2,
    }),
  ).toEqual({ processed: 0, failed: 0 });
  expect(candidates).toHaveBeenCalledTimes(1);
});

it("skips queued messages behind an active contact while draining other contacts", async () => {
  const fixture = await setupDrainFixture();
  await fixture.repository.configure({
    ...fixture.settings,
    allowedContacts: ["+57 300 123 4567", "+57 300 123 4568"],
  });
  const receivedAt = new Date().toISOString();
  const rows = [
    {
      id: `blocked-active-${fixture.tenantId}`,
      contact: "+57 300 123 4567",
      text: "A active",
    },
    {
      id: `blocked-next-${fixture.tenantId}`,
      contact: "+57 300 123 4567",
      text: "A waiting",
    },
    {
      id: `other-contact-${fixture.tenantId}`,
      contact: "+57 300 123 4568",
      text: "B available",
    },
  ];
  for (const row of rows)
    await fixture.repository.receive({
      phoneNumberId: fixture.phoneNumberId,
      wabaId: fixture.wabaId,
      messageId: row.id,
      contactPhone: row.contact,
      text: row.text,
      timestamp: receivedAt,
    });
  const candidateIds = new Set(rows.map((row) => row.id));
  const originalCandidates = fixture.repository.candidates.bind(
    fixture.repository,
  );
  vi.spyOn(fixture.repository, "candidates").mockImplementation(
    async (limit, now) =>
      (await originalCandidates(10_000, now))
        .filter((id) => candidateIds.has(id))
        .slice(0, limit),
  );
  const token = crypto.randomUUID();
  expect(
    await fixture.repository.claim(rows[0].id, token, new Date().toISOString()),
  ).toBeTruthy();
  const deps = dependencies();

  const result = await drainWhatsappInbox(fixture.repository, deps, {
    batchSize: 2,
    maxBatches: 1,
  });

  expect(result).toEqual({ processed: 1, failed: 0 });
  expect(deps.generate).toHaveBeenCalledTimes(1);
  expect(deps.generate.mock.calls[0]?.[2]).toBe("B available");
  const active = await env.DB.prepare(
    "SELECT state FROM whatsapp_inbox WHERE message_id=?",
  )
    .bind(rows[0].id)
    .first<{ state: string }>();
  expect(active?.state).toBe("generating");
});
