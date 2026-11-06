import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { upsertPrincipal } from "../src/auth/identity-repository";
import { authenticationMiddleware } from "../src/auth/middleware";
import type { AppActor } from "../src/auth/types";
import { VirtualEmployeesRepository } from "../src/assistant/virtual-employees";
import type { WhatsappNangoClient } from "../src/whatsapp/contracts";
import { WhatsappInboundRepository } from "../src/whatsapp/inbound-repository";
import { registerWhatsappNativeRoutes } from "../src/whatsapp/native-routes";
import {
  defaultNativeConfiguration,
  type NativeConfiguration,
} from "../src/whatsapp/native";

beforeAll(async () => {
  const migrations = Object.entries(
    import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
      eager: true,
      import: "default",
      query: "?raw",
    }),
  ).sort(([a], [b]) => a.localeCompare(b));
  for (const [, sql] of migrations)
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

let sequence = 989000;
async function setup(options: { native?: NativeConfiguration } = {}) {
  const tenantId = ++sequence;
  const now = new Date().toISOString();
  const phoneNumberId = String(123456789000000 + tenantId);
  const wabaId = String(987654321000000 + tenantId);
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,kind,created_at,updated_at) VALUES(?,?,?,1,'commercial',?,?)",
  )
    .bind(tenantId, `wa-native-${tenantId}`, "Native test tenant", now, now)
    .run();
  const principal = await upsertPrincipal(env.DB, {
    issuer: "whatsapp-native-route-test",
    subject: String(tenantId),
    email: `${tenantId}@wa-native.test`,
    displayName: "Tenant admin",
  });
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'tenant_admin',1,?,?)",
  )
    .bind(`membership-${tenantId}`, principal.id, tenantId, now, now)
    .run();
  const actor: AppActor = {
    principal,
    globalRoles: [],
    memberships: [
      {
        id: `membership-${tenantId}`,
        principalId: principal.id,
        tenantId,
        agencyId: tenantId,
        role: "tenant_admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  const connectionId = `connection-${tenantId}`;
  await env.DB.prepare(
    `INSERT INTO tenant_whatsapp_connections
      (id,tenant_id,created_by_principal_id,nango_connection_id,nango_integration_id,status,
       phone_number_id,waba_id,created_at,updated_at)
     VALUES(?,?,?,?,'whatsapp-business','connected',?,?,?,?)`,
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
  const employee = await new VirtualEmployeesRepository(env.DB).create({
    agencyId: tenantId,
    name: "Support",
    handle: `support-${tenantId}`,
    systemPrompt: "Answer customer questions safely.",
    allowedCollections: [],
  });
  const repository = new WhatsappInboundRepository(env.DB);
  await repository.configure({
    tenantId,
    connectionId,
    employeeId: employee.id,
    enabled: true,
    allowedContacts: ["573001234567"],
    updatedBy: principal.id,
    native: options.native,
  });
  const nango = {
    proxy: vi.fn(async () =>
      Response.json({ messages: [{ id: `wamid.native.${tenantId}` }] }),
    ),
  } as unknown as WhatsappNangoClient & { proxy: ReturnType<typeof vi.fn> };

  function appAs(requestActor: AppActor = actor) {
    const app = new OpenAPIHono();
    app.use(
      "*",
      authenticationMiddleware(env.DB, {
        authenticate: async () => requestActor,
      }),
    );
    registerWhatsappNativeRoutes(app, env.DB, nango);
    return app;
  }
  async function addInbound(timestamp = new Date().toISOString()) {
    return repository.receive({
      phoneNumberId,
      wabaId,
      messageId: `wamid-inbound-${tenantId}-${Math.random()}`,
      contactPhone: "+57 300 123 4567",
      text: "I need help",
      timestamp,
    });
  }
  return {
    tenantId,
    phoneNumberId,
    wabaId,
    connectionId,
    principal,
    actor,
    appAs,
    addInbound,
    nango,
    repository,
  };
}

function requestJson(app: OpenAPIHono, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function buttonsReply() {
  return {
    kind: "buttons",
    text: "How can I help?",
    options: [{ id: "quote", title: "Get quote" }],
  };
}

describe("WhatsApp native tenant settings routes", () => {
  it("returns tenant defaults and stores only a tenant admin's approved configuration", async () => {
    const s = await setup();
    const app = s.appAs();
    const initial = await app.request(
      `/v1/whatsapp/native?agencyId=${s.tenantId}`,
    );
    expect(initial.status).toBe(200);
    expect((await initial.json()).data.configuration.replyButtons).toBe(false);

    const configuration = {
      replyButtons: true,
      templates: [
        {
          key: "approved",
          label: "Reminder",
          name: "reminder",
          language: "es_CO",
          parameterCount: 1,
        },
      ],
    };
    const saved = await app.request("/v1/whatsapp/native", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agencyId: s.tenantId, configuration }),
    });
    expect(saved.status).toBe(200);
    expect((await s.repository.getSettings(s.tenantId))?.native).toMatchObject(
      configuration,
    );

    const foreignActor = {
      ...s.actor,
      memberships: s.actor.memberships.map((m) => ({
        ...m,
        tenantId: s.tenantId + 1,
        agencyId: s.tenantId + 1,
      })),
    };
    expect(
      (
        await s
          .appAs(foreignActor)
          .request(`/v1/whatsapp/native?agencyId=${s.tenantId}`)
      ).status,
    ).toBe(403);
  });

  it("returns template IDs and hides published endpoint-backed Flows", async () => {
    const s = await setup();
    s.nango.proxy
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { id: "50001", name: "Static intake", status: "PUBLISHED" },
            {
              id: "50002",
              name: "Dynamic intake",
              status: "PUBLISHED",
              endpoint_uri: "https://tenant.example/flow-endpoint",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: "123456789",
              name: "renewal_reminder",
              language: "es_CO",
              status: "APPROVED",
              components: [{ type: "BODY", text: "Hola {{1}}" }],
            },
            {
              name: "missing_id",
              language: "es_CO",
              status: "APPROVED",
              components: [{ type: "BODY", text: "Hola" }],
            },
          ],
        }),
      );

    const response = await s
      .appAs()
      .request(`/v1/whatsapp/native/assets?agencyId=${s.tenantId}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        flows: [{ id: "50001", name: "Static intake", status: "PUBLISHED" }],
        templates: [
          {
            id: "123456789",
            name: "renewal_reminder",
            language: "es_CO",
            status: "APPROVED",
            parameterCount: 1,
            supported: true,
          },
        ],
      },
    });
    expect(s.nango.proxy.mock.calls[0][0].path).toContain("endpoint_uri");
    expect(s.nango.proxy.mock.calls[1][0].path).toContain("fields=id,name");
  });
});

describe("WhatsApp native message route safety", () => {
  it("sends only a tenant-approved pilot reply once for an idempotency key", async () => {
    const s = await setup({
      native: { ...defaultNativeConfiguration, replyButtons: true },
    });
    await s.addInbound();
    const app = s.appAs();
    const body = {
      agencyId: s.tenantId,
      to: "+57 300 123 4567",
      reply: buttonsReply(),
      idempotencyKey: crypto.randomUUID(),
    };
    const first = await requestJson(app, "/v1/whatsapp/native/messages", body);
    const second = await requestJson(app, "/v1/whatsapp/native/messages", body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(s.nango.proxy).toHaveBeenCalledTimes(1);
    expect(s.nango.proxy.mock.calls[0][0]).toMatchObject({
      method: "POST",
      path: `/v21.0/${s.phoneNumberId}/messages`,
    });
    await env.DB.prepare(
      "UPDATE whatsapp_inbox SET provider_timestamp=? WHERE connection_id=? AND normalized_contact=?",
    )
      .bind(
        new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        s.connectionId,
        "573001234567",
      )
      .run();
    expect(
      (await requestJson(app, "/v1/whatsapp/native/messages", body)).status,
    ).toBe(200);
    expect(s.nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("keeps an uncertain send terminal for the same idempotency key", async () => {
    const s = await setup({
      native: { ...defaultNativeConfiguration, replyButtons: true },
    });
    await s.addInbound();
    s.nango.proxy.mockResolvedValue(
      Response.json({ error: "not exposed" }, { status: 500 }),
    );
    const body = {
      agencyId: s.tenantId,
      to: "573001234567",
      reply: buttonsReply(),
      idempotencyKey: crypto.randomUUID(),
    };
    expect(
      (await requestJson(s.appAs(), "/v1/whatsapp/native/messages", body))
        .status,
    ).toBe(502);
    expect(
      (await requestJson(s.appAs(), "/v1/whatsapp/native/messages", body))
        .status,
    ).toBe(409);
    expect(s.nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("does not use an old sender's inbound message to open the reply window", async () => {
    const s = await setup({
      native: { ...defaultNativeConfiguration, replyButtons: true },
    });
    await s.addInbound();
    const app = s.appAs();
    await env.DB.prepare(
      "UPDATE tenant_whatsapp_connections SET phone_number_id=?,waba_id=? WHERE id=?",
    )
      .bind(
        `${s.phoneNumberId}-replacement`,
        `${s.wabaId}-replacement`,
        s.connectionId,
      )
      .run();
    const response = await requestJson(app, "/v1/whatsapp/native/messages", {
      agencyId: s.tenantId,
      to: "+57 300 123 4567",
      reply: buttonsReply(),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(409);
    expect(s.nango.proxy).not.toHaveBeenCalled();
  });

  it("does not return a cached send after sender identity changes", async () => {
    const s = await setup({
      native: { ...defaultNativeConfiguration, replyButtons: true },
    });
    await s.addInbound();
    const app = s.appAs();
    const body = {
      agencyId: s.tenantId,
      to: "+57 300 123 4567",
      reply: buttonsReply(),
      idempotencyKey: crypto.randomUUID(),
    };
    const first = await requestJson(app, "/v1/whatsapp/native/messages", body);
    expect(first.status, await first.clone().text()).toBe(200);
    await env.DB.prepare(
      "UPDATE tenant_whatsapp_connections SET phone_number_id=?,waba_id=? WHERE id=?",
    )
      .bind(
        `${s.phoneNumberId}-replacement`,
        `${s.wabaId}-replacement`,
        s.connectionId,
      )
      .run();
    expect(
      (await requestJson(app, "/v1/whatsapp/native/messages", body)).status,
    ).toBe(409);
    expect(s.nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("blocks non-template messages outside the 24-hour reply window", async () => {
    const s = await setup({
      native: { ...defaultNativeConfiguration, replyButtons: true },
    });
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO whatsapp_inbox (message_id,phone_number_id,waba_id,contact_phone,normalized_contact,message_text,provider_timestamp,tenant_id,connection_id,state,received_at)
       VALUES(?,?,?,?,?,?,?, ?,?,'completed',?)`,
    )
      .bind(
        `stale-${s.tenantId}`,
        s.phoneNumberId,
        s.wabaId,
        "573001234567",
        "573001234567",
        "old",
        stale,
        s.tenantId,
        s.connectionId,
        stale,
      )
      .run();
    const response = await requestJson(
      s.appAs(),
      "/v1/whatsapp/native/messages",
      {
        agencyId: s.tenantId,
        to: "573001234567",
        reply: buttonsReply(),
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(response.status).toBe(409);
    expect(s.nango.proxy).not.toHaveBeenCalled();
  });

  it("requires consent and current approved matching template metadata before a template send", async () => {
    const native = {
      ...defaultNativeConfiguration,
      templates: [
        {
          key: "renewal",
          label: "Renewal",
          name: "renewal_notice",
          language: "es_CO",
          parameterCount: 1,
        },
      ],
    } as NativeConfiguration;
    const s = await setup({ native });
    s.nango.proxy
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              name: "renewal_notice",
              language: "es_CO",
              status: "APPROVED",
              components: [
                { type: "BODY", text: "Hola {{1}}" },
                { type: "FOOTER", text: "Savia" },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ messages: [{ id: "wamid.template" }] }),
      );
    const base = {
      agencyId: s.tenantId,
      to: "573001234567",
      reply: { kind: "template", resourceKey: "renewal", parameters: ["Ana"] },
      idempotencyKey: crypto.randomUUID(),
    };
    expect(
      (await requestJson(s.appAs(), "/v1/whatsapp/native/messages", base))
        .status,
    ).toBe(422);
    const response = await requestJson(
      s.appAs(),
      "/v1/whatsapp/native/messages",
      { ...base, consent: true },
    );
    expect(response.status).toBe(200);
    expect(s.nango.proxy).toHaveBeenCalledTimes(2);
    expect(s.nango.proxy.mock.calls[0][0].path).toContain("message_templates");
  });

  it("rejects a template with an unapproved language, unsupported components, or the wrong body parameter count", async () => {
    const native = {
      ...defaultNativeConfiguration,
      templates: [
        {
          key: "renewal",
          label: "Renewal",
          name: "renewal_notice",
          language: "es_CO",
          parameterCount: 1,
        },
      ],
    } as NativeConfiguration;
    const s = await setup({ native });
    await s.addInbound();
    s.nango.proxy.mockResolvedValue(
      Response.json({
        data: [
          {
            name: "renewal_notice",
            language: "en_US",
            status: "APPROVED",
            components: [
              { type: "BODY", text: "Hi {{1}} {{2}}" },
              { type: "BUTTONS", buttons: [] },
            ],
          },
        ],
      }),
    );
    const response = await requestJson(
      s.appAs(),
      "/v1/whatsapp/native/messages",
      {
        agencyId: s.tenantId,
        to: "573001234567",
        reply: {
          kind: "template",
          resourceKey: "renewal",
          parameters: ["Ana"],
        },
        idempotencyKey: crypto.randomUUID(),
        consent: true,
      },
    );
    expect(response.status).toBe(422);
    expect(s.nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("verifies that a configured Flow is currently published in the tenant WABA before sending", async () => {
    const native = {
      ...defaultNativeConfiguration,
      flows: [
        { key: "intake", label: "Intake", flowId: "50001", screen: "START" },
      ],
    } as NativeConfiguration;
    const s = await setup({ native });
    await s.addInbound();
    s.nango.proxy.mockResolvedValue(
      Response.json({ data: [{ id: "50002", status: "PUBLISHED" }] }),
    );
    const response = await requestJson(
      s.appAs(),
      "/v1/whatsapp/native/messages",
      {
        agencyId: s.tenantId,
        to: "573001234567",
        reply: {
          kind: "flow",
          text: "Complete this form",
          resourceKey: "intake",
        },
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(response.status).toBe(422);
    expect(s.nango.proxy).toHaveBeenCalledTimes(1);
    expect(s.nango.proxy.mock.calls[0][0].path).toContain(
      `/v21.0/${s.wabaId}/flows`,
    );
  });

  it("rechecks the 24-hour window after Flow metadata reads and before outbound dispatch", async () => {
    const native = {
      ...defaultNativeConfiguration,
      flows: [
        { key: "intake", label: "Intake", flowId: "50001", screen: "START" },
      ],
    };
    const s = await setup({ native });
    await s.addInbound();
    s.nango.proxy.mockImplementation(async () => {
      await env.DB.prepare(
        "UPDATE whatsapp_inbox SET provider_timestamp=? WHERE connection_id=? AND normalized_contact=?",
      )
        .bind(
          new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
          s.connectionId,
          "573001234567",
        )
        .run();
      return Response.json({ data: [{ id: "50001", status: "PUBLISHED" }] });
    });
    const response = await requestJson(
      s.appAs(),
      "/v1/whatsapp/native/messages",
      {
        agencyId: s.tenantId,
        to: "573001234567",
        reply: {
          kind: "flow",
          text: "Complete this form",
          resourceKey: "intake",
        },
        idempotencyKey: crypto.randomUUID(),
      },
    );
    expect(response.status).toBe(409);
    expect(s.nango.proxy).toHaveBeenCalledTimes(1);
  });

  it("bounds multipart upload streams even when content-length is missing", async () => {
    const s = await setup();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 65537));
        controller.close();
      },
    });
    const request = new Request(
      `https://savia.test/v1/whatsapp/native/media?agencyId=${s.tenantId}`,
      {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=bound" },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );
    const response = await s.appAs().request(request);
    expect(response.status).toBe(413);
    expect(s.nango.proxy).not.toHaveBeenCalled();
  });
});
