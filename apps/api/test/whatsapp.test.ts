import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createWhatsappRepository } from "../src/whatsapp/repository";
import { allowedWhatsappProxyPath } from "../src/whatsapp/nango";
import { createWhatsappProviderRegistry } from "../src/whatsapp/providers";
import { upsertPrincipal } from "../src/auth/identity-repository";
import { authenticationMiddleware } from "../src/auth/middleware";
import type { AppActor } from "../src/auth/types";
import {
  registerWhatsappRoutes,
  type WhatsappRouteDependencies,
} from "../src/routes/whatsapp";

const migrationFiles = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
const migrations = migrationFiles.map(([, sql]) => sql);

beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((s) =>
        s
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});

let counter = 990000;

async function setup() {
  const tenant = ++counter;
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(tenant, `wa-${tenant}`, "WhatsApp tenant", "2026-10-05", "2026-10-05")
    .run();
  const actors = await Promise.all(
    ["owner", "other"].map(
      async (name) =>
        ({
          principal: await upsertPrincipal(env.DB, {
            issuer: "test",
            subject: `${tenant}-${name}`,
            email: `${tenant}-${name}@wa.test`,
            displayName: name,
          }),
          globalRoles: [],
          memberships: [
            {
              id: `m-${name}`,
              principalId: "unused",
              agencyId: tenant,
              tenantId: tenant,
              role: "tenant_admin",
              isActive: true,
              createdAt: "",
              updatedAt: "",
            },
          ],
        }) as AppActor,
    ),
  );
  const repository = createWhatsappRepository(env.DB);
  const proxyResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const nango = {
    createConnectSession: vi.fn(async () => ({
      token: "token",
      expiresAt: "later",
      connectUrl: "https://nango.test",
      apiUrl: "https://nango.test",
    })),
    createReconnectSession: vi.fn(async () => ({
      token: "reconnect-token",
      expiresAt: "later",
      connectUrl: "https://nango.test",
      apiUrl: "https://nango.test",
    })),
    getConnection: vi.fn(
      async (connectionId: string, integrationId: string) => ({
        connectionId,
        providerConfigKey: integrationId,
        organizationId: `user:${actors[0].principal.id}`,
        agencyId: tenant,
        metadata: {},
      }),
    ),
    deleteConnection: vi.fn(async () => {}),
    proxy: vi.fn(async () => proxyResponse({ id: "phone-ok" })),
  };
  const provider = createWhatsappProviderRegistry({
    baseUrl: "https://nango.test",
    apiKey: "test",
    whatsappIntegrationId: "whatsapp-business",
  });
  function app(actor = actors[0]) {
    const a = new OpenAPIHono();
    a.use(
      "*",
      authenticationMiddleware(env.DB, { authenticate: async () => actor }),
    );
    registerWhatsappRoutes(a, env.DB, {
      nango,
      provider,
    } as unknown as WhatsappRouteDependencies);
    return a;
  }
  return { tenant, actors, repository, nango, app };
}

describe("whatsapp proxy allowlist", () => {
  it("allows versioned graph reads and message sends only", () => {
    expect(allowedWhatsappProxyPath("GET", "/v21.0/me")).toBe(true);
    expect(allowedWhatsappProxyPath("GET", "/v21.0/123456789012345")).toBe(
      true,
    );
    expect(
      allowedWhatsappProxyPath(
        "GET",
        "/v21.0/123456789012345/message_templates?limit=10",
      ),
    ).toBe(true);
    expect(
      allowedWhatsappProxyPath("POST", "/v21.0/123456789012345/messages"),
    ).toBe(true);
    expect(allowedWhatsappProxyPath("POST", "/v21.0/me")).toBe(false);
    expect(
      allowedWhatsappProxyPath("GET", "/v21.0/123456789012345/contacts"),
    ).toBe(false);
    expect(allowedWhatsappProxyPath("DELETE", "/v21.0/me")).toBe(false);
    expect(
      allowedWhatsappProxyPath("GET", "https://graph.example.test/v21.0/me"),
    ).toBe(false);
  });
});

describe("whatsapp routes", () => {
  it("reports the provider as unavailable without Nango configuration", async () => {
    const s = await setup();
    const a = new OpenAPIHono();
    a.use(
      "*",
      authenticationMiddleware(env.DB, {
        authenticate: async () => s.actors[0],
      }),
    );
    registerWhatsappRoutes(a, env.DB, undefined);
    const providers = await a.request("/v1/whatsapp/providers");
    expect(providers.status).toBe(200);
    expect(await providers.json()).toMatchObject({
      data: [
        {
          id: "whatsapp",
          attributes: { availability: "unavailable" },
        },
      ],
    });
    const session = await a.request(
      "/v1/whatsapp/connections/connect-session",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agencyId: s.tenant }),
      },
    );
    expect(session.status).toBe(503);
  });

  it("requires an explicit tenant when a platform administrator starts a connection", async () => {
    const s = await setup();
    const platformAdministrator: AppActor = {
      ...s.actors[0],
      globalRoles: ["platform_admin"],
      memberships: [],
    };
    const response = await s
      .app(platformAdministrator)
      .request("/v1/whatsapp/connections/connect-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

    expect(response.status).toBe(403);
    expect(s.nango.createConnectSession).not.toHaveBeenCalled();
  });

  it("requires an explicit tenant when a user has multiple memberships", async () => {
    const s = await setup();
    const multiTenantActor: AppActor = {
      ...s.actors[0],
      memberships: [
        ...s.actors[0].memberships,
        {
          ...s.actors[0].memberships[0],
          id: "second-membership",
          agencyId: s.tenant + 1,
          tenantId: s.tenant + 1,
        },
      ],
    };
    const response = await s
      .app(multiTenantActor)
      .request("/v1/whatsapp/connections/connect-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

    expect(response.status).toBe(403);
    expect(s.nango.createConnectSession).not.toHaveBeenCalled();
  });

  it("requires an explicit tenant even when the user has one membership", async () => {
    const s = await setup();
    const response = await s
      .app()
      .request("/v1/whatsapp/connections/connect-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

    expect(response.status).toBe(403);
    expect(s.nango.createConnectSession).not.toHaveBeenCalled();
  });

  it("completes a connection and validates the phone number live", async () => {
    const s = await setup();
    const app = s.app();
    const complete = await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        connectionId: "wa-conn-1",
        phoneNumberId: "123456789012345",
        wabaId: "987654321098765",
      }),
    });
    expect(complete.status).toBe(200);
    expect(s.nango.proxy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/v21.0/123456789012345",
      }),
    );
    const body = await complete.json();
    expect(body.data.attributes.phoneNumberId).toBe("123456789012345");
    expect(body.data.attributes.status).toBe("connected");
    const list = await app.request(
      `/v1/whatsapp/connections?agencyId=${s.tenant}`,
    );
    expect(list.status).toBe(200);
    const listed = await list.json();
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0].attributes.phoneNumberId).toBe("123456789012345");
    const defaultList = await app.request("/v1/whatsapp/connections");
    expect(defaultList.status).toBe(200);
    expect((await defaultList.json()).data).toHaveLength(1);
  });

  it("uses Nango reconnect for the saved connection and integration", async () => {
    const s = await setup();
    const app = s.app();
    const complete = await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        connectionId: "wa-reconnect-existing",
      }),
    });
    expect(complete.status).toBe(200);

    const response = await app.request(
      "/v1/whatsapp/connections/reconnect-session",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agencyId: s.tenant }),
      },
    );

    expect(response.status).toBe(200);
    expect(s.nango.createReconnectSession).toHaveBeenCalledWith({
      connectionId: "wa-reconnect-existing",
      integrationId: "whatsapp-business",
    });
    expect(s.nango.createConnectSession).not.toHaveBeenCalled();
  });

  it("rejects a Nango connection owned by another user", async () => {
    const s = await setup();
    s.nango.getConnection.mockResolvedValueOnce({
      connectionId: "wa-conn-x",
      providerConfigKey: "whatsapp-business",
      organizationId: "user:someone-else",
      agencyId: s.tenant,
      metadata: {},
    });
    const app = s.app();
    const complete = await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agencyId: s.tenant, connectionId: "wa-conn-x" }),
    });
    expect(complete.status).toBe(403);
  });

  it("rejects a Nango connection with no valid tenant tag", async () => {
    const s = await setup();
    s.nango.getConnection.mockResolvedValueOnce({
      connectionId: "wa-untagged",
      providerConfigKey: "whatsapp-business",
      organizationId: `user:${s.actors[0].principal.id}`,
      agencyId: null,
      metadata: {},
    });
    const complete = await s
      .app()
      .request("/v1/whatsapp/connections/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agencyId: s.tenant,
          connectionId: "wa-untagged",
        }),
      });

    expect(complete.status).toBe(403);
    expect(
      await s.repository.findActiveConnection(
        s.tenant,
        s.actors[0].principal.id,
      ),
    ).toBeUndefined();
  });

  it("does not reuse one Nango connection across organizations", async () => {
    const s = await setup();
    const app = s.app();
    const first = await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agencyId: s.tenant, connectionId: "wa-shared" }),
    });
    expect(first.status).toBe(200);
    const other = await setup();
    other.nango.getConnection.mockResolvedValueOnce({
      connectionId: "wa-shared",
      providerConfigKey: "whatsapp-business",
      organizationId: `user:${other.actors[0].principal.id}`,
      agencyId: other.tenant,
      metadata: {},
    });
    const otherApp = other.app(other.actors[0]);
    const second = await otherApp.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: other.tenant,
        connectionId: "wa-shared",
      }),
    });
    expect(second.status).toBe(409);
  });

  it("rejects a connection tagged for another tenant even when the principal belongs to both", async () => {
    const s = await setup();
    const targetTenant = await setup();
    const actor: AppActor = {
      ...s.actors[0],
      memberships: [
        ...s.actors[0].memberships,
        {
          ...s.actors[0].memberships[0],
          id: "second-membership",
          agencyId: targetTenant.tenant,
          tenantId: targetTenant.tenant,
        },
      ],
    };
    s.nango.getConnection.mockResolvedValueOnce({
      connectionId: "wa-tenant-a",
      providerConfigKey: "whatsapp-business",
      organizationId: `user:${actor.principal.id}`,
      agencyId: s.tenant,
      metadata: {},
    });

    const response = await s
      .app(actor)
      .request("/v1/whatsapp/connections/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agencyId: targetTenant.tenant,
          connectionId: "wa-tenant-a",
        }),
      });

    expect(response.status).toBe(403);
    expect(
      await s.repository.findActiveConnection(
        targetTenant.tenant,
        actor.principal.id,
      ),
    ).toBeUndefined();
  });

  it("sends a test message through the allowlisted messages endpoint", async () => {
    const s = await setup();
    const app = s.app();
    await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        connectionId: "wa-conn-send",
        phoneNumberId: "123456789012345",
      }),
    });
    s.nango.proxy.mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [{ id: "wamid.test123" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const send = await app.request("/v1/whatsapp/connections/test-send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        to: "+573001234567",
        text: "Hola desde Savia",
      }),
    });
    expect(send.status).toBe(200);
    expect(await send.json()).toEqual({
      data: { messageId: "wamid.test123" },
    });
    const lastCall = s.nango.proxy.mock.calls.at(-1)?.[0] as {
      method: string;
      path: string;
      body: unknown;
    };
    expect(lastCall.method).toBe("POST");
    expect(lastCall.path).toBe("/v21.0/123456789012345/messages");
    expect(lastCall.body).toMatchObject({
      messaging_product: "whatsapp",
      to: "+573001234567",
      type: "text",
    });
  });

  it("requires a linked number before test sends and isolates tenants", async () => {
    const s = await setup();
    const app = s.app();
    await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        connectionId: "wa-conn-nonumber",
      }),
    });
    const send = await app.request("/v1/whatsapp/connections/test-send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        to: "+573001234567",
        text: "Hola",
      }),
    });
    expect(send.status).toBe(422);
    const foreign = s.app(s.actors[1]);
    const list = await foreign.request(
      `/v1/whatsapp/connections?agencyId=${s.tenant + 9999}`,
    );
    expect(list.status).toBe(403);
  });

  it("links a phone number after connecting and validates it live", async () => {
    const s = await setup();
    const app = s.app();
    await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        connectionId: "wa-conn-late-number",
      }),
    });
    s.nango.proxy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          display_phone_number: "+573001234567",
          verified_name: "Acme",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const linked = await app.request("/v1/whatsapp/connections/number", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        phoneNumberId: "123456789012345",
      }),
    });
    expect(linked.status).toBe(200);
    const body = await linked.json();
    expect(body.data.attributes.phoneNumberId).toBe("123456789012345");
    expect(body.data.attributes.displayPhoneNumber).toBe("+573001234567");
    expect(body.data.attributes.externalAccountLabel).toBe("Acme");
  });

  it("marks the saved connection reconnect-required after number validation auth failure", async () => {
    const s = await setup();
    const app = s.app();
    const complete = await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        connectionId: "wa-number-auth-existing",
      }),
    });
    expect(complete.status).toBe(200);
    s.nango.proxy.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const response = await app.request("/v1/whatsapp/connections/number", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        phoneNumberId: "123456789012345",
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "WHATSAPP_RECONNECT_REQUIRED" },
    });
    expect(
      await s.repository.findActiveConnection(
        s.tenant,
        s.actors[0].principal.id,
      ),
    ).toMatchObject({ status: "reconnect_required" });
  });

  it("keeps the saved connection healthy when a different candidate fails validation transiently", async () => {
    const s = await setup();
    const app = s.app();
    const complete = await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        connectionId: "wa-candidate-existing",
      }),
    });
    expect(complete.status).toBe(200);
    s.nango.proxy.mockResolvedValueOnce(new Response(null, { status: 502 }));

    const response = await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        connectionId: "wa-candidate-new",
        phoneNumberId: "123456789012345",
      }),
    });

    expect(response.status).toBe(502);
    expect(
      await s.repository.findActiveConnection(
        s.tenant,
        s.actors[0].principal.id,
      ),
    ).toMatchObject({
      status: "connected",
      nangoConnectionId: "wa-candidate-existing",
    });
  });

  it.each([400, 500])(
    "preserves the same saved connection after non-auth phone validation status %i",
    async (status) => {
      const s = await setup();
      const app = s.app();
      const savedConnectionId = `wa-same-nonauth-${s.tenant}`;
      const complete = await app.request("/v1/whatsapp/connections/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agencyId: s.tenant,
          connectionId: savedConnectionId,
        }),
      });
      expect(complete.status).toBe(200);
      s.nango.proxy.mockResolvedValueOnce(new Response(null, { status }));

      const response = await app.request("/v1/whatsapp/connections/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agencyId: s.tenant,
          connectionId: savedConnectionId,
          phoneNumberId: "123456789012345",
        }),
      });

      expect(response.status).toBe(502);
      expect(
        await s.repository.findActiveConnection(
          s.tenant,
          s.actors[0].principal.id,
        ),
      ).toMatchObject({
        status: "connected",
        nangoConnectionId: savedConnectionId,
      });
    },
  );

  it("does not mark the saved connection reconnect-required for another candidate's auth failure", async () => {
    const s = await setup();
    const app = s.app();
    const savedConnectionId = `wa-other-auth-saved-${s.tenant}`;
    const complete = await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        connectionId: savedConnectionId,
      }),
    });
    expect(complete.status).toBe(200);
    s.nango.proxy.mockResolvedValueOnce(new Response(null, { status: 403 }));

    const response = await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        connectionId: `wa-other-auth-candidate-${s.tenant}`,
        phoneNumberId: "123456789012345",
      }),
    });

    expect(response.status).toBe(409);
    expect(
      await s.repository.findActiveConnection(
        s.tenant,
        s.actors[0].principal.id,
      ),
    ).toMatchObject({
      status: "connected",
      nangoConnectionId: savedConnectionId,
    });
  });

  it("marks the same saved connection reconnect-required after its own auth failure", async () => {
    const s = await setup();
    const app = s.app();
    const savedConnectionId = `wa-same-auth-${s.tenant}`;
    const complete = await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        connectionId: savedConnectionId,
      }),
    });
    expect(complete.status).toBe(200);
    s.nango.proxy.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const response = await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agencyId: s.tenant,
        connectionId: savedConnectionId,
        phoneNumberId: "123456789012345",
      }),
    });

    expect(response.status).toBe(409);
    expect(
      await s.repository.findActiveConnection(
        s.tenant,
        s.actors[0].principal.id,
      ),
    ).toMatchObject({
      status: "reconnect_required",
      nangoConnectionId: savedConnectionId,
    });
  });

  it("disconnects and removes the Nango connection", async () => {
    const s = await setup();
    const app = s.app();
    await app.request("/v1/whatsapp/connections/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agencyId: s.tenant, connectionId: "wa-conn-bye" }),
    });
    const disconnected = await app.request(
      `/v1/whatsapp/connections?agencyId=${s.tenant}`,
      { method: "DELETE" },
    );
    expect(disconnected.status).toBe(204);
    expect(s.nango.deleteConnection).toHaveBeenCalledWith(
      "wa-conn-bye",
      "whatsapp-business",
    );
  });
});
