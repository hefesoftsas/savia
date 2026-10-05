import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { upsertPrincipal } from "../src/auth/identity-repository";
import { WhatsappInboundRepository } from "../src/whatsapp/inbound-repository";
import { processWhatsappInbox } from "../src/whatsapp/inbound-processor";
import type {
  WhatsappAssistantSettings,
  WhatsappInboundDependencies,
} from "../src/whatsapp/inbound-contracts";

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

let tenantSequence = 880000;

async function setup() {
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

const inbound = (
  s: Awaited<ReturnType<typeof setup>>,
  messageId = `wamid-${s.tenantId}`,
  timestamp = new Date().toISOString(),
) => ({
  phoneNumberId: s.phoneNumberId,
  wabaId: s.wabaId,
  messageId,
  contactPhone: "+57 300 123 4567",
  text: "¿Cuál es mi cobertura?",
  timestamp,
});

describe("WhatsApp inbound persistence and processing", () => {
  it("normalizes the allowlist and deduplicates accepted message ids", async () => {
    const s = await setup();

    expect(await s.repository.getSettings(s.tenantId)).toEqual({
      ...s.settings,
      allowedContacts: ["573001234567"],
    });
    expect(await s.repository.resolve(s.phoneNumberId, s.wabaId)).toMatchObject(
      {
        tenantId: s.tenantId,
        employeeId: s.employeeId,
        ownerPrincipalId: s.principal.id,
      },
    );
    expect(await s.repository.receive(inbound(s))).toBe(true);
    expect(await s.repository.receive(inbound(s))).toBe(false);
    expect(
      await s.repository.receive(
        inbound(
          s,
          `wamid-unix-${s.tenantId}`,
          String(Math.floor(Date.now() / 1000)),
        ),
      ),
    ).toBe(true);
    expect(
      await s.repository.receive(
        inbound(
          s,
          `wamid-stale-${s.tenantId}`,
          new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        ),
      ),
    ).toBe(false);
    expect(
      await s.repository.receive(
        inbound(
          s,
          `wamid-future-${s.tenantId}`,
          new Date(Date.now() + 6 * 60 * 1000).toISOString(),
        ),
      ),
    ).toBe(false);
    await env.DB.prepare("DELETE FROM whatsapp_inbox WHERE message_id=?")
      .bind(`wamid-${s.tenantId}`)
      .run();
    await env.DB.prepare("DELETE FROM whatsapp_inbox WHERE message_id=?")
      .bind(`wamid-unix-${s.tenantId}`)
      .run();
  });

  it("rejects disallowed contacts and ambiguous shared senders", async () => {
    const s = await setup();
    expect(
      await s.repository.receive({
        ...inbound(s),
        messageId: `disallowed-${s.tenantId}`,
        contactPhone: "+57 301 999 0000",
      }),
    ).toBe(false);

    const second = await setup();
    await env.DB.prepare(
      "UPDATE tenant_whatsapp_connections SET phone_number_id=?,waba_id=? WHERE id=?",
    )
      .bind(s.phoneNumberId, s.wabaId, second.connectionId)
      .run();

    expect(
      await s.repository.resolve(s.phoneNumberId, s.wabaId),
    ).toBeUndefined();
    expect(await s.repository.receive(inbound(s))).toBe(false);
  });

  it("persists the reply before sending and completes one outbound message", async () => {
    const s = await setup();
    await s.repository.receive(inbound(s));
    const generated = vi.fn(
      async () => "Your plan includes roadside assistance.",
    );
    const sent = vi.fn(async () => "wamid-outbound-1");
    const dependencies: WhatsappInboundDependencies = {
      generate: generated,
      send: async (binding, text, contact) => {
        const row = await env.DB.prepare(
          "SELECT state,reply_text FROM whatsapp_inbox WHERE message_id=?",
        )
          .bind(`wamid-${s.tenantId}`)
          .first<{ state: string; reply_text: string | null }>();
        expect(row).toEqual({
          state: "responding",
          reply_text: "Your plan includes roadside assistance.",
        });
        expect(binding.tenantId).toBe(s.tenantId);
        expect(text).toBe("Your plan includes roadside assistance.");
        expect(contact).toBe("+57 300 123 4567");
        await s.repository.receipt({
          phoneNumberId: s.phoneNumberId,
          wabaId: s.wabaId,
          messageId: "wamid-outbound-1",
          status: "delivered",
        });
        return sent();
      },
    };

    const result = await processWhatsappInbox(s.repository, dependencies);
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(generated).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare(
        "SELECT state,outbound_message_id,delivery_status,delivery_rank FROM whatsapp_inbox WHERE message_id=?",
      )
        .bind(`wamid-${s.tenantId}`)
        .first(),
    ).toEqual({
      state: "completed",
      outbound_message_id: "wamid-outbound-1",
      delivery_status: "delivered",
      delivery_rank: 2,
    });
    await s.repository.receipt({
      phoneNumberId: s.phoneNumberId,
      wabaId: s.wabaId,
      messageId: "wamid-outbound-1",
      status: "read",
    });
    await s.repository.receipt({
      phoneNumberId: s.phoneNumberId,
      wabaId: s.wabaId,
      messageId: "wamid-outbound-1",
      status: "failed",
      errorCode: "131042",
    });
    expect(
      await env.DB.prepare(
        "SELECT delivery_status,delivery_rank,delivery_error_codes FROM whatsapp_inbox WHERE message_id=?",
      )
        .bind(`wamid-${s.tenantId}`)
        .first(),
    ).toEqual({
      delivery_status: "read",
      delivery_rank: 3,
      delivery_error_codes: '["131042"]',
    });
  });

  it("does not resend when the provider send result is uncertain", async () => {
    const s = await setup();
    await s.repository.receive(inbound(s));
    const send = vi.fn(async () => {
      throw new Error("request timeout after dispatch");
    });
    const dependencies: WhatsappInboundDependencies = {
      generate: async () => "A reply",
      send,
    };

    expect(await processWhatsappInbox(s.repository, dependencies)).toEqual({
      processed: 0,
      failed: 1,
    });
    expect(await processWhatsappInbox(s.repository, dependencies)).toEqual({
      processed: 0,
      failed: 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare(
        "SELECT state,failure_code FROM whatsapp_inbox WHERE message_id=?",
      )
        .bind(`wamid-${s.tenantId}`)
        .first(),
    ).toEqual({ state: "failed", failure_code: "outbound_send_uncertain" });
  });

  it("serializes equal-time same-contact messages even when message ids sort backwards", async () => {
    const s = await setup();
    const receivedAt = new Date().toISOString();
    await s.repository.receive(inbound(s, "z-first-claimed", receivedAt));
    let releaseGeneration!: () => void;
    let markGenerationStarted!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      markGenerationStarted = resolve;
    });
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const generate = vi.fn(async () => {
      markGenerationStarted();
      await generationGate;
      return "First reply";
    });
    const dependencies: WhatsappInboundDependencies = {
      generate,
      send: async () => `out-${s.tenantId}`,
    };

    const firstRun = processWhatsappInbox(s.repository, dependencies);
    await generationStarted;
    await s.repository.receive(
      inbound(s, "a-arrives-during-generation", receivedAt),
    );
    expect(await processWhatsappInbox(s.repository, dependencies)).toEqual({
      processed: 0,
      failed: 0,
    });
    releaseGeneration();

    expect(await firstRun).toEqual({ processed: 1, failed: 0 });
    expect(generate).toHaveBeenCalledTimes(1);
    await env.DB.prepare("DELETE FROM whatsapp_inbox WHERE message_id=?")
      .bind("a-arrives-during-generation")
      .run();
  });

  it("fences a generation that resumes after another worker takes its expired lease", async () => {
    const s = await setup();
    await s.repository.receive(inbound(s));
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstSend = vi.fn(async () => "stale-outbound");
    const firstRun = processWhatsappInbox(s.repository, {
      generate: async () => {
        markFirstStarted();
        await firstGate;
        return "Stale reply";
      },
      send: firstSend,
    });
    await firstStarted;
    await env.DB.prepare(
      "UPDATE whatsapp_inbox SET lease_until=? WHERE message_id=?",
    )
      .bind(new Date(Date.now() - 1000).toISOString(), `wamid-${s.tenantId}`)
      .run();
    const currentSend = vi.fn(async () => `current-outbound-${s.tenantId}`);
    expect(
      await processWhatsappInbox(s.repository, {
        generate: async () => "Current reply",
        send: currentSend,
      }),
    ).toEqual({ processed: 1, failed: 0 });
    releaseFirst();

    expect(await firstRun).toEqual({ processed: 0, failed: 0 });
    expect(firstSend).not.toHaveBeenCalled();
    expect(currentSend).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare(
        "SELECT reply_text,outbound_message_id FROM whatsapp_inbox WHERE message_id=?",
      )
        .bind(`wamid-${s.tenantId}`)
        .first(),
    ).toEqual({
      reply_text: "Current reply",
      outbound_message_id: `current-outbound-${s.tenantId}`,
    });
  });

  it("stops before sending when the assigned employee is revoked during generation", async () => {
    const s = await setup();
    await s.repository.receive(inbound(s));
    const send = vi.fn(async () => "must-not-send");

    expect(
      await processWhatsappInbox(s.repository, {
        generate: async () => {
          await env.DB.prepare(
            "UPDATE assistant_virtual_employees SET status='inactive' WHERE id=?",
          )
            .bind(s.employeeId)
            .run();
          return "A reply generated before revocation";
        },
        send,
      }),
    ).toEqual({ processed: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("lets an authorized administrator disable a stale binding", async () => {
    const s = await setup();
    const platformAdmin = await upsertPrincipal(env.DB, {
      issuer: "whatsapp-inbound-test",
      subject: `platform-${s.tenantId}`,
      email: `platform-${s.tenantId}@wa-inbound.test`,
      displayName: "Platform admin",
    });
    await env.DB.prepare(
      "INSERT INTO identity_global_role(principal_id,role,created_at) VALUES(?,'platform_admin',?)",
    )
      .bind(platformAdmin.id, new Date().toISOString())
      .run();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=?",
      ).bind(s.principal.id),
      env.DB.prepare(
        "UPDATE assistant_virtual_employees SET status='inactive' WHERE id=?",
      ).bind(s.employeeId),
      env.DB.prepare(
        "UPDATE tenant_whatsapp_connections SET status='disconnected',disconnected_at=? WHERE id=?",
      ).bind(new Date().toISOString(), s.connectionId),
    ]);

    await s.repository.configure({
      ...s.settings,
      enabled: false,
      allowedContacts: [],
      updatedBy: platformAdmin.id,
    });

    expect(await s.repository.getSettings(s.tenantId)).toMatchObject({
      enabled: false,
      allowedContacts: [],
      updatedBy: platformAdmin.id,
    });
    expect(
      await s.repository.resolve(s.phoneNumberId, s.wabaId),
    ).toBeUndefined();
  });

  it("does not generate or send a message that expires while queued", async () => {
    const s = await setup();
    await s.repository.receive(inbound(s));
    await env.DB.prepare(
      "UPDATE whatsapp_inbox SET provider_timestamp=? WHERE message_id=?",
    )
      .bind(
        new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        `wamid-${s.tenantId}`,
      )
      .run();
    const generate = vi.fn(async () => "Should not generate");
    const send = vi.fn(async () => "Should not send");

    expect(
      await processWhatsappInbox(s.repository, {
        generate,
        send,
      }),
    ).toEqual({ processed: 0, failed: 1 });
    expect(generate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(
      await env.DB.prepare(
        "SELECT state,failure_code FROM whatsapp_inbox WHERE message_id=?",
      )
        .bind(`wamid-${s.tenantId}`)
        .first(),
    ).toEqual({ state: "failed", failure_code: "inbound_message_expired" });
  });

  it("rechecks the 24-hour window after generation and before sending", async () => {
    const s = await setup();
    await s.repository.receive(inbound(s));
    const send = vi.fn(async () => "must-not-send");

    expect(
      await processWhatsappInbox(s.repository, {
        generate: async () => {
          await env.DB.prepare(
            "UPDATE whatsapp_inbox SET provider_timestamp=? WHERE message_id=?",
          )
            .bind(
              new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
              `wamid-${s.tenantId}`,
            )
            .run();
          return "A late reply";
        },
        send,
      }),
    ).toEqual({ processed: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(
      await env.DB.prepare(
        "SELECT state,failure_code,reply_text FROM whatsapp_inbox WHERE message_id=?",
      )
        .bind(`wamid-${s.tenantId}`)
        .first(),
    ).toEqual({
      state: "failed",
      failure_code: "inbound_message_expired",
      reply_text: null,
    });
  });

  it("bounds generation retries and never sends a failed generation", async () => {
    const s = await setup();
    await s.repository.receive(inbound(s));
    const generate = vi.fn(async () => {
      throw new Error("temporary model failure");
    });
    const send = vi.fn(async () => "unused");

    for (let attempt = 0; attempt < 3; attempt++) {
      expect(
        await processWhatsappInbox(s.repository, { generate, send }),
      ).toEqual({ processed: 0, failed: 1 });
      if (attempt < 2)
        await env.DB.prepare(
          "UPDATE whatsapp_inbox SET retry_at=NULL WHERE message_id=?",
        )
          .bind(`wamid-${s.tenantId}`)
          .run();
    }

    expect(generate).toHaveBeenCalledTimes(3);
    expect(send).not.toHaveBeenCalled();
    expect(
      await env.DB.prepare(
        "SELECT state,generation_attempts,failure_code FROM whatsapp_inbox WHERE message_id=?",
      )
        .bind(`wamid-${s.tenantId}`)
        .first(),
    ).toEqual({
      state: "failed",
      generation_attempts: 3,
      failure_code: "generation_failed",
    });
  });
});
