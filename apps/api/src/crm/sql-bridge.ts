import {
  bridgeIntrospectColumnsResultSchema,
  bridgeIntrospectTablesResultSchema,
  bridgeQueryResultSchema,
  type BridgeIntrospectColumnsResult,
  type BridgeQuery,
  type BridgeQueryResult,
  type BridgeTable,
  type PostgresConnection,
} from "@savia/crm-shared/sql-sources";

export type BridgeConnectionWithPassword = PostgresConnection & {
  password: string;
};

export class SqlBridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 404 | 405 | 409 | 422 | 502 | 503 | 504 = 502,
  ) {
    super(message);
    this.name = "SqlBridgeError";
  }
}

function fail(
  code: string,
  message: string,
  status: SqlBridgeError["status"] = 502,
): never {
  throw new SqlBridgeError(code, message, status);
}

export type SqlBridgeClient = {
  listTables(connection: BridgeConnectionWithPassword): Promise<BridgeTable[]>;
  getColumns(
    connection: BridgeConnectionWithPassword,
    table: string,
  ): Promise<BridgeIntrospectColumnsResult>;
  query(input: BridgeQuery): Promise<BridgeQueryResult>;
};

export type SqlBridgeConfig = {
  baseUrl: string;
  secret: string;
  fetcher?: typeof fetch;
};

export type SqlBridgeSecrets = {
  SQL_BRIDGE_URL?: string;
  SQL_BRIDGE_SECRET?: string;
};

/** Puente SQL (apps/db-bridge). Sin URL/secreto, Postgres externo responde 503. */
export function sqlBridgeFromEnvironment(
  environment: SqlBridgeSecrets,
): SqlBridgeClient | undefined {
  const baseUrl = environment.SQL_BRIDGE_URL?.trim();
  const secret = environment.SQL_BRIDGE_SECRET?.trim();
  if (!baseUrl || !secret) return undefined;
  return createSqlBridgeClient({ baseUrl, secret });
}

/**
 * Cliente HTTP hacia apps/db-bridge. La URL y el secreto son configuración
 * del servidor (SQL_BRIDGE_URL / SQL_BRIDGE_SECRET), nunca entrada de usuario.
 */
export function createSqlBridgeClient(
  config: SqlBridgeConfig,
): SqlBridgeClient {
  const base = config.baseUrl.replace(/\/$/, "");
  if (!/^https?:\/\//.test(base))
    throw new SqlBridgeError(
      "SQL_BRIDGE_MISCONFIGURED",
      "Puente SQL sin URL válida.",
      503,
    );
  const fetcher = config.fetcher ?? fetch;

  async function post<T>(
    path: string,
    body: unknown,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      let response: Response;
      try {
        response = await fetcher(`${base}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.secret}`,
          },
          body: JSON.stringify(body),
          redirect: "manual",
          signal: controller.signal,
        });
      } catch {
        return fail(
          "SQL_BRIDGE_UNAVAILABLE",
          "No se pudo conectar con el puente SQL.",
          controller.signal.aborted ? 504 : 502,
        );
      }
      if (
        response.redirected ||
        (response.status >= 300 && response.status < 400)
      ) {
        void response.body?.cancel().catch(() => {});
        return fail(
          "SQL_BRIDGE_REDIRECT",
          "El puente SQL intentó redirigir.",
          502,
        );
      }
      if (response.status === 401 || response.status === 403)
        return fail(
          "SQL_BRIDGE_FORBIDDEN",
          "El puente SQL rechazó la operación.",
          502,
        );
      if (response.status === 404)
        return fail("SQL_NOT_FOUND", "No encontrado en la base externa.", 404);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        return fail(
          "SQL_BRIDGE_UPSTREAM",
          "La base externa rechazó la operación.",
        );
      }
      const raw = await response.json().catch(() => undefined);
      try {
        return parse(raw);
      } catch {
        return fail(
          "SQL_BRIDGE_RESPONSE",
          "Respuesta inválida del puente SQL.",
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    listTables: (connection) =>
      post("/introspect", { connection }, (value) => {
        const parsed = bridgeIntrospectTablesResultSchema.parse(value);
        return parsed.tables;
      }),
    getColumns: (connection, table) =>
      post("/introspect", { connection, table }, (value) =>
        bridgeIntrospectColumnsResultSchema.parse(value),
      ),
    query: (input) =>
      post("/query", input, (value) => bridgeQueryResultSchema.parse(value)),
  };
}
