import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createCollectionSourceApp } from "../src/studio/collection-sources";
import { createMcpPluginActionExecutor } from "../src/studio/mcp-plugin-actions";
import { storeMcpActionSchema } from "@savia/studio-shared/plugin-store";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const part of sql.split("--> statement-breakpoint")) {
      const s = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (s) await env.DB.exec(s);
    }
});
let calls: Record<string, unknown>[] = [];
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "cloudflare-dns.com")
    return Response.json({
      Status: 0,
      Answer: [{ type: 1, data: "104.16.1.1" }],
    });
  const req = JSON.parse(String(init?.body ?? "{}"));
  if (req.method === "notifications/initialized" || init?.method === "DELETE")
    return new Response(null, { status: 202 });
  let result;
  if (req.method === "initialize")
    result = {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "fixture", version: "1" },
    };
  if (req.method === "tools/list")
    result = {
      tools: [
        {
          name: "buscar_licitaciones",
          inputSchema: {
            type: "object",
            properties: {
              q: { type: "string" },
              limit: { type: "number" },
              offset: { type: "number" },
            },
          },
        },
      ],
    };
  if (req.method === "tools/call") {
    calls.push(req.params);
    result = {
      content: [],
      structuredContent: { data: [{ ":id": "source_1", name: "A tender" }] },
    };
  }
  return Response.json({ jsonrpc: "2.0", id: req.id, result });
};
const tenantId = "mcp-plugin-tests";
const action = storeMcpActionSchema.parse({
  id: "search",
  kind: "mcp",
  sourceId: "secop_live",
  tool: "buscar_licitaciones",
  mapping: {
    arguments: {},
    idField: ":id",
    itemsPointer: "/data",
    pagination: { limitArgument: "limit", offsetArgument: "offset" },
  },
  inputArguments: ["q"],
});
const request = {
  tenantId,
  principalId: "owner",
  extensionId: "procurement.secop",
  action,
  input: { q: "software", page: 1, perPage: 20 },
};
const make = (principalId = "owner") =>
  createMcpPluginActionExecutor({
    db: env.DB,
    tenant: tenantId,
    principalId,
    fetcher,
  });
it("uses only a declared read tool on the current owner's source and allowlisted search input", async () => {
  const app = createCollectionSourceApp(
    env.DB,
    env.DOCUMENTS,
    tenantId,
    "owner",
    undefined,
    fetcher,
  );
  const created = await app.request("https://savia.dev/api/sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "secop_live",
      label: "SECOP",
      kind: "mcp",
      endpoint: "https://mcp.public.dev/mcp",
      authMode: "none",
      readOnlyTools: ["buscar_licitaciones"],
    }),
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const output = await make()(request);
  expect(output).toMatchObject({
    data: [{ id: "source_1" }],
    page: 1,
    perPage: 20,
  });
  expect(calls.at(-1)).toMatchObject({
    name: "buscar_licitaciones",
    arguments: { q: "software", limit: 20, offset: 0 },
  });
  const before = calls.length;
  await expect(
    make()({
      ...request,
      input: { tool: "write", endpoint: "https://evil.dev", q: "software" },
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    make()({ ...request, tenantId: "other-tenant" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    make("other")({ ...request, principalId: "other" }),
  ).rejects.toMatchObject({ status: 404 });
  expect(calls).toHaveLength(before);
});
