import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { authenticationMiddleware } from "../src/auth/middleware";
import { agencyMemberAuthenticator } from "./auth-fixtures";
import { registerAssistantRoutes } from "../src/assistant/routes";
import { VirtualEmployeesRepository } from "../src/assistant/virtual-employees";
import { consumeEmployeeStream } from "../src/assistant/employee-mcp";
import type { AssistantService } from "../src/assistant/contracts";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);
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
function stream(events: unknown[]) {
  return new Response(
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
      "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}
function fixture() {
  const chat = vi.fn(async () =>
    stream([{ type: "text-delta", delta: "Hello" }, { type: "finish" }]),
  );
  const service: AssistantService = {
    chat,
    confirmAction: vi.fn(),
    cancelAction: vi.fn(),
  };
  const app = new OpenAPIHono();
  app.use("*", authenticationMiddleware(env.DB, agencyMemberAuthenticator()));
  registerAssistantRoutes(app, service, { db: env.DB });
  return { app, chat };
}
describe("employee MCP API", () => {
  it("lists public employee capabilities without system prompts or inactive employees", async () => {
    await new VirtualEmployeesRepository(env.DB).create({
      name: "Hidden",
      handle: "mcp-hidden",
      status: "inactive",
      systemPrompt: "secret",
    });
    const { app } = fixture();
    const response = await app.request("/api/assistant/mcp/employees");
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(data.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain("systemPrompt");
    expect(JSON.stringify(data)).not.toContain("mcp-hidden");
    expect(data.data[0]).not.toHaveProperty("files");
  });
  it("rejects inactive, unknown and out-of-tenant employees before model execution", async () => {
    const repo = new VirtualEmployeesRepository(env.DB);
    const inactive = await repo.create({
      name: "Off",
      handle: "mcp-off",
      status: "inactive",
      systemPrompt: "private",
    });
    const other = await repo.create({
      name: "Other",
      handle: "mcp-other",
      systemPrompt: "private",
    });
    await env.DB.exec(
      "INSERT OR IGNORE INTO tenants (id, id_slug, name, is_active, created_at, updated_at) VALUES (999, 'mcp-other', 'Other', 1, '2026-01-01', '2026-01-01')",
    );
    await env.DB.prepare(
      "UPDATE assistant_virtual_employees SET agency_id = 999 WHERE id = ?",
    )
      .bind(other.id)
      .run();
    const { app, chat } = fixture();
    for (const id of [inactive.id, other.id, "missing"]) {
      const response = await app.request(
        `/api/assistant/mcp/employees/${id}/invoke`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer user",
            "content-type": "application/json",
          },
          body: JSON.stringify({ message: "Do work" }),
        },
      );
      expect(response.status).toBe(404);
    }
    expect(chat).not.toHaveBeenCalled();
  });
  it("invokes the selected employee with the caller token and returns its completed answer", async () => {
    const employee = (await new VirtualEmployeesRepository(env.DB).list())[0];
    const { app, chat } = fixture();
    const response = await app.request(
      `/api/assistant/mcp/employees/${employee.id}/invoke`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer user",
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "Summarize" }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      text: "Hello",
      pendingActions: [],
    });
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: employee.id,
        principalId: "test-agency-member",
        authorization: "Bearer user",
      }),
    );
  });
  it("collects pending proposals but never executes them", async () => {
    const result = await consumeEmployeeStream(
      stream([
        {
          type: "tool-output-available",
          output: {
            actionId: "a1",
            requiresConfirmation: true,
            domain: "crm",
            command: "update-record",
            input: { id: 1 },
          },
        },
        { type: "finish" },
      ]),
    );
    expect(result.pendingActions).toHaveLength(1);
    expect(result.pendingActions[0]).toMatchObject({
      actionId: "a1",
      requiresConfirmation: true,
    });
  });
  it("rejects model errors and truncated streams instead of claiming success", async () => {
    await expect(
      consumeEmployeeStream(
        stream([{ type: "error", errorText: "provider secret" }]),
      ),
    ).rejects.toThrow("Employee response failed");
    await expect(
      consumeEmployeeStream(
        new Response('data: {"type":"text-delta","delta":"partial"}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    ).rejects.toThrow("incomplete");
  });
});
