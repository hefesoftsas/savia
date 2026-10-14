import { describe, expect, it, vi } from "vitest";
import {
  createMcpConnection,
  executeMcpList,
  inspectMcpTool,
  listMcpTools,
  McpAdapterError,
  secureMcpFetch,
} from "../src/studio/mcp-adapter";
import { mcpMappingSchema } from "@savia/studio-shared/mcp-sources";

const endpoint = "https://catalog.savia.dev/mcp";
const mapping = {
  arguments: {},
  itemsPointer: "/data",
  idField: "key",
};
const defaultTools = [
  {
    name: "list_items",
    description: "Read items",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer" },
        offset: { type: "number" },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "delete_item",
    description: "Delete an item",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: false },
  },
  {
    name: "browse_unannotated",
    description: "Read an approved legacy tool",
    inputSchema: { type: "object", properties: {} },
  },
];

function fixture(
  result: unknown = {
    structuredContent: {
      data: [
        { key: 1, name: "sample", enabled: true },
        { key: 2, name: "another", enabled: false },
      ],
    },
  },
  options: {
    dnsAddress?: string;
    redirect?: boolean;
    large?: boolean;
    tools?: typeof defaultTools;
    toolPages?: Array<{ tools: typeof defaultTools; nextCursor?: string }>;
  } = {},
) {
  const calls: Array<{ url: URL; init?: RequestInit; body?: any }> = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.hostname === "cloudflare-dns.com") {
        calls.push({ url, init });
        return Response.json({
          Status: 0,
          Answer:
            url.searchParams.get("type") === "A"
              ? [{ type: 1, data: options.dnsAddress ?? "8.8.8.8" }]
              : [],
        });
      }
      let body: any;
      try {
        body = JSON.parse(String(init?.body ?? "{}"));
      } catch {
        body = {};
      }
      calls.push({ url, init, body });
      if (options.redirect)
        return new Response(null, {
          status: 302,
          headers: { location: "https://other.savia.dev/mcp" },
        });
      if (options.large)
        return new Response("x".repeat(1_048_577), {
          headers: { "content-type": "application/json" },
        });
      if (body.method === "initialize")
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1.0" },
          },
        });
      if (body.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      if (body.method === "tools/list") {
        const listIndex =
          calls.filter((call) => call.body?.method === "tools/list").length - 1;
        const toolPage = options.toolPages?.[listIndex];
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: toolPage ?? { tools: options.tools ?? defaultTools },
        });
      }
      if (body.method === "tools/call") {
        const toolResult =
          typeof result === "function" ? result(body.params) : result;
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result:
            toolResult &&
            typeof toolResult === "object" &&
            "content" in toolResult
              ? toolResult
              : { content: [], ...toolResult },
        });
      }
      throw new Error(`Unexpected MCP method: ${body.method}`);
    },
  ) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("MCP collection adapter", () => {
  it("validates mapping defaults and pagination argument names", () => {
    expect(mcpMappingSchema.parse({ idField: "id" })).toEqual({
      arguments: {},
      itemsPointer: "",
      idField: "id",
    });
    expect(
      mcpMappingSchema.safeParse({
        idField: "id",
        pagination: { limitArgument: "limit", offsetArgument: "offset" },
      }).success,
    ).toBe(true);
    expect(mcpMappingSchema.safeParse({ idField: "__proto__" }).success).toBe(
      false,
    );
    expect(mcpMappingSchema.safeParse({ idField: "" }).success).toBe(false);
    expect(mcpMappingSchema.safeParse({ idField: ":id" }).success).toBe(true);
    expect(
      mcpMappingSchema.safeParse({
        idField: "id",
        pagination: { limitArgument: "page", offsetArgument: "page" },
      }).success,
    ).toBe(false);
    expect(
      mcpMappingSchema.safeParse({ idField: "id", itemsPointer: "/data/~2x" })
        .success,
    ).toBe(false);
  });

  it("initializes through the SDK, lists only explicit read-only tools, and closes", async () => {
    const f = fixture();
    const client = await createMcpConnection({ endpoint }, f.fetcher);
    try {
      expect(await listMcpTools(client)).toEqual([
        expect.objectContaining({
          name: "list_items",
          description: "Read items",
          annotations: { readOnlyHint: true },
        }),
      ]);
      expect(f.calls.some((call) => call.body?.method === "initialize")).toBe(
        true,
      );
      expect(
        f.calls
          .filter((call) => call.body?.method === "tools/list")
          .every((call) => call.init?.signal instanceof AbortSignal),
      ).toBe(true);
      expect(f.calls.every((call) => call.init?.redirect === "manual")).toBe(
        true,
      );
    } finally {
      await client.close();
    }
  });

  it("infers field types from a sample without returning sample values", async () => {
    const f = fixture();
    const inspected = await inspectMcpTool(
      { endpoint },
      "list_items",
      mapping,
      f.fetcher,
    );
    expect(inspected).toMatchObject({
      tool: "list_items",
      readOnly: true,
      fields: {
        key: { type: "Number", label: "Key", readOnly: true },
        id: { type: "Textbox", label: "Id", readOnly: true },
        name: { type: "Textbox", label: "Name", readOnly: true },
        enabled: { type: "Toggle", label: "Enabled", readOnly: true },
      },
    });
    expect(JSON.stringify(inspected)).not.toContain("sample");
    expect(f.calls.some((call) => call.body?.method === "tools/call")).toBe(
      true,
    );
    expect(
      f.calls
        .filter((call) => call.body?.method === "tools/call")
        .every((call) => call.init?.signal instanceof AbortSignal),
    ).toBe(true);
  });

  it("normalizes a Socrata :id key and exposes only safe Studio fields", async () => {
    const f = fixture({
      structuredContent: {
        data: [
          {
            ":id": "row-1",
            id_del_proceso: "award-7",
            tenant_id: "tenant-a",
            type: "award",
          },
        ],
      },
    });
    const mappingWithSocrataId = { ...mapping, idField: ":id" };
    const inspected = await inspectMcpTool(
      { endpoint },
      "list_items",
      mappingWithSocrataId,
      f.fetcher,
    );
    expect(inspected.fields).toEqual({
      id: { type: "Textbox", label: "Id", readOnly: true },
      id_del_proceso: {
        type: "Textbox",
        label: "Id Del Proceso",
        readOnly: true,
      },
    });
    const listed = await executeMcpList(
      { endpoint },
      "list_items",
      mappingWithSocrataId,
      { page: 1, perPage: 10 },
      f.fetcher,
    );
    expect(listed.data[0]).toMatchObject({ ":id": "row-1", id: "row-1" });
  });

  it("executes a read-only list call, applies configured pagination, and normalizes IDs", async () => {
    const f = fixture({
      structuredContent: { data: [{ key: 7, name: "seven" }] },
    });
    const result = await executeMcpList(
      { endpoint },
      "list_items",
      {
        ...mapping,
        arguments: { active: true },
        pagination: { limitArgument: "limit", offsetArgument: "offset" },
      },
      { page: 3, perPage: 10 },
      f.fetcher,
    );
    expect(result).toEqual({
      data: [{ key: 7, name: "seven", id: "7" }],
      page: 3,
      perPage: 10,
      hasNext: false,
    });
    const call = f.calls.find((entry) => entry.body?.method === "tools/call")!;
    expect(call.body.params).toEqual({
      name: "list_items",
      arguments: { active: true, limit: 10, offset: 20 },
    });
  });

  it("locally pages the current bounded result when remote pagination is not configured", async () => {
    const f = fixture({
      structuredContent: {
        data: [
          { key: 1, name: "one" },
          { key: 2, name: "two" },
          { key: 3, name: "three" },
        ],
      },
    });
    const secondPage = await executeMcpList(
      { endpoint },
      "list_items",
      mapping,
      { page: 2, perPage: 1 },
      f.fetcher,
    );
    expect(secondPage).toEqual({
      data: [{ key: 2, name: "two", id: "2" }],
      page: 2,
      perPage: 1,
      hasNext: true,
    });
    const lastPage = await executeMcpList(
      { endpoint },
      "list_items",
      mapping,
      { page: 3, perPage: 1 },
      f.fetcher,
    );
    expect(lastPage).toEqual({
      data: [{ key: 3, name: "three", id: "3" }],
      page: 3,
      perPage: 1,
      hasNext: false,
    });
    expect(
      f.calls
        .filter((call) => call.body?.method === "tools/call")
        .map((call) => call.body.params.arguments),
    ).toEqual([{}, {}]);
  });

  it("uses only explicitly allowlisted tools when a server omits read-only annotations", async () => {
    const f = fixture();
    const client = await createMcpConnection({ endpoint }, f.fetcher);
    try {
      expect(
        (await listMcpTools(client, ["browse_unannotated"])).map(
          (tool) => tool.name,
        ),
      ).toEqual(["list_items", "browse_unannotated"]);
      expect(
        (await listMcpTools(client, ["delete_item"])).map((tool) => tool.name),
      ).toEqual(["list_items"]);
    } finally {
      await client.close();
    }

    const allowedCall = await executeMcpList(
      { endpoint, readOnlyTools: ["browse_unannotated"] },
      "browse_unannotated",
      mapping,
      { page: 1, perPage: 10 },
      f.fetcher,
    );
    expect(allowedCall.data).toHaveLength(2);

    await expect(
      executeMcpList(
        { endpoint, readOnlyTools: ["delete_item"] },
        "delete_item",
        mapping,
        { page: 1, perPage: 10 },
        f.fetcher,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("validates remote pagination argument names and numeric input schema types", async () => {
    const cases = [
      {
        properties: {
          limit: { type: "integer" },
          offset: { type: "integer" },
        },
        mapping: {
          ...mapping,
          pagination: { limitArgument: "limit", offsetArgument: "misspelled" },
        },
      },
      {
        properties: {
          limit: { type: "string" },
          offset: { type: "integer" },
        },
        mapping: {
          ...mapping,
          pagination: { limitArgument: "limit", offsetArgument: "offset" },
        },
      },
      {
        properties: {
          limit: { type: ["integer", "string"] },
          offset: { type: "integer" },
        },
        mapping: {
          ...mapping,
          pagination: { limitArgument: "limit", offsetArgument: "offset" },
        },
      },
    ];
    for (const testCase of cases) {
      const f = fixture(
        { structuredContent: { data: [] } },
        {
          tools: [
            {
              ...defaultTools[0],
              inputSchema: {
                type: "object",
                properties: testCase.properties,
              },
            },
          ],
        },
      );
      await expect(
        executeMcpList(
          { endpoint },
          "list_items",
          testCase.mapping,
          { page: 1, perPage: 10 },
          f.fetcher,
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(f.calls.some((call) => call.body?.method === "tools/call")).toBe(
        false,
      );
    }
  });

  it("bounds discovery pages and rejects a repeated cursor", async () => {
    const f = fixture(undefined, {
      toolPages: [
        { tools: defaultTools, nextCursor: "same-cursor" },
        { tools: defaultTools, nextCursor: "same-cursor" },
      ],
    });
    const client = await createMcpConnection({ endpoint }, f.fetcher);
    try {
      await expect(listMcpTools(client)).rejects.toMatchObject({ status: 502 });
      expect(
        f.calls.filter((call) => call.body?.method === "tools/list"),
      ).toHaveLength(2);
    } finally {
      await client.close();
    }
  });

  it("caps raw tool count and discovery page count", async () => {
    const tooManyTools = fixture(undefined, {
      tools: Array.from({ length: 1001 }, (_, index) => ({
        ...defaultTools[0],
        name: `tool_${index}`,
      })) as typeof defaultTools,
    });
    const client = await createMcpConnection(
      { endpoint },
      tooManyTools.fetcher,
    );
    try {
      await expect(listMcpTools(client)).rejects.toMatchObject({ status: 502 });
    } finally {
      await client.close();
    }

    const tooManyPages = fixture(undefined, {
      toolPages: Array.from({ length: 21 }, (_, index) => ({
        tools: [defaultTools[0]],
        nextCursor: `cursor_${index + 1}`,
      })) as Array<{ tools: typeof defaultTools; nextCursor?: string }>,
    });
    const pagedClient = await createMcpConnection(
      { endpoint },
      tooManyPages.fetcher,
    );
    try {
      await expect(listMcpTools(pagedClient)).rejects.toMatchObject({
        status: 502,
      });
      expect(
        tooManyPages.calls.filter((call) => call.body?.method === "tools/list"),
      ).toHaveLength(20);
    } finally {
      await pagedClient.close();
    }
  });

  it("rejects sample records without stable unique IDs", async () => {
    const f = fixture({
      structuredContent: { data: [{ key: 1 }, { key: "1" }] },
    });
    await expect(
      inspectMcpTool({ endpoint }, "list_items", mapping, f.fetcher),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("releases the secure OAuth fetch timeout after its response body is consumed", async () => {
    vi.useFakeTimers();
    try {
      const oauthFetcher = secureMcpFetch(async (input) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        if (url.hostname === "cloudflare-dns.com")
          return Response.json({
            Status: 0,
            Answer:
              url.searchParams.get("type") === "A"
                ? [{ type: 1, data: "8.8.8.8" }]
                : [],
          });
        return Response.json({ token: "test" });
      });
      const response = await oauthFetcher(
        "https://catalog.savia.dev/oauth/token",
      );
      await response.json();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects mutating or unannotated tools before calling them", async () => {
    const f = fixture();
    await expect(
      executeMcpList(
        { endpoint },
        "delete_item",
        mapping,
        { page: 1, perPage: 10 },
        f.fetcher,
      ),
    ).rejects.toBeInstanceOf(McpAdapterError);
    expect(f.calls.some((call) => call.body?.method === "tools/call")).toBe(
      false,
    );
  });

  it("parses a single JSON text block and rejects malformed results and duplicate IDs", async () => {
    const textResult = fixture({
      content: [{ type: "text", text: '{"data":[{"key":"a"}]}' }],
    });
    await expect(
      executeMcpList(
        { endpoint },
        "list_items",
        mapping,
        { page: 1, perPage: 10 },
        textResult.fetcher,
      ),
    ).resolves.toMatchObject({ data: [{ key: "a", id: "a" }] });

    const malformed = fixture({
      content: [{ type: "text", text: "not json" }],
    });
    await expect(
      executeMcpList(
        { endpoint },
        "list_items",
        mapping,
        { page: 1, perPage: 10 },
        malformed.fetcher,
      ),
    ).rejects.toMatchObject({ status: 502 });

    const duplicate = fixture({
      structuredContent: { data: [{ key: 1 }, { key: "1" }] },
    });
    await expect(
      executeMcpList(
        { endpoint },
        "list_items",
        mapping,
        { page: 1, perPage: 10 },
        duplicate.fetcher,
      ),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("blocks private DNS, redirects, and oversized responses", async () => {
    const privateDns = fixture(undefined, { dnsAddress: "10.0.0.1" });
    await expect(
      createMcpConnection({ endpoint }, privateDns.fetcher),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      privateDns.calls.some(
        (call) => call.url.hostname === "catalog.savia.dev",
      ),
    ).toBe(false);

    const redirected = fixture(undefined, { redirect: true });
    await expect(
      createMcpConnection({ endpoint }, redirected.fetcher),
    ).rejects.toMatchObject({ status: 502 });

    const large = fixture(undefined, { large: true });
    await expect(
      createMcpConnection({ endpoint }, large.fetcher),
    ).rejects.toMatchObject({ status: 502 });
  });
});
