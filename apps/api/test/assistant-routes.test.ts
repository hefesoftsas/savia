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
    `INSERT OR IGNORE INTO agencies (
      id, id_slug, created_at, updated_at, name, address, id_check_digit,
      id_number, lr_id_number, lr_id_type, lr_name, payments_email, is_active,
      email, is_in_house, email_domain, birthday_from_email, payment_from_email,
      renewal_from_email, home_url, short_name, seller_required, has_compliance,
      surnames, type, theme
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      agencyId,
      `assistant-route-agency-${agencyId}`,
      now,
      now,
      `Assistant Route Agency ${agencyId}`,
      "Calle 1 # 2-3",
      "4",
      `900124${agencyId}`,
      "12345678",
      "CC",
      "Ada Lovelace",
      `payments-${agencyId}@savia.test`,
      1,
      `hello-${agencyId}@savia.test`,
      0,
      `agency-${agencyId}.test`,
      `birthdays-${agencyId}@savia.test`,
      `payments-${agencyId}@savia.test`,
      `renewals-${agencyId}@savia.test`,
      `https://agency-${agencyId}.test`,
      `Agency ${agencyId}`,
      0,
      0,
      "Lovelace",
      "broker",
      "default",
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

  it("rejects an agency administrator from provider configuration", async () => {
    const response = await createConfigurationApp(
      agencyAdministratorAuthenticator(),
    ).request("http://api.savia.test/v1/assistant/configuration");

    expect(response.status).toBe(403);
  });

  it("allows a member to select only an eligible active agency", async () => {
    await seedAssistantAgencyMember(101);
    const response = await createConfigurationApp(
      agencyMemberAuthenticator(),
    ).request("http://api.savia.test/v1/assistant/active-agency", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agencyId: 101 }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activeAgencyId: 101,
    });
  });

  it("saves an agency override and deletes it with a no-content response", async () => {
    await seedAssistantAgencyMember(101);
    const app = createConfigurationApp();
    const saved = await app.request(
      "http://api.savia.test/v1/assistant/configuration/agencies/101",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-5" }),
      },
    );

    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      agencies: [
        expect.objectContaining({ agencyId: 101, model: "openai/gpt-5" }),
      ],
    });

    const deleted = await app.request(
      "http://api.savia.test/v1/assistant/configuration/agencies/101",
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

  it("returns the server-persisted active agency after reload", async () => {
    await seedAssistantAgencyMember(101);
    const app = createConfigurationApp(agencyMemberAuthenticator());
    await app.request("http://api.savia.test/v1/assistant/active-agency", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agencyId: 101 }),
    });

    const response = await app.request(
      "http://api.savia.test/v1/assistant/active-agency",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      activeAgencyId: 101,
      agencies: [expect.objectContaining({ id: 101 })],
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
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=tools&sort=most-popular",
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
          text: true,
          image: false,
          audio: false,
          file: false,
        },
        supportsTools: false,
      },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=tools&sort=most-popular",
      undefined,
    );
  });
});
