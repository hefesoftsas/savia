import { z } from "@hono/zod-openapi";
import {
  databaseResourcesSchema,
  resourceMetadataSchema,
  databaseResultSchema,
  DatabaseBridgeError,
  type DatabaseConnection,
  type DatabaseRead,
  type DatabaseMutation,
  type DatabaseResult,
  type ResourceMetadata,
} from "@savia/studio-shared/database-sources";
export type DatabaseBridgeClient = {
  testConnection(c: DatabaseConnection): Promise<void>;
  listResources(
    c: DatabaseConnection,
  ): Promise<z.infer<typeof databaseResourcesSchema>>;
  inspect(c: DatabaseConnection, resource: string): Promise<ResourceMetadata>;
  read(input: DatabaseRead): Promise<DatabaseResult>;
  mutate(input: DatabaseMutation): Promise<DatabaseResult>;
};
export function createDatabaseBridgeClient(config: {
  baseUrl: string;
  secret: string;
  fetcher?: typeof fetch;
}): DatabaseBridgeClient {
  const base = config.baseUrl.replace(/\/$/, "");
  if (!/^https?:\/\//.test(base))
    throw new DatabaseBridgeError(
      "DATABASE_CONFIG",
      "Invalid bridge URL.",
      503,
    );
  async function post<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    mutation = false,
  ): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      let response: Response;
      try {
        response = await (config.fetcher ?? fetch)(`${base}/database/${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.secret}`,
          },
          body: JSON.stringify(body),
          redirect: "manual",
          signal: abort.signal,
        });
      } catch {
        throw new DatabaseBridgeError(
          "DATABASE_UNAVAILABLE",
          "Database response unavailable. Refresh before repeating a write.",
          abort.signal.aborted ? 504 : 502,
          mutation ? "unknown" : undefined,
        );
      }
      if (
        response.redirected ||
        (response.status >= 300 && response.status < 400)
      )
        throw new DatabaseBridgeError(
          "DATABASE_REDIRECT",
          mutation
            ? "Bridge redirect rejected. Refresh before repeating a write."
            : "Bridge redirect rejected.",
          502,
          mutation ? "unknown" : undefined,
        );
      const raw = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        const status = (
          [403, 404, 405, 409, 422, 503, 504].includes(response.status)
            ? response.status
            : 502
        ) as DatabaseBridgeError["status"];
        throw new DatabaseBridgeError(
          typeof raw?.code === "string" && /^DATABASE_[A-Z_]+$/.test(raw.code)
            ? raw.code
            : "DATABASE_UPSTREAM",
          mutation && (raw?.outcome === "unknown" || status >= 500)
            ? "The write outcome is unknown. Refresh before repeating a write."
            : status === 409
              ? "The database rejected a conflicting value."
              : status === 404
                ? "Record or resource not found."
                : status === 403
                  ? "The database account denied the operation."
                  : status === 422
                    ? "The database rejected a field value."
                    : "The database operation could not be completed.",
          status,
          raw?.outcome === "unknown"
            ? "unknown"
            : mutation && status >= 500
              ? "unknown"
              : undefined,
        );
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success)
        throw new DatabaseBridgeError(
          "DATABASE_RESPONSE",
          mutation
            ? "Invalid database response. Refresh before repeating a write."
            : "Invalid database response.",
          502,
          mutation ? "unknown" : undefined,
        );
      return parsed.data;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    testConnection: async (connection) => {
      await post("test", { connection }, z.object({ ok: z.literal(true) }));
    },
    listResources: (connection) =>
      post("resources", { connection }, databaseResourcesSchema),
    inspect: (connection, resource) =>
      post("inspect", { connection, resource }, resourceMetadataSchema),
    read: (input) => post("read", input, databaseResultSchema),
    mutate: (input) => post("mutate", input, databaseResultSchema, true),
  };
}
