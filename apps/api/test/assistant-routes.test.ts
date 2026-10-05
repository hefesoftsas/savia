import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM assistant_active_tenants");
    await env.DB.exec("DELETE FROM identity_tenant_membership");
    await env.DB.exec("DELETE FROM assistant_openrouter_settings");
  });

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

  it("forwards the mention inference preference to the assistant service", async () => {
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
          inferEmployeeFromMentions: false,
          messages: [
            {
              id: "message-1",
              role: "user",
              parts: [{ type: "text", text: "Review this source: @ventas" }],
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(service.chat).toHaveBeenCalledWith(
      expect.objectContaining({ inferEmployeeFromMentions: false }),
    );
  });

  it("forwards responseMode text to the assistant service", async () => {
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
          responseMode: "text",
          messages: [
            {
              id: "message-1",
              role: "user",
              parts: [{ type: "text", text: "Translate this into Spanish" }],
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(service.chat).toHaveBeenCalledWith(
      expect.objectContaining({ responseMode: "text" }),
    );
  });

  it("forwards an explicit model choice for text-mode assistant chats", async () => {
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
          responseMode: "text",
          model: "openai/gpt-5",
          messages: [
            {
              id: "message-1",
              role: "user",
              parts: [{ type: "text", text: "Translate this into Spanish" }],
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(service.chat).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai/gpt-5", responseMode: "text" }),
    );
  });

  it("rejects malformed explicit assistant model identifiers", async () => {
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
          responseMode: "text",
          model: "not-a-provider-model",
          messages: [],
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(service.chat).not.toHaveBeenCalled();
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

  it("persists image generation and speech models through global and tenant settings routes", async () => {
    await seedAssistantAgencyMember(129);
    const repository = configurationRepository();
    const app = createConfigurationApp(
      platformAdministratorAuthenticator(),
      repository,
    );
    const global = await app.request(
      "http://api.savia.test/v1/assistant/configuration/global",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageGenerationModel: "openai/gpt-image-1",
          speechModel: "openai/gpt-4o-mini-tts",
        }),
      },
    );
    expect(global.status).toBe(200);
    await expect(global.json()).resolves.toMatchObject({
      global: {
        imageGenerationModel: "openai/gpt-image-1",
        speechModel: "openai/gpt-4o-mini-tts",
      },
    });

    const tenant = await app.request(
      "http://api.savia.test/v1/assistant/configuration/tenants/129",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageGenerationModel: "bytedance/seedream-4.5",
        }),
      },
    );
    expect(tenant.status).toBe(200);
    await expect(tenant.json()).resolves.toMatchObject({
      tenants: [
        expect.objectContaining({
          tenantId: 129,
          imageGenerationModel: "bytedance/seedream-4.5",
          speechModel: null,
        }),
      ],
    });
    await expect(
      repository.effectiveConfigurationForPlatformTenant(129),
    ).resolves.toMatchObject({
      imageGenerationModel: "bytedance/seedream-4.5",
      speechModel: "openai/gpt-4o-mini-tts",
    });
    const invalid = await app.request(
      "http://api.savia.test/v1/assistant/configuration/global",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speechModel: "invalid" }),
      },
    );
    expect(invalid.status).toBe(400);
  });

  it("persists the transcription endpoint as part of assistant configuration", async () => {
    const response = await createConfigurationApp().request(
      "http://api.savia.test/v1/assistant/configuration/global",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcriptionModel: "openai/whisper-large-v3",
          transcriptionEndpoint: "audio/transcriptions",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      global: {
        transcriptionModel: "openai/whisper-large-v3",
        transcriptionEndpoint: "audio/transcriptions",
      },
    });
    const invalid = await createConfigurationApp().request(
      "http://api.savia.test/v1/assistant/configuration/global",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcriptionEndpoint: "responses" }),
      },
    );
    expect(invalid.status).toBe(400);
  });

  it("rejects a tenant endpoint override without a tenant transcription model", async () => {
    await seedAssistantAgencyMember(127);
    const response = await createConfigurationApp().request(
      "http://api.savia.test/v1/assistant/configuration/tenants/127",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcriptionEndpoint: "audio/transcriptions" }),
      },
    );
    expect(response.status).toBe(400);
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

  it("allows only existing configuration admins to write model policy", async () => {
    const memberApp = createConfigurationApp(agencyMemberAuthenticator());
    const response = await memberApp.request(
      "http://api.savia.test/v1/assistant/configuration/global",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowedModels: ["openai/gpt-5"] }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("persists a global model allowlist through the existing admin route", async () => {
    const response = await createConfigurationApp().request(
      "http://api.savia.test/v1/assistant/configuration/global",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "deepseek/deepseek-v4-flash",
          allowedModels: ["openai/gpt-5", "openai/gpt-5"],
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      global: {
        model: "deepseek/deepseek-v4-flash",
        allowedModels: ["openai/gpt-5"],
      },
    });
  });

  it("returns the principal's model policy filtered by allowed and account models", async () => {
    await seedAssistantAgencyMember(117);
    const repository = configurationRepository();
    await repository.saveGlobal({
      actorId: "test-platform-admin",
      apiKey: "not-a-real-policy-key",
      model: "deepseek/deepseek-v4-flash",
      allowedModels: [
        "openai/gpt-5",
        "google/gemini-2.5-flash",
        "openai/whisper-large-v3",
      ],
    });
    const list = vi.fn(async () => [
      {
        id: "openai/gpt-5",
        name: "GPT-5",
        contextLength: 400_000,
        modalities: { text: true, image: false, audio: false, file: false },
      },
      {
        id: "google/gemini-2.5-flash",
        name: "Gemini Flash",
        contextLength: 1_000_000,
        modalities: { text: true, image: false, audio: false, file: false },
      },
      {
        id: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet",
        contextLength: 200_000,
        modalities: { text: true, image: false, audio: false, file: false },
      },
      {
        id: "openai/whisper-large-v3",
        name: "Whisper Large v3",
        contextLength: 0,
        modalities: { text: false, image: false, audio: true, file: false },
      },
    ]);
    const response = await createConfigurationApp(
      agencyMemberAuthenticator(),
      repository,
      { list },
    ).request("http://api.savia.test/v1/assistant/model-policy");

    expect(response.status).toBe(200);
    const policy = await response.json();
    expect(policy).toEqual({
      defaultModel: "deepseek/deepseek-v4-flash",
      allowedModels: [
        {
          id: "openai/gpt-5",
          name: "GPT-5",
          contextLength: 400_000,
          modalities: { text: true, image: false, audio: false, file: false },
        },
        {
          id: "google/gemini-2.5-flash",
          name: "Gemini Flash",
          contextLength: 1_000_000,
          modalities: { text: true, image: false, audio: false, file: false },
        },
      ],
    });
    expect(JSON.stringify(policy)).not.toContain("not-a-real-policy-key");
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "not-a-real-policy-key",
        model: "deepseek/deepseek-v4-flash",
        tenantId: 117,
      }),
      { includeGenerationPricing: false },
    );
  });

  it("returns an empty selectable catalog without contacting OpenRouter", async () => {
    const repository = configurationRepository();
    await repository.saveGlobal({
      actorId: "test-platform-admin",
      model: "deepseek/deepseek-v4-flash",
      allowedModels: [],
    });
    const list = vi.fn(async () => []);
    const response = await createConfigurationApp(
      platformAdministratorAuthenticator(),
      repository,
      { list },
    ).request("http://api.savia.test/v1/assistant/model-policy");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      defaultModel: "deepseek/deepseek-v4-flash",
      allowedModels: [],
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("denies model-policy reads when a non-admin's tenant membership is revoked", async () => {
    await seedAssistantAgencyMember(118);
    await env.DB.prepare(
      "DELETE FROM identity_tenant_membership WHERE principal_id = ?",
    )
      .bind("test-agency-member")
      .run();
    const list = vi.fn(async () => []);
    const response = await createConfigurationApp(
      agencyMemberAuthenticator(),
      configurationRepository(),
      { list },
    ).request("http://api.savia.test/v1/assistant/model-policy");

    expect(response.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
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
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/images/models")
        ? Response.json({ data: [] })
        : Response.json({
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
              {
                id: "openai/whisper-large-v3",
                name: "Whisper Large v3",
                architecture: {
                  input_modalities: ["audio"],
                  modality: "audio->transcription",
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
          imageOutput: false,
          speechOutput: false,
        },
        supportsTools: true,
        transcriptionEndpoint: "chat/completions",
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
          imageOutput: false,
          speechOutput: false,
        },
        supportsTools: false,
        transcriptionEndpoint: "chat/completions",
      },
      {
        id: "openai/whisper-large-v3",
        name: "Whisper Large v3",
        contextLength: null,
        inputPricePerMillion: null,
        outputPricePerMillion: null,
        modalities: {
          text: false,
          image: false,
          audio: true,
          file: false,
          imageOutput: false,
          speechOutput: false,
        },
        supportsTools: false,
        transcriptionEndpoint: "audio/transcriptions",
      },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models/user?output_modalities=text,transcription,image,speech&sort=most-popular",
      expect.objectContaining({
        headers: { authorization: "Bearer not-a-real-catalog-key" },
      }),
    );
  });

  it("does not fall back to the public model catalog when the account catalog fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      openRouterModelCatalog(fetcher).list({
        apiKey: "not-a-real-catalog-key",
        model: "deepseek/deepseek-v4-flash",
      }),
    ).rejects.toThrow("OpenRouter models request failed");

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models/user?output_modalities=text,transcription,image,speech&sort=most-popular",
      expect.objectContaining({
        headers: { authorization: "Bearer not-a-real-catalog-key" },
      }),
    );
  });

  it("skips dedicated generation pricing when listing models for chat policy", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: [{ id: "openai/gpt-5" }] }));

    await openRouterModelCatalog(fetcher).list(
      { model: "openai/gpt-5" },
      { includeGenerationPricing: false },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models?output_modalities=text,transcription,image,speech&sort=most-popular",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("retains transcription models beyond the first 200 popular catalog entries", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/images/models")
        ? Response.json({ data: [] })
        : Response.json({
            data: [
              ...Array.from({ length: 200 }, (_, index) => ({
                id: `test/text-${index}`,
                architecture: {
                  input_modalities: ["text"],
                  output_modalities: ["text"],
                },
              })),
              {
                id: "openai/whisper-large-v3",
                architecture: {
                  input_modalities: ["audio"],
                  output_modalities: ["transcription"],
                },
              },
            ],
          }),
    );
    const models = await openRouterModelCatalog(fetcher).list({
      model: "test/chat",
    });
    expect(models).toContainEqual(
      expect.objectContaining({
        id: "openai/whisper-large-v3",
        transcriptionEndpoint: "audio/transcriptions",
      }),
    );
    expect(models).toHaveLength(201);
  });

  it("fetches the public model catalog when no API key is configured", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/images/models")
        ? Response.json({ data: [] })
        : Response.json({
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
          imageOutput: false,
          speechOutput: false,
        },
        supportsTools: false,
      },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models?output_modalities=text,transcription,image,speech&sort=most-popular",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("includes image and speech generation models with unit-safe pricing and isolates optional catalog failures", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (
        url.endsWith(
          "/models?output_modalities=text,transcription,image,speech&sort=most-popular",
        )
      ) {
        return Response.json({
          data: [
            {
              id: "openai/gpt-4o-mini-tts",
              name: "GPT 4o Mini TTS",
              pricing: { prompt: "0.0000006", completion: "0" },
              architecture: {
                tokenizer: "OpenAI",
                input_modalities: ["text"],
                output_modalities: ["speech"],
              },
            },
            {
              id: "google/gemini-2.5-flash-preview-tts",
              name: "Gemini TTS",
              pricing: { prompt: "0.000001", completion: "0.000002" },
              architecture: {
                tokenizer: "Gemini",
                input_modalities: ["text"],
                output_modalities: ["speech"],
              },
            },
            {
              id: "seed/seed-audio",
              name: "Seed Audio",
              pricing: { prompt: "0", completion: "0.00001" },
              architecture: {
                tokenizer: "Seed Audio",
                input_modalities: ["text"],
                output_modalities: ["speech"],
              },
            },
            {
              id: "openai/gpt-5",
              name: "GPT-5",
              pricing: { prompt: "0.000002", completion: "0.00001" },
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["text", "image"],
              },
            },
            {
              id: "test/edit-only",
              name: "Edit-only model",
              architecture: {
                input_modalities: ["text", "image"],
                output_modalities: ["image"],
              },
              supported_parameters: {
                input_references: { min: 1 },
              },
            },
            {
              id: "test/unknown-speech-rate",
              name: "Unknown speech rate",
              pricing: { prompt: "", completion: null },
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["speech"],
              },
            },
          ],
        });
      }
      if (url.endsWith("/images/models")) {
        return Response.json({
          data: [
            {
              id: "recraft/recraft-v4.1-flash",
              name: "Recraft V4.1 Flash",
            },
            { id: "unknown/price-unavailable", name: "Unknown Price" },
            { id: "tiered/only", name: "Tiered Only" },
            { id: "recraft/background-removal", name: "Background Removal" },
          ],
        });
      }
      if (url.endsWith("/images/models/recraft/recraft-v4.1-flash/endpoints")) {
        return Response.json({
          id: "recraft/recraft-v4.1-flash",
          endpoints: [
            {
              provider_slug: "recraft",
              pricing: [
                {
                  billable: "output_image",
                  unit: "image",
                  cost_usd: null,
                },
                {
                  billable: "output_image",
                  unit: "image",
                  cost_usd: "",
                },
                {
                  billable: "output_image",
                  unit: "image",
                  cost_usd: 0.007,
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith("/images/models/recraft/background-removal/endpoints")) {
        return Response.json({
          id: "recraft/background-removal",
          endpoints: [
            {
              provider_slug: "recraft",
              supported_parameters: { input_references: { min: 1 } },
              pricing: [
                {
                  billable: "output_image",
                  unit: "image",
                  cost_usd: 0.001,
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith("/images/models/tiered/only/endpoints")) {
        return Response.json({
          id: "tiered/only",
          endpoints: [
            {
              provider_slug: "tiered-provider",
              pricing: [
                {
                  billable: "output_image",
                  unit: "image",
                  cost_usd: 0.001,
                  tier: { min: 1, max: 10 },
                },
              ],
            },
          ],
        });
      }
      return new Response(null, { status: 503 });
    });

    const models = await openRouterModelCatalog(fetcher).list({
      model: "openai/gpt-5",
    });
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "openai/gpt-4o-mini-tts",
          inputPricePerMillion: null,
          outputPricePerMillion: null,
          modalities: expect.objectContaining({ speechOutput: true }),
          generationPricing: {
            speech: { prompt: { price: 0.0000006, unit: "character" } },
          },
        }),
        expect.objectContaining({
          id: "google/gemini-2.5-flash-preview-tts",
          inputPricePerMillion: 1,
          outputPricePerMillion: 2,
          modalities: expect.objectContaining({ speechOutput: true }),
          generationPricing: {
            speech: {
              prompt: { price: 0.000001, unit: "token" },
              completion: { price: 0.000002, unit: "token" },
            },
          },
        }),
        expect.objectContaining({
          id: "seed/seed-audio",
          inputPricePerMillion: null,
          outputPricePerMillion: null,
          modalities: expect.objectContaining({ speechOutput: true }),
          generationPricing: {
            speech: {
              prompt: { price: 0, unit: "character" },
              completion: { price: 0.00001, unit: "second" },
            },
          },
        }),
        expect.objectContaining({
          id: "openai/gpt-5",
          inputPricePerMillion: 2,
          outputPricePerMillion: 10,
          modalities: expect.objectContaining({ imageOutput: false }),
        }),
        expect.objectContaining({
          id: "test/edit-only",
          modalities: expect.objectContaining({ imageOutput: false }),
        }),
        expect.objectContaining({
          id: "test/unknown-speech-rate",
          inputPricePerMillion: null,
          outputPricePerMillion: null,
        }),
        expect.objectContaining({
          id: "recraft/recraft-v4.1-flash",
          inputPricePerMillion: null,
          outputPricePerMillion: null,
          modalities: expect.objectContaining({ imageOutput: true }),
          generationPricing: {
            image: {
              price: 0.007,
              unit: "image",
              providerSlug: "recraft",
            },
          },
        }),
        expect.objectContaining({
          id: "unknown/price-unavailable",
          modalities: expect.objectContaining({ imageOutput: true }),
        }),
        expect.objectContaining({
          id: "tiered/only",
          modalities: expect.objectContaining({ imageOutput: true }),
        }),
      ]),
    );
    expect(models).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "recraft/background-removal" }),
      ]),
    );
    expect(
      models.find((model) => model.id === "tiered/only")?.generationPricing
        ?.image,
    ).toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models?output_modalities=text,transcription,image,speech&sort=most-popular",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/images/models",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("bounds a stalled optional image pricing response body", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/images/models")) {
        return Response.json({ data: [{ id: "image/slow-pricing" }] });
      }
      if (url.endsWith("/images/models/image/slow-pricing/endpoints")) {
        let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
            controller.enqueue(new TextEncoder().encode("{"));
          },
        });
        init?.signal?.addEventListener("abort", () => {
          stream?.error(new Error("aborted"));
        });
        return new Response(body);
      }
      return Response.json({ data: [] });
    });

    try {
      const listing = openRouterModelCatalog(fetcher).list({
        model: "openai/gpt-5",
      });
      await vi.advanceTimersByTimeAsync(8_000);
      const models = await listing;
      expect(models).toContainEqual(
        expect.objectContaining({
          id: "image/slow-pricing",
          modalities: expect.objectContaining({ imageOutput: true }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
