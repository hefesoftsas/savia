import { z } from "@hono/zod-openapi";
import type { ExtensionOptions } from "@savia/studio-server/extensions";
import {
  createMcpSourceService,
  type McpSourceRow,
} from "./mcp-source-service";
import { executeMcpList, McpAdapterError } from "./mcp-adapter";

export type McpActionSourceRevision = {
  config: string;
  encrypted_secret: string | null;
  created_at: string;
};

/** Fixed declarative read tools use the caller's encrypted source, never plugin credentials. */
export function createMcpPluginActionExecutor(options: {
  db: D1Database;
  tenant: string;
  principalId: string;
  integrationKey?: string;
  fetcher?: typeof fetch;
  /** Internal commit fence; encrypted values must never leave the server. */
  onSourceUsed?: (revision: McpActionSourceRevision) => void;
}): NonNullable<ExtensionOptions["executeMcpAction"]> {
  const { db, tenant, principalId, integrationKey, fetcher } = options;
  const sources = createMcpSourceService(options);
  return async (request) => {
    if (request.tenantId !== tenant || request.principalId !== principalId)
      throw new McpAdapterError(
        403,
        "MCP action context does not match the authenticated caller.",
      );
    const scalar = z
      .union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()])
      .optional();
    const schema = z
      .object({
        ...Object.fromEntries(
          request.action.inputArguments.map((name) => [name, scalar]),
        ),
        page: z.number().int().min(1).max(100000).default(1),
        perPage: z.number().int().min(1).max(100).default(20),
      })
      .strict();
    const parsed = schema.safeParse(request.input);
    if (!parsed.success)
      throw new McpAdapterError(
        422,
        "Use only the declared MCP search fields and valid pagination values.",
      );
    const { page, perPage, ...argumentsInput } = parsed.data;
    const source = await db
      .prepare(
        "SELECT id,kind,config,encrypted_secret,created_at FROM studio_collection_sources WHERE tenant_id=? AND owner_principal_id=? AND id=?",
      )
      .bind(tenant, principalId, request.action.sourceId)
      .first<McpSourceRow & McpActionSourceRevision>();
    if (!source || source.kind !== "mcp")
      throw new McpAdapterError(
        404,
        "Authorize the configured MCP source in Sources and collections first.",
      );
    const args = Object.fromEntries(
      Object.entries(argumentsInput).filter(
        ([, value]) => value !== undefined && value !== "",
      ),
    );
    const output = await executeMcpList(
      await sources.connection(source),
      request.action.tool,
      {
        ...request.action.mapping,
        arguments: { ...request.action.mapping.arguments, ...args },
      },
      { page, perPage },
      fetcher,
    );
    options.onSourceUsed?.({
      config: source.config,
      encrypted_secret: source.encrypted_secret,
      created_at: source.created_at,
    });
    return output;
  };
}
