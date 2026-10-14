import {
  createMCPClient,
  type MCPClient,
  type OAuthClientProvider,
} from "@ai-sdk/mcp";
import { isPublicAddress } from "@savia/studio-server/integrations";
import {
  mcpMappingSchema,
  type McpFieldType,
  type McpMapping,
  type McpSourceField,
} from "@savia/studio-shared/mcp-sources";
import { validateJsonApiBaseUrl } from "./jsonapi-adapter";

const MAX_BYTES = 1_048_576;
const MAX_PAGE_SIZE = 100;
const TOTAL_TIMEOUT_MS = 15_000;
const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export class McpAdapterError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "McpAdapterError";
  }
}

export type McpConnection = {
  endpoint: string;
  token?: string;
  authProvider?: OAuthClientProvider;
  readOnlyTools?: string[];
};

type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

type Budget = {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  deadlineAt: number;
};

const budgets = new WeakMap<MCPClient, Budget>();

function adapterFail(status: number, message: string): never {
  throw new McpAdapterError(status, message);
}

function validatePublicHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return adapterFail(422, "Enter a valid public HTTPS MCP URL.");
  }
  try {
    // The shared JSON:API validator applies Savia's host and path restrictions.
    // OAuth discovery and token URLs may include query strings, so validate the
    // same URL without the query, then preserve it for the outgoing request.
    validateJsonApiBaseUrl(`${url.origin}${url.pathname}`);
  } catch {
    return adapterFail(
      422,
      "The MCP destination must use public HTTPS on port 443.",
    );
  }
  if (url.username || url.password || url.hash)
    return adapterFail(
      422,
      "The MCP URL cannot contain credentials or a fragment.",
    );
  return url;
}

async function readBoundedJson(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (Number(response.headers.get("content-length") ?? 0) > limit) {
    void response.body?.cancel().catch(() => {});
    adapterFail(502, "The MCP response exceeds the 1 MB limit.");
  }
  const reader = response.body?.getReader();
  if (!reader)
    adapterFail(502, "The MCP destination returned an empty response.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  const abort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        adapterFail(502, "The MCP response exceeds the 1 MB limit.");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return adapterFail(502, "The MCP destination returned invalid JSON.");
  }
}

async function ensurePublicDns(
  url: URL,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<void> {
  const records = await Promise.all(
    ["A", "AAAA"].map(async (type) => {
      const dnsUrl = new URL("https://cloudflare-dns.com/dns-query");
      dnsUrl.searchParams.set("name", url.hostname);
      dnsUrl.searchParams.set("type", type);
      let response: Response;
      try {
        response = await fetcher(dnsUrl, {
          headers: { Accept: "application/dns-json" },
          redirect: "manual",
          signal,
        });
      } catch {
        return adapterFail(
          422,
          "Could not verify public DNS for the MCP destination.",
        );
      }
      if (
        !response.ok ||
        response.redirected ||
        (response.status >= 300 && response.status < 400)
      )
        return adapterFail(
          422,
          "Could not verify public DNS for the MCP destination.",
        );
      const data = await readBoundedJson(response, 16_384, signal);
      if (
        !plain(data) ||
        data.Status !== 0 ||
        (data.Answer !== undefined && !Array.isArray(data.Answer))
      )
        return adapterFail(
          422,
          "Could not verify public DNS for the MCP destination.",
        );
      return ((data.Answer ?? []) as unknown[]).flatMap((answer) =>
        plain(answer) && [1, 28].includes(Number(answer.type))
          ? [answer.data]
          : [],
      );
    }),
  );
  const addresses = records.flat();
  if (
    addresses.length === 0 ||
    addresses.some(
      (address) => typeof address !== "string" || !isPublicAddress(address),
    )
  )
    adapterFail(
      422,
      "The MCP destination must resolve only to public addresses.",
    );
}

function responseWithBoundedBody(response: Response, limit: number): Response {
  if (Number(response.headers.get("content-length") ?? 0) > limit) {
    void response.body?.cancel().catch(() => {});
    adapterFail(502, "The MCP response exceeds the 1 MB limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) return response;
  let size = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          reader.releaseLock();
          return;
        }
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          controller.error(
            new McpAdapterError(
              502,
              "The MCP response exceeds the 1 MB limit.",
            ),
          );
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function responseWithCleanup(
  response: Response,
  cleanup: () => void,
): Response {
  const reader = response.body?.getReader();
  if (!reader) {
    cleanup();
    return response;
  }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          cleanup();
          reader.releaseLock();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        cleanup();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        cleanup();
      }
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function makeSecureFetch(
  fetcher: typeof fetch,
  controller: AbortController,
  endpoint?: URL,
  token?: string,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = validatePublicHttpsUrl(rawUrl);
    if (controller.signal.aborted) throw controller.signal.reason;
    await ensurePublicDns(url, fetcher, controller.signal);

    const requestHeaders = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (
      token &&
      endpoint &&
      url.href === endpoint.href &&
      !requestHeaders.has("authorization")
    )
      requestHeaders.set("authorization", `Bearer ${token}`);
    const body = init?.body;
    if (
      typeof body === "string" &&
      new TextEncoder().encode(body).byteLength > MAX_BYTES
    )
      adapterFail(413, "The MCP request exceeds the 1 MB limit.");
    const signals = [controller.signal, init?.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    );
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        headers: requestHeaders,
        redirect: "manual",
        ...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
      });
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    }
    if (
      response.redirected ||
      (response.status >= 300 && response.status < 400)
    ) {
      void response.body?.cancel().catch(() => {});
      adapterFail(
        502,
        "The MCP destination attempted to redirect the request.",
      );
    }
    return responseWithBoundedBody(response, MAX_BYTES);
  }) as typeof fetch;
}

/** Wrap OAuth or MCP fetches with public DNS, redirect, timeout, and size guards. */
export function secureMcpFetch(fetcher: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new McpAdapterError(504, "The MCP request took too long."),
        ),
      TOTAL_TIMEOUT_MS,
    );
    try {
      const response = await makeSecureFetch(fetcher, controller)(input, init);
      return responseWithCleanup(response, () => clearTimeout(timer));
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }) as typeof fetch;
}

export async function createMcpConnection(
  connection: McpConnection,
  fetcher: typeof fetch = fetch,
): Promise<MCPClient> {
  const endpoint = validateJsonApiBaseUrl(connection.endpoint);
  if (
    connection.token !== undefined &&
    (connection.token.length > 8192 || /[\r\n]/.test(connection.token))
  )
    adapterFail(422, "The MCP credential is invalid.");

  const controller = new AbortController();
  const timeoutError = new McpAdapterError(
    504,
    "The MCP operation exceeded 15 seconds.",
  );
  const deadlineAt = Date.now() + TOTAL_TIMEOUT_MS;
  const timer = setTimeout(
    () => controller.abort(timeoutError),
    TOTAL_TIMEOUT_MS,
  );
  const budget = { controller, timer, deadlineAt };
  const guardedFetch = makeSecureFetch(
    fetcher,
    controller,
    endpoint,
    connection.token,
  );
  try {
    await ensurePublicDns(endpoint, fetcher, controller.signal);
    const client = await createMCPClient({
      transport: {
        type: "http",
        url: endpoint.href,
        fetch: guardedFetch,
        redirect: "error",
        ...(connection.authProvider
          ? { authProvider: connection.authProvider }
          : {}),
      },
      protocolVersionDiscovery: false,
      initializationOptions: {
        timeout: TOTAL_TIMEOUT_MS,
        signal: controller.signal,
      },
      maxRetries: 0,
    });
    budgets.set(client, budget);
    const close = client.close.bind(client);
    client.close = async (...args) => {
      try {
        return await close(...args);
      } finally {
        clearTimeout(timer);
      }
    };
    return client;
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof McpAdapterError) throw error;
    throw new McpAdapterError(502, "Could not initialize the MCP connection.");
  }
}

function requestOptions(client: MCPClient) {
  const budget = budgets.get(client);
  const remaining = budget
    ? Math.max(0, budget.deadlineAt - Date.now())
    : TOTAL_TIMEOUT_MS;
  if (remaining <= 0) {
    const error = new McpAdapterError(
      504,
      "The MCP operation exceeded 15 seconds.",
    );
    if (budget && !budget.controller.signal.aborted)
      budget.controller.abort(error);
    throw budget?.controller.signal.reason ?? error;
  }
  return {
    timeout: remaining,
    maxTotalTimeout: remaining,
    ...(budget ? { signal: budget.controller.signal } : {}),
  };
}

export async function listMcpTools(
  client: MCPClient,
  readOnlyTools: readonly string[] = [],
): Promise<McpTool[]> {
  try {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    let pages = 0;
    do {
      if (pages >= 20)
        adapterFail(502, "The MCP server returned too many tool pages.");
      const page = await client.listTools({
        ...(cursor ? { params: { cursor } } : {}),
        options: requestOptions(client),
      });
      pages += 1;
      tools.push(...page.tools);
      if (tools.length > 1000)
        adapterFail(502, "The MCP server published too many tools.");
      cursor = page.nextCursor;
      if (cursor && seenCursors.has(cursor))
        adapterFail(502, "The MCP server repeated a tool discovery cursor.");
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    const allowlist = new Set(readOnlyTools);
    return tools.filter(
      (tool) =>
        tool.annotations?.readOnlyHint === true ||
        (tool.annotations?.readOnlyHint === undefined &&
          allowlist.has(tool.name)),
    );
  } catch (error) {
    const budget = budgets.get(client);
    if (budget?.controller.signal.aborted)
      throw budget.controller.signal.reason;
    if (error instanceof McpAdapterError) throw error;
    throw new McpAdapterError(502, "Could not list MCP tools.");
  }
}

function validateMapping(mapping: McpMapping): McpMapping {
  const parsed = mcpMappingSchema.safeParse(mapping);
  if (!parsed.success) adapterFail(422, "The MCP mapping is invalid.");
  return parsed.data;
}

function paginationArgs(
  mapping: McpMapping,
  page: number,
  perPage: number,
): { args: Record<string, unknown>; start: number } {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(perPage) ||
    perPage < 1 ||
    perPage > MAX_PAGE_SIZE
  )
    adapterFail(
      422,
      "MCP pagination requires a positive page and a page size of at most 100.",
    );
  const start = (page - 1) * perPage;
  if (!Number.isSafeInteger(start))
    adapterFail(422, "The MCP page offset is out of range.");
  const args = { ...mapping.arguments };
  if (mapping.pagination) {
    const offset = (page - 1) * perPage;
    if (!Number.isSafeInteger(offset))
      adapterFail(422, "The MCP pagination offset is out of range.");
    args[mapping.pagination.limitArgument] = perPage;
    args[mapping.pagination.offsetArgument] = offset;
  }
  return { args, start };
}

function validatePaginationArguments(tool: McpTool, mapping: McpMapping): void {
  if (!mapping.pagination) return;
  const properties = tool.inputSchema.properties;
  if (!plain(properties))
    adapterFail(
      422,
      "The MCP tool schema does not declare pagination arguments.",
    );
  for (const [kind, name] of [
    ["limit", mapping.pagination.limitArgument],
    ["offset", mapping.pagination.offsetArgument],
  ] as const) {
    const property = properties[name];
    if (!plain(property))
      adapterFail(
        422,
        `The configured MCP ${kind} argument is missing from the tool schema.`,
      );
    const type = property.type;
    const types = (Array.isArray(type) ? type : [type]).filter(
      (value) => value !== "null",
    );
    if (
      types.length === 0 ||
      types.some((value) => value !== "integer" && value !== "number")
    )
      adapterFail(
        422,
        `The configured MCP ${kind} argument must have a numeric tool schema.`,
      );
  }
}

function requiredArguments(tool: McpTool, args: Record<string, unknown>): void {
  const required = tool.inputSchema.required;
  if (!Array.isArray(required)) return;
  if (
    required.some(
      (name) => typeof name !== "string" || !Object.hasOwn(args, name),
    )
  )
    adapterFail(422, "Configure every required argument for the MCP tool.");
}

async function readOnlyTool(
  client: MCPClient,
  name: string,
  readOnlyTools: readonly string[] = [],
): Promise<McpTool> {
  const tool = (await listMcpTools(client, readOnlyTools)).find(
    (candidate) => candidate.name === name,
  );
  if (!tool)
    adapterFail(403, "The MCP tool is not explicitly marked read-only.");
  return tool;
}

function pointer(document: unknown, path: string): unknown {
  if (!path) return document;
  let value = document;
  for (const part of path.slice(1).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!plain(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

function parseToolDocument(result: unknown): unknown {
  if (!plain(result))
    adapterFail(502, "The MCP tool returned an invalid result.");
  if (result.isError === true)
    adapterFail(502, "The MCP tool reported an error.");
  if (result.structuredContent !== undefined) return result.structuredContent;
  if (
    !Array.isArray(result.content) ||
    result.content.length !== 1 ||
    !plain(result.content[0]) ||
    result.content[0].type !== "text" ||
    typeof result.content[0].text !== "string"
  )
    adapterFail(
      502,
      "The MCP tool must return structured JSON or one JSON text block.",
    );
  try {
    return JSON.parse(result.content[0].text);
  } catch {
    return adapterFail(502, "The MCP tool returned invalid JSON.");
  }
}

function extractItems(
  result: unknown,
  mapping: McpMapping,
): Record<string, unknown>[] {
  const items = pointer(parseToolDocument(result), mapping.itemsPointer);
  if (!Array.isArray(items))
    adapterFail(
      502,
      "The MCP tool did not return a list at the configured pointer.",
    );
  if (items.some((item) => !plain(item)))
    adapterFail(502, "The MCP tool returned invalid records.");
  return items as Record<string, unknown>[];
}

function normalizedRecords(
  records: Record<string, unknown>[],
  idField: string,
): Record<string, unknown>[] {
  const identifiers = new Set<string>();
  return records.map((record) => {
    for (const key of Object.keys(record))
      if (["__proto__", "constructor", "prototype"].includes(key))
        adapterFail(502, "The MCP tool returned an invalid field.");
    const rawId = record[idField];
    if (
      !["string", "number"].includes(typeof rawId) ||
      (typeof rawId === "number" && !Number.isFinite(rawId))
    )
      adapterFail(
        502,
        "Every MCP record requires a stable string or number identifier.",
      );
    const id = String(rawId);
    if (!id || id.length > 300 || /[\u0000-\u001f\u007f]/.test(id))
      adapterFail(
        502,
        "Every MCP record requires a stable string or number identifier.",
      );
    if (identifiers.has(id))
      adapterFail(502, "The MCP page contains duplicate identifiers.");
    identifiers.add(id);
    return { ...record, id };
  });
}

function fieldType(value: unknown): McpFieldType {
  if (typeof value === "boolean") return "Toggle";
  if (typeof value === "number") return "Number";
  if (Array.isArray(value) || (value !== null && typeof value === "object"))
    return "Textarea";
  return "Textbox";
}

function fieldLabel(key: string): string {
  return key
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function inferFields(
  record: Record<string, unknown> | undefined,
): Record<string, McpSourceField> {
  const reserved = new Set([
    "type",
    "_version",
    "created_at",
    "updated_at",
    "deleted_at",
    "tenant_id",
    "_relationships",
  ]);
  return Object.fromEntries(
    Object.entries(record ?? {})
      .filter(
        ([key]) =>
          /^[a-z][a-z0-9_]{0,47}$/.test(key) &&
          !reserved.has(key) &&
          !["__proto__", "constructor", "prototype"].includes(key),
      )
      .map(([key, value]) => [
        key,
        {
          type: fieldType(value),
          label: fieldLabel(key),
          readOnly: true as const,
        },
      ]),
  );
}

async function withMcpClient<T>(
  connection: McpConnection,
  fetcher: typeof fetch | undefined,
  run: (client: MCPClient) => Promise<T>,
): Promise<T> {
  const client = await createMcpConnection(connection, fetcher);
  try {
    return await run(client);
  } catch (error) {
    const budget = budgets.get(client);
    if (budget?.controller.signal.aborted)
      throw budget.controller.signal.reason;
    if (error instanceof McpAdapterError) throw error;
    throw new McpAdapterError(502, "The MCP tool could not be executed.");
  } finally {
    await client.close().catch(() => {});
  }
}

export async function inspectMcpTool(
  connection: McpConnection,
  toolName: string,
  mappingInput: McpMapping,
  fetcher?: typeof fetch,
): Promise<{
  tool: string;
  description?: string;
  readOnly: true;
  fields: Record<string, McpSourceField>;
}> {
  const mapping = validateMapping(mappingInput);
  return withMcpClient(connection, fetcher, async (client) => {
    const tool = await readOnlyTool(client, toolName, connection.readOnlyTools);
    const args = { ...mapping.arguments };
    if (mapping.pagination) {
      args[mapping.pagination.limitArgument] = 1;
      args[mapping.pagination.offsetArgument] = 0;
    }
    requiredArguments(tool, args);
    validatePaginationArguments(tool, mapping);
    const result = await client.callTool({
      name: toolName,
      arguments: args,
      options: requestOptions(client),
    });
    const sample = normalizedRecords(
      extractItems(result, mapping),
      mapping.idField,
    )[0];
    return {
      tool: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      readOnly: true,
      fields: inferFields(sample),
    };
  });
}

export async function executeMcpList(
  connection: McpConnection,
  toolName: string,
  mappingInput: McpMapping,
  query: { page: number; perPage: number },
  fetcher?: typeof fetch,
): Promise<{
  data: Record<string, unknown>[];
  page: number;
  perPage: number;
  hasNext: boolean | null;
}> {
  const mapping = validateMapping(mappingInput);
  const { args, start } = paginationArgs(mapping, query.page, query.perPage);
  return withMcpClient(connection, fetcher, async (client) => {
    const tool = await readOnlyTool(client, toolName, connection.readOnlyTools);
    validatePaginationArguments(tool, mapping);
    requiredArguments(tool, args);
    const result = await client.callTool({
      name: toolName,
      arguments: args,
      options: requestOptions(client),
    });
    const records = normalizedRecords(
      extractItems(result, mapping),
      mapping.idField,
    );
    if (mapping.pagination && records.length > query.perPage)
      adapterFail(
        502,
        "The MCP tool returned more rows than its configured page size; verify the limit argument mapping.",
      );
    const data = mapping.pagination
      ? records
      : records.slice(start, start + query.perPage);
    return {
      data,
      page: query.page,
      perPage: query.perPage,
      hasNext: mapping.pagination
        ? records.length === query.perPage
        : start + query.perPage < records.length,
    };
  });
}
