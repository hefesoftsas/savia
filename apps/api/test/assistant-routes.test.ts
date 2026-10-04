import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import {
  AssistantConfigurationRepository,
  type AssistantModelCatalog,
  openRouterModelCatalog,
} from "../src/assistant/configuration";
import type { AssistantService } from "../src/assistant/contracts";
import { createOAuthResourceAuthenticator } from "../src/auth/oauth-resource";
import {
  agencyAdministratorAuthenticator,
  agencyMemberAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

async function applyMigrations() {
  for (const migration of migrationSqls) {
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((part) =>
        part
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)) {
      await env.DB.exec(statement);
    }
  }
}

function createAssistantService(): AssistantService {
  return {
    chat: vi.fn(
      async () =>
        new Response('data: {\\"type\\":\\"finish\\"}\\n\\n', {
          headers: { "content-type": "text/event-stream" },
        }),
    ),
    confirmAction: vi.fn(async () => ({
      state: "completed" as const,
      result: { document: { id: "101" } },
    })),
    cancelAction: vi.fn(async () => ({ state: "cancelled" as const })),
  };
}

function createAssistantApp(service?: AssistantService) {
  return createApp(
    env.DB,
    undefined,
    undefined,
    platformAdministratorAuthenticator(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    service,
  );
}

function configurationRepository() {
  return new AssistantConfigurationRepository(env.DB, {
    encryptionKey: btoa("a".repeat(32)),
  });
}

function createConfigurationApp(
  authenticator = platformAdministratorAuthenticator(),
  repository = configurationRepository(),
  modelCatalog?: AssistantModelCatalog,
) {
  return createApp(
    env.DB,
    undefined,
    undefined,
    authenticator,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    repository,
    modelCatalog,
  );
}

async function seedAssistantAgencyMember(agencyId: number) {
  const now = "2026-01-01T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(?,?,?,1,?,?,'commercial')",
  )
    .bind(
      agencyId,
      `assistant-route-tenant-${agencyId}`,
      `Assistant Route Tenant ${agencyId}`,
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal (
      id, issuer, subject, email, display_name, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      "test-agency-member",
      "savia:test",
      "test-agency-member",
      "member@savia.test",
      "Savia Test Member",
      1,
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_tenant_membership (
      id, principal_id, tenant_id, role, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `assistant-route-membership-${agencyId}`,
      "test-agency-member",
      agencyId,
      "viewer",
      1,
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal (
      id, issuer, subject, email, display_name, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      "test-agency-administrator",
      "savia:better-auth",
      "test-agency-administrator",
      "administrator@savia.test",
      "Savia Test Agency Administrator",
      1,
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_tenant_membership (
      id, principal_id, tenant_id, role, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `assistant-route-admin-membership-${agencyId}`,
      "test-agency-administrator",
      agencyId,
      "tenant_admin",
      1,
      now,
      now,
    )
    .run();
}

function createReadScopedAssistantApp(service: AssistantService) {
  return createApp(
    env.DB,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createOAuthResourceAuthenticator({
      issuer: "https://auth.savia.test/api/auth",
      resource: "https://api.savia.test",
      verifyAccessToken: async () => ({
        sub: "assistant-read-user",
        scope: "savia.api.read",
        "https://savia.hefesoft.com/roles": [],
        "https://savia.hefesoft.com/email": "reader@savia.test",
        "https://savia.hefesoft.com/name": "Assistant Reader",
        "https://savia.hefesoft.com/two-factor-enabled": false,
      }),
    }),
    undefined,
    undefined,
    service,
  );
}

describe("assistant routes", () => {
  beforeAll(applyMigrations);

  it("streams a chat with the authenticated principal and current bearer", async () => {
    const service = createAssistantService();
    const response = await createAssistantApp(service).request(
      "http://api.savia.test/api/assistant/chat",
      {
        method: "POST",
        headers: {
          authorization: "Bearer current-user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              id: "message-1",
              role: "user",
              parts: [{ type: "text", text: "Lista las agencias" }],
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(service.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: "test-platform-admin",
        authorization: "Bearer current-user-token",
      }),
    );
  });

  it("allows a read-scoped OAuth token to start an assistant chat", async () => {
    const service = createAssistantService();
    const response = await createReadScopedAssistantApp(service).request(
      "http://api.savia.test/api/assistant/chat",
      {
        method: "POST",
        headers: {
          authorization: "Bearer header.payload.signature",
          "content-type": "application/json",
        },
        body: JSON.stringify({ messages: [] }),
      },
    );

    expect(response.status).toBe(200);
    expect(service.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: "Bearer header.payload.signature",
      }),
    );
  });

  it("confirms or cancels only through the authenticated assistant service", async () => {
    const service = createAssistantService();
    const app = createAssistantApp(service);
    const headers = { authorization: "Bearer current-user-token" };

    const confirmation = await app.request(
      "http://api.savia.test/api/assistant/actions/approval-1/confirm",
      { method: "POST", headers },
    );
    expect(confirmation.status).toBe(200);
    expect(await confirmation.json()).toMatchObject({ state: "completed" });
    expect(service.confirmAction).toHaveBeenCalledWith({
      actionId: "approval-1",
      principalId: "test-platform-admin",
      authorization: "Bearer current-user-token",
    });

    const cancellation = await app.request(
      "http://api.savia.test/api/assistant/actions/approval-1/cancel",
      { method: "POST", headers },
    );
    expect(cancellation.status).toBe(200);
    expect(await cancellation.json()).toEqual({ state: "cancelled" });
    expect(service.cancelAction).toHaveBeenCalledWith({
      actionId: "approval-1",
      principalId: "test-platform-admin",
    });
  });

  it("returns a configuration error instead of exposing an unconfigured assistant", async () => {
    const response = await createAssistantApp().request(
      "http://api.savia.test/api/assistant/chat",
      {
        method: "POST",
        headers: {
          authorization: "Bearer current-user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ messages: [] }),
      },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "ASSISTANT_UNAVAILABLE",
        message: "The assistant is not configured",
      },
    });
  });

  it("allows a platform admin to save a key but does not return it", async () => {
    const response = await createConfigurationApp().request(
      "http://api.savia.test/v1/assistant/configuration/global",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: "not-a-real-write-only-key",
          model: "deepseek/deepseek-v4-flash",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(
      "not-a-real-write-only-key",
    );
  });

  it("allows a platform admin to save meeting models as global-only partial settings", async () => {
    const repository = configurationRepository();
    await repository.saveGlobal({
      actorId: "test-platform-admin",
      apiKey: "not-a-real-global-key",
      model: "deepseek/deepseek-v4-flash",
    });
    const app = createConfigurationApp(
      platformAdministratorAuthenticator(),
      repository,
    );
    const response = await app.request(
      "http://api.savia.test/v1/assistant/configuration/global",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcriptionModel: "openai/whisper-large-v3-turbo",
          summaryModel: "openai/gpt-4o-mini",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      global: {
        model: "deepseek/deepseek-v4-flash",
        transcriptionModel: "openai/whisper-large-v3-turbo",
        summaryModel: "openai/gpt-4o-mini",
      },
    });
    await expect(
      repository.effectiveConfigurationFor("test-platform-admin"),
    ).resolves.toMatchObject({ apiKey: "not-a-real-global-key" });
  });

  it("allows meeting model fields on tenant assistant configuration writes", async () => {
    await seedAssistantAgencyMember(101);
    const response = await createConfigurationApp().request(
      "http://api.savia.test/v1/assistant/configuration/tenants/101",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcriptionModel: "openai/whisper-large-v3" }),
      },
    );
    expect(response.status).toBe(200);
  });

  it("rejects an agency administrator from provider configuration", async () => {
    await seedAssistantAgencyMember(101);
    const response = await createConfigurationApp(
      agencyAdministratorAuthenticator(),
    ).request("http://api.savia.test/v1/assistant/configuration");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      canManageGlobal: false,
      manageableTenantIds: [101],
    });
  });

  it("returns only administered tenant settings and sanitized global defaults", async () => {
    await seedAssistantAgencyMember(101);
    await seedAssistantAgencyMember(202);
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET role='viewer' WHERE id = ?",
    )
      .bind("assistant-route-admin-membership-202")
      .run();
    const repository = configurationRepository();
    await repository.saveGlobal({
      actorId: "test-platform-admin",
      apiKey: "global-secret-key",
      model: "openai/gpt-5",
      transcriptionModel: "openai/whisper-large-v3",
      summaryModel: "openai/gpt-4o-mini",
    });
    await repository.saveAgencyOverride(101, {
      actorId: "test-platform-admin",
      model: "deepseek/deepseek-v4-flash",
    });
    await repository.saveAgencyOverride(202, {
      actorId: "test-platform-admin",
      apiKey: "other-tenant-secret-key",
      model: "other/model",
    });
    const adminActor = agencyAdministratorAuthenticator();
    const response = await createConfigurationApp(
      adminActor,
      repository,
    ).request("http://api.savia.test/v1/assistant/configuration");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      canManageGlobal: false,
      manageableTenantIds: [101],
      global: {
        scope: "global",
        keyState: "configured",
        model: "openai/gpt-5",
        transcriptionModel: "openai/whisper-large-v3",
        summaryModel: "openai/gpt-4o-mini",
      },
      tenants: [expect.objectContaining({ tenantId: 101 })],
    });
    expect(payload.global).not.toHaveProperty("updatedAt");
    expect(payload.global).not.toHaveProperty("updatedBy");
    expect(JSON.stringify(payload)).not.toContain("other/model");
    expect(JSON.stringify(payload)).not.toContain("other-tenant-secret-key");
    expect(JSON.stringify(payload)).not.toContain("global-secret-key");
  });

  it("allows tenant admins to save meeting model overrides only for their active tenant", async () => {
    await seedAssistantAgencyMember(101);
    const app = createConfigurationApp(agencyAdministratorAuthenticator());
    const saved = await app.request(
      "http://api.savia.test/v1/assistant/configuration/tenants/101",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcriptionModel: "openai/whisper-large-v3-turbo",
          summaryModel: "openai/gpt-4o-mini",
        }),
      },
    );
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      tenants: [
        expect.objectContaining({
          tenantId: 101,
          transcriptionModel: "openai/whisper-large-v3-turbo",
          summaryModel: "openai/gpt-4o-mini",
        }),
      ],
    });

    const denied = await app.request(
      "http://api.savia.test/v1/assistant/configuration/tenants/202",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-5" }),
      },
    );
    expect(denied.status).toBe(403);
  });

  it("allows a member to select only an eligible active agency", async () => {
    await seedAssistantAgencyMember(101);
    const response = await createConfigurationApp(
      agencyMemberAuthenticator(),
    ).request("http://api.savia.test/v1/assistant/active-tenant", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: 101 }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activeTenantId: 101,
    });
  });

  it("saves an agency override and deletes it with a no-content response", async () => {
    await seedAssistantAgencyMember(101);
    const app = createConfigurationApp();
    const saved = await app.request(
      "http://api.savia.test/v1/assistant/configuration/tenants/101",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-5" }),
      },
    );

    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      tenants: expect.arrayContaining([
        expect.objectContaining({ tenantId: 101, model: "openai/gpt-5" }),
      ]),
    });

    const deleted = await app.request(
      "http://api.savia.test/v1/assistant/configuration/tenants/101",
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(204);
  });

  it("persists a chosen active tenant via agnostic active-tenant route", async () => {
    await seedAssistantAgencyMember(101);
    const app = createConfigurationApp(agencyMemberAuthenticator());
    const response = await app.request(
      "http://api.savia.test/v1/assistant/active-tenant",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: 101 }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activeTenantId: 101,
      activeTenantId: 101,
    });

    const getResponse = await app.request(
      "http://api.savia.test/v1/assistant/active-tenant",
    );
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      activeTenantId: 101,
      tenants: [expect.objectContaining({ id: 101 })],
    });
  });

  it("saves a tenant override via agnostic configuration route and deletes it", async () => {
    await seedAssistantAgencyMember(101);
    const app = createConfigurationApp();
    const saved = await app.request(
      "http://api.savia.test/v1/assistant/configuration/tenants/101",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-5" }),
      },
    );

    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      tenants: expect.arrayContaining([
        expect.objectContaining({ tenantId: 101, model: "openai/gpt-5" }),
      ]),
    });

    const deleted = await app.request(
      "http://api.savia.test/v1/assistant/configuration/tenants/101",
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(204);
  });

  it("returns a bounded model catalog without exposing its configuration", async () => {
    const repository = configurationRepository();
    await repository.saveGlobal({
      actorId: "test-platform-admin",
      apiKey: "not-a-real-catalog-key",
      model: "deepseek/deepseek-v4-flash",
    });
    const list = vi.fn(async () => [
      {
        id: "openai/gpt-5",
        name: "GPT-5",
        contextLength: 400_000,
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10,
      },
    ]);
    const response = await createConfigurationApp(
      platformAdministratorAuthenticator(),
      repository,
      { list },
    ).request("http://api.savia.test/v1/assistant/models");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      models: [
        {
          id: "openai/gpt-5",
          name: "GPT-5",
          contextLength: 400_000,
          inputPricePerMillion: 2.5,
          outputPricePerMillion: 10,
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain("not-a-real-catalog-key");
  });

  it("uses the requested tenant's key for a tenant admin's model catalog", async () => {
    await seedAssistantAgencyMember(101);
    const repository = configurationRepository();
    await repository.saveAgencyOverride(101, {
      actorId: "test-platform-admin",
      apiKey: "tenant-catalog-key",
      model: "openai/gpt-5",
    });
    const list = vi.fn(async () => []);
    const response = await createConfigurationApp(
      agencyAdministratorAuthenticator(),
      repository,
      { list },
    ).request("http://api.savia.test/v1/assistant/models?tenantId=101");

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "tenant-catalog-key",
        model: "openai/gpt-5",
        tenantId: 101,
      }),
    );
  });

  it("uses tenant credentials for platform tenant catalog requests and global credentials by default", async () => {
    await seedAssistantAgencyMember(101);
    const repository = configurationRepository();
    await repository.saveGlobal({
      actorId: "test-platform-admin",
      apiKey: "global-catalog-key",
      model: "openai/gpt-5",
    });
    await repository.saveAgencyOverride(101, {
      actorId: "test-platform-admin",
      apiKey: "tenant-catalog-key",
      model: "other/model",
    });
    const list = vi.fn(async () => []);
    const app = createConfigurationApp(
      platformAdministratorAuthenticator(),
      repository,
      { list },
    );

    expect(
      (await app.request("http://api.savia.test/v1/assistant/models")).status,
    ).toBe(200);
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiKey: "global-catalog-key",
        model: "openai/gpt-5",
      }),
    );

    expect(
      (
        await app.request(
          "http://api.savia.test/v1/assistant/models?tenantId=101",
        )
      ).status,
    ).toBe(200);
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiKey: "tenant-catalog-key",
        model: "other/model",
        tenantId: 101,
      }),
    );
  });

  it("denies configuration reads to non-admin tenant members", async () => {
    await seedAssistantAgencyMember(101);
    const response = await createConfigurationApp(
      agencyMemberAuthenticator(),
    ).request("http://api.savia.test/v1/assistant/configuration");
    expect(response.status).toBe(403);
  });

  it("returns the server-persisted active agency after reload", async () => {
    await seedAssistantAgencyMember(101);
    const app = createConfigurationApp(agencyMemberAuthenticator());
    await app.request("http://api.savia.test/v1/assistant/active-tenant", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: 101 }),
    });

    const response = await app.request(
      "http://api.savia.test/v1/assistant/active-tenant",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activeTenantId: 101,
      tenants: [expect.objectContaining({ id: 101 })],
    });
  });

  it("returns tool-capable OpenRouter models with per-million token prices and modalities", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        data: [
          {
            id: "openai/gpt-5",
            name: "GPT-5",
            context_length: 400_000,
            pricing: { prompt: "0.0000025", completion: "0.00001" },
            architecture: {
              input_modalities: ["text", "image", "audio"],
              modality: "text+image+audio->text",
            },
            supported_parameters: ["tools"],
          },
          {
            id: "audio/model",
            name: "Audio Model",
            architecture: {
              input_modalities: ["audio"],
              modality: "audio->text",
            },
            supported_parameters: [],
          },
          { id: "invalid model", name: "Invalid" },
        ],
      }),
    );

    await expect(
      openRouterModelCatalog(fetcher).list({
        apiKey: "not-a-real-catalog-key",
        model: "deepseek/deepseek-v4-flash",
      }),
    ).resolves.toEqual([
      {
        id: "openai/gpt-5",
        name: "GPT-5",
        contextLength: 400_000,
        inputPricePerMillion: 2.5,
        outputPricePerMillion: 10,
        modalities: {
          text: true,
          image: true,
          audio: true,
          file: true,
        },
        supportsTools: true,
      },
      {
        id: "audio/model",
        name: "Audio Model",
        contextLength: null,
        inputPricePerMillion: null,
        outputPricePerMillion: null,
        modalities: {
          text: true,
          image: false,
          audio: true,
          file: false,
        },
        supportsTools: false,
      },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models?output_modalities=text&sort=most-popular",
      expect.objectContaining({
        headers: { authorization: "Bearer not-a-real-catalog-key" },
      }),
    );
  });

  it("fetches the public model catalog when no API key is configured", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          {
            id: "deepseek/deepseek-v4-flash",
            name: "DeepSeek V4 Flash",
            context_length: 128_000,
            pricing: { prompt: "0.000001", completion: "0.000002" },
          },
        ],
      }),
    );

    await expect(
      openRouterModelCatalog(fetcher).list({
        model: "deepseek/deepseek-v4-flash",
      }),
    ).resolves.toEqual([
      {
        id: "deepseek/deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        contextLength: 128_000,
        inputPricePerMillion: 1,
        outputPricePerMillion: 2,
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
        },
        supportsTools: false,
      },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models?output_modalities=text&sort=most-popular",
      undefined,
    );
  });
});
