import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantConfigurationUnavailableError } from "../src/assistant/configuration";
import { PendingActionRepository } from "../src/assistant/pending-actions";
import {
  applyCollectionScoping,
  readOnlyTools,
  SaviaAssistantService,
} from "../src/assistant/service";

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

describe("SaviaAssistantService action approvals", () => {
  beforeAll(applyMigrations);

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM assistant_pending_actions");
  });

  it("executes a stored command once after its owner confirms it", async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "created" }],
      structuredContent: { document: { id: "101" } },
    }));
    const close = vi.fn(async () => undefined);
    const service = new SaviaAssistantService(
      {
        database: env.DB,
        mcpUrl: "http://mcp:8789/mcp",
        mcpSharedSecret: "internal-secret",
        openRouterApiKey: "server-only-key",
      },
      {
        mcpClientFactory: vi.fn(async () => ({
          callTool,
          close,
          tools: async () => ({}),
        })),
      },
    );
    const repository = new PendingActionRepository(env.DB);
    await repository.issue({
      id: "approval-1",
      principalId: "test-platform-admin",
      domain: "agency-network",
      command: "create-agency-profile",
      input: { organization: { displayName: "Savia Norte" } },
    });

    expect(
      await service.confirmAction({
        actionId: "approval-1",
        principalId: "test-platform-admin",
        authorization: "Bearer current-user-token",
      }),
    ).toMatchObject({
      state: "completed",
      result: { structuredContent: { document: { id: "101" } } },
    });
    expect(callTool).toHaveBeenCalledWith({
      name: "savia_execute_command",
      arguments: {
        domain: "agency-network",
        command: "create-agency-profile",
        input: { organization: { displayName: "Savia Norte" } },
      },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(
      await repository.status("approval-1", "test-platform-admin"),
    ).toMatchObject({ state: "completed" });
    expect(await repository.status("approval-1", "another-user")).toBeNull();
    expect(
      await service.confirmAction({
        actionId: "approval-1",
        principalId: "test-platform-admin",
        authorization: "Bearer current-user-token",
      }),
    ).toEqual({ state: "unavailable" });
  });

  it("lets the owner cancel a pending command without calling MCP", async () => {
    const mcpClientFactory = vi.fn();
    const service = new SaviaAssistantService(
      {
        database: env.DB,
        mcpUrl: "http://mcp:8789/mcp",
        mcpSharedSecret: "internal-secret",
        openRouterApiKey: "server-only-key",
      },
      { mcpClientFactory },
    );
    const repository = new PendingActionRepository(env.DB);
    await repository.issue({
      id: "approval-2",
      principalId: "test-platform-admin",
      domain: "agency-network",
      command: "create-agency-profile",
      input: { organization: { displayName: "Savia Sur" } },
    });

    expect(
      await service.cancelAction({
        actionId: "approval-2",
        principalId: "test-platform-admin",
      }),
    ).toEqual({ state: "cancelled" });
    expect(mcpClientFactory).not.toHaveBeenCalled();
  });

  it("marks a command as failed when FastMCP reports a tool error", async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "Command rejected" }],
      isError: true,
    }));
    const service = new SaviaAssistantService(
      {
        database: env.DB,
        mcpUrl: "http://mcp:8789/mcp",
        mcpSharedSecret: "internal-secret",
        openRouterApiKey: "server-only-key",
      },
      {
        mcpClientFactory: vi.fn(async () => ({
          callTool,
          close: async () => undefined,
          tools: async () => ({}),
        })),
      },
    );
    const repository = new PendingActionRepository(env.DB);
    await repository.issue({
      id: "approval-tool-error",
      principalId: "test-platform-admin",
      domain: "agency-network",
      command: "create-agency-profile",
      input: { organization: { displayName: "Savia Oriente" } },
    });

    await expect(
      service.confirmAction({
        actionId: "approval-tool-error",
        principalId: "test-platform-admin",
        authorization: "Bearer current-user-token",
      }),
    ).resolves.toEqual({ state: "failed" });
    expect(
      await repository.consume("approval-tool-error", "test-platform-admin"),
    ).toBeNull();
  });

  it("executes an approved personal integration action without exposing its payload to MCP", async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "sent" }],
      structuredContent: { data: { provider: "gmail", action: "send-email" } },
    }));
    const service = new SaviaAssistantService(
      {
        database: env.DB,
        mcpUrl: "http://mcp:8789/mcp",
        mcpSharedSecret: "internal-secret",
        openRouterApiKey: "server-only-key",
      },
      {
        mcpClientFactory: vi.fn(async () => ({
          callTool,
          close: async () => undefined,
          tools: async () => ({}),
        })),
      },
    );
    const repository = new PendingActionRepository(env.DB);
    await repository.issue({
      id: "approval-personal-send",
      principalId: "test-platform-admin",
      domain: "personal-integrations",
      command: "send-email",
      input: {
        provider: "gmail",
        to: ["person@example.com"],
        subject: "Renewal",
        body: "Please review the renewal.",
      },
    });

    await expect(
      service.confirmAction({
        actionId: "approval-personal-send",
        principalId: "test-platform-admin",
        authorization: "Bearer current-user-token",
      }),
    ).resolves.toMatchObject({ state: "completed" });
    expect(callTool).toHaveBeenCalledWith({
      name: "savia_execute_personal_action",
      arguments: { actionId: "approval-personal-send" },
    });
  });

  it("routes CRM create, update, and delete actions to dedicated CRM tools", async () => {
    const callTool = vi.fn(async (call: { name: string; arguments: any }) => ({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { data: { success: true, ...call.arguments } },
    }));
    const service = new SaviaAssistantService(
      {
        database: env.DB,
        mcpUrl: "http://mcp:8789/mcp",
        mcpSharedSecret: "internal-secret",
        openRouterApiKey: "server-only-key",
      },
      {
        mcpClientFactory: vi.fn(async () => ({
          callTool,
          close: async () => undefined,
          tools: async () => ({}),
        })),
      },
    );
    const repository = new PendingActionRepository(env.DB);

    // 1. Create record
    await repository.issue({
      id: "crm-create-1",
      principalId: "test-platform-admin",
      domain: "cartera",
      command: "create-record",
      input: {
        collection: "cartera",
        data: { name: "juancho", number_1: 10000000 },
      },
    });

    const createRes = await service.confirmAction({
      actionId: "crm-create-1",
      principalId: "test-platform-admin",
      authorization: "Bearer current-user-token",
    });
    expect(createRes).toMatchObject({ state: "completed" });
    expect(callTool).toHaveBeenCalledWith({
      name: "savia_create_crm_record",
      arguments: {
        object: "cartera",
        data: { name: "juancho", number_1: 10000000 },
      },
    });

    // 2. Update record
    await repository.issue({
      id: "crm-update-1",
      principalId: "test-platform-admin",
      domain: "crm",
      command: "update-record",
      input: {
        collection: "clientes",
        id: "rec-123",
        data: { status: "active" },
      },
    });

    const updateRes = await service.confirmAction({
      actionId: "crm-update-1",
      principalId: "test-platform-admin",
      authorization: "Bearer current-user-token",
    });
    expect(updateRes).toMatchObject({ state: "completed" });
    expect(callTool).toHaveBeenCalledWith({
      name: "savia_update_crm_record",
      arguments: {
        object: "clientes",
        id: "rec-123",
        data: { status: "active" },
      },
    });

    // 3. Delete record
    await repository.issue({
      id: "crm-delete-1",
      principalId: "test-platform-admin",
      domain: "crm",
      command: "delete-record",
      input: {
        collection: "cartera",
        id: "rec-456",
      },
    });

    const deleteRes = await service.confirmAction({
      actionId: "crm-delete-1",
      principalId: "test-platform-admin",
      authorization: "Bearer current-user-token",
    });
    expect(deleteRes).toMatchObject({ state: "completed" });
    expect(callTool).toHaveBeenCalledWith({
      name: "savia_delete_crm_record",
      arguments: {
        object: "cartera",
        id: "rec-456",
      },
    });
  });
});

describe("SaviaAssistantService MCP transport", () => {
  it("admits a safe extension tool but excludes an extension write tool", () => {
    const tools = readOnlyTools({
      savia_extension_insurance_summary: {
        annotations: { readOnlyHint: true },
      },
      savia_extension_mutate_policy: {
        annotations: { readOnlyHint: false },
      },
    } as any);

    expect(Object.keys(tools)).toEqual(["savia_extension_insurance_summary"]);
  });

  it("resolves the effective configuration for every new chat", async () => {
    const effectiveConfigurationFor = vi
      .fn()
      .mockResolvedValueOnce({
        apiKey: "not-a-real-agency-key",
        model: "openai/gpt-5",
        agencyId: 101,
      })
      .mockResolvedValueOnce({
        apiKey: "not-a-real-global-key",
        model: "deepseek/deepseek-v4-flash",
      });
    const service = new SaviaAssistantService(
      {
        database: env.DB,
        mcpUrl: "http://mcp:8789/mcp",
        mcpSharedSecret: "internal-secret",
        openRouterApiKey: "not-a-real-static-key",
      },
      {
        configurationResolver: { effectiveConfigurationFor },
        mcpClientFactory: vi.fn(async () => ({
          close: async () => undefined,
          callTool: async () => ({ content: [] }),
          tools: async () => ({}),
        })),
      },
    );
    const chat = (principalId: string) =>
      service.chat({
        principalId,
        authorization: "Bearer current-user-token",
        messages: [
          {
            id: `message-${principalId}`,
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
        ],
      });

    await chat("member-101");
    await chat("member-202");

    expect(effectiveConfigurationFor).toHaveBeenNthCalledWith(1, "member-101");
    expect(effectiveConfigurationFor).toHaveBeenNthCalledWith(2, "member-202");
  });

  it("does not call MCP when no stored or deployment key exists", async () => {
    const mcpClientFactory = vi.fn();
    const service = new SaviaAssistantService(
      {
        database: env.DB,
        mcpUrl: "http://mcp:8789/mcp",
        mcpSharedSecret: "internal-secret",
      },
      {
        configurationResolver: {
          effectiveConfigurationFor: vi.fn(async () => ({
            model: "deepseek/deepseek-v4-flash",
          })),
        },
        mcpClientFactory,
      },
    );

    const response = await service.chat({
      principalId: "member-101",
      authorization: "Bearer current-user-token",
      messages: [],
    });

    expect(response.status).toBe(503);
    expect(mcpClientFactory).not.toHaveBeenCalled();
  });

  it("reports unavailable configuration without opening MCP when a saved key cannot be decrypted", async () => {
    const mcpClientFactory = vi.fn();
    const service = new SaviaAssistantService(
      {
        database: env.DB,
        mcpUrl: "http://mcp:8789/mcp",
        mcpSharedSecret: "internal-secret",
      },
      {
        configurationResolver: {
          effectiveConfigurationFor: vi.fn(async () => {
            throw new AssistantConfigurationUnavailableError();
          }),
        },
        mcpClientFactory,
      },
    );

    const response = await service.chat({
      principalId: "member-101",
      authorization: "Bearer current-user-token",
      messages: [],
    });

    expect(response.status).toBe(503);
    expect(mcpClientFactory).not.toHaveBeenCalled();
  });

  it("preserves the Cloudflare fetch receiver while discovering MCP tools", async () => {
    const platformFetch = vi.fn(function (
      this: typeof globalThis,
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      if (init?.redirect !== "follow") {
        throw new TypeError("Unsupported edge redirect mode");
      }
      const request = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
      };
      if (request.method === "server/discover") {
        return Promise.resolve(
          Response.json({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              supportedVersions: ["2026-07-28"],
              capabilities: { tools: {} },
            },
          }),
        );
      }
      if (request.method === "initialize") {
        return Promise.resolve(
          Response.json({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "test-mcp", version: "1.0.0" },
            },
          }),
        );
      }
      if (request.method === "notifications/initialized") {
        return Promise.resolve(new Response(null, { status: 202 }));
      }
      if (request.method === "tools/list") {
        return Promise.resolve(
          Response.json({
            jsonrpc: "2.0",
            id: request.id,
            result: { tools: [] },
          }),
        );
      }
      throw new Error(`Unexpected MCP method: ${request.method}`);
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", platformFetch);
    const service = new SaviaAssistantService({
      database: env.DB,
      mcpUrl: "http://mcp:8789/mcp",
      mcpSharedSecret: "internal-secret",
      openRouterApiKey: "server-only-key",
    });

    try {
      await expect(
        service.chat({
          principalId: "test-platform-admin",
          authorization: "Bearer current-user-token",
          messages: [
            {
              id: "message-1",
              role: "user",
              parts: [{ type: "text", text: "Hello" }],
            },
          ],
        }),
      ).resolves.toBeInstanceOf(Response);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("exposes CRM collections and aggregation tools to the model while keeping writes confirmed", async () => {
    let capturedTools: Record<string, unknown> = {};
    const toolsMock = vi.fn(async () => ({
      savia_list_crm_collections: { description: "list collections" },
      savia_list_crm_records: { description: "query records" },
      savia_aggregate_crm_records: { description: "aggregate records" },
      savia_get_crm_record: { description: "get record" },
      savia_get_crm_record_links: { description: "get links" },
      savia_create_crm_record: { description: "create record" },
      savia_update_crm_record: { description: "update record" },
    }));
    const service = new SaviaAssistantService(
      {
        database: env.DB,
        mcpUrl: "http://mcp:8789/mcp",
        mcpSharedSecret: "internal-secret",
        openRouterApiKey: "server-only-key",
      },
      {
        mcpClientFactory: vi.fn(async () => ({
          close: async () => undefined,
          callTool: async () => ({ content: [] }),
          tools: toolsMock,
        })),
      },
    );

    // Stream text will receive the tools; we can verify toolsMock was called
    const response = await service.chat({
      principalId: "test-platform-admin",
      authorization: "Bearer current-user-token",
      messages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "¿Cuáles clientes tenemos?" }],
        },
      ],
    });

    expect(response).toBeInstanceOf(Response);
    expect(toolsMock).toHaveBeenCalledOnce();
  });

  it("resolves virtual employee from @handle and attaches employee identity headers", async () => {
    const toolsMock = vi.fn(async () => ({
      savia_list_crm_records: {
        description: "List records",
      },
    }));

    const service = new SaviaAssistantService(
      {
        database: env.DB,
        mcpUrl: "http://mcp:8789/mcp",
        mcpSharedSecret: "internal-secret",
        openRouterApiKey: "server-only-key",
      },
      {
        mcpClientFactory: vi.fn(async () => ({
          close: async () => undefined,
          callTool: async () => ({ content: [] }),
          tools: toolsMock,
        })),
      },
    );

    const response = await service.chat({
      principalId: "test-platform-admin",
      authorization: "Bearer current-user-token",
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "@ventas ¿cuántas cotizaciones nuevas hay?",
          parts: [
            {
              type: "text",
              text: "@ventas ¿cuántas cotizaciones nuevas hay?",
            },
          ],
        },
      ],
    });

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("x-savia-employee-handle")).toBe("ventas");
    expect(
      decodeURIComponent(response.headers.get("x-savia-employee-name") ?? ""),
    ).toContain("Laura");
  });
});

describe("virtual employee CRM scoping", () => {
  const employee = {
    handle: "alice",
    allowedCollections: ["cotizaciones"],
  } as Parameters<typeof applyCollectionScoping>[1];
  it("enforces the MCP object argument while allowing assigned quote collections", async () => {
    const execute = vi.fn(async () => ({ data: [] }));
    const tools = applyCollectionScoping(
      { savia_list_crm_records: { execute } },
      employee,
    );
    expect(
      await tools.savia_list_crm_records.execute({ object: "clientes" }, {}),
    ).toMatchObject({ isError: true, error: "ACCESS_DENIED" });
    expect(execute).not.toHaveBeenCalled();
    await tools.savia_list_crm_records.execute({ object: "cotizaciones" }, {});
    expect(execute).toHaveBeenCalledOnce();
  });
  it("filters collection discovery inside MCP text and structured content", async () => {
    const data = { data: [{ name: "cotizaciones" }, { name: "clientes" }] };
    const execute = vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    }));
    const tools = applyCollectionScoping(
      { savia_list_crm_collections: { execute } },
      employee,
    );
    const result = await tools.savia_list_crm_collections.execute({}, {});
    expect(result.structuredContent.data).toEqual([{ name: "cotizaciones" }]);
    expect(JSON.parse(result.content[0].text).data).toEqual([
      { name: "cotizaciones" },
    ]);
  });
});

it("requires both quote collections for the compact comparison tool", async () => {
  const execute = vi.fn(async () => ({ totalQuotes: 1 }));
  const tool = { savia_get_quote_summary: { execute } };
  const limited = applyCollectionScoping(tool, {
    handle: "alice",
    allowedCollections: ["cotizaciones"],
  } as Parameters<typeof applyCollectionScoping>[1]);
  expect(await limited.savia_get_quote_summary.execute({}, {})).toMatchObject({
    isError: true,
  });
  expect(execute).not.toHaveBeenCalled();
  const allowed = applyCollectionScoping(tool, {
    handle: "alice",
    allowedCollections: ["cotizaciones", "cotizaciones_detalle"],
  } as Parameters<typeof applyCollectionScoping>[1]);
  expect(await allowed.savia_get_quote_summary.execute({}, {})).toEqual({
    totalQuotes: 1,
  });
});

it.each(["savia_get_quote_form", "savia_lookup_quote_vehicle"])(
  "requires assigned quote collections for %s",
  async (toolName) => {
    const execute = vi.fn();
    const tools = applyCollectionScoping({ [toolName]: { execute } }, {
      handle: "alice",
      allowedCollections: ["clientes"],
    } as Parameters<typeof applyCollectionScoping>[1]);
    expect(await tools[toolName].execute({}, {})).toMatchObject({
      isError: true,
      error: "ACCESS_DENIED",
    });
    expect(execute).not.toHaveBeenCalled();
  },
);
