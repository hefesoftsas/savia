import { Surreal } from "surrealdb";
import {
  archiveSnapshot,
  cleanupLegacyObjects,
  type ArchiveBucket,
  type KvSource,
  type LegacyStore,
  type ObjectSource,
} from "./archive";

type SurrealConfiguration = {
  database: string;
  name: string;
  namespace: string;
  password: string;
  url: string;
  username: string;
};

export type LegacyExporterEnvironment = {
  ARCHIVE: ArchiveBucket;
  LEGACY_EXPORT_BEARER: string;
  LEGACY_VERIFIED_SNAPSHOT_ID?: string;
  SURREAL_CORE_DATABASE?: string;
  SURREAL_CORE_NAMESPACE?: string;
  SURREAL_CORE_PASSWORD?: string;
  SURREAL_CORE_URL?: string;
  SURREAL_CORE_USERNAME?: string;
  SURREAL_LEGACY_QUOTES_DATABASE?: string;
  SURREAL_LEGACY_QUOTES_NAMESPACE?: string;
  SURREAL_LEGACY_QUOTES_PASSWORD?: string;
  SURREAL_LEGACY_QUOTES_URL?: string;
  SURREAL_LEGACY_QUOTES_USERNAME?: string;
  LEGACY_R2_DEVELOP?: R2Bucket;
  LEGACY_R2_PRODUCTION?: R2Bucket;
  LEGACY_R2_QA?: R2Bucket;
  LEGACY_KV_OAUTH_DEVELOP?: KVNamespace;
  LEGACY_KV_OAUTH_PRODUCTION?: KVNamespace;
  LEGACY_KV_OAUTH_QA?: KVNamespace;
  LEGACY_KV_QUOTE_CACHE_DEVELOP?: KVNamespace;
  LEGACY_KV_QUOTE_CACHE_PRODUCTION?: KVNamespace;
  LEGACY_KV_QUOTE_CACHE_QA?: KVNamespace;
  LEGACY_KV_SESSIONS_DEVELOP?: KVNamespace;
  LEGACY_KV_SESSIONS_PRODUCTION?: KVNamespace;
  LEGACY_KV_SESSIONS_QA?: KVNamespace;
  LEGACY_KV_SYSTEM_CONTROL_DEVELOP?: KVNamespace;
  LEGACY_KV_SYSTEM_CONTROL_PRODUCTION?: KVNamespace;
  LEGACY_KV_SYSTEM_CONTROL_QA?: KVNamespace;
};

type ExporterDependencies = {
  stores: () => LegacyStore[];
  objectSources: ObjectSource[];
  kvSources: KvSource[];
};

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

class SurrealLegacyStore implements LegacyStore {
  private constructor(
    readonly name: string,
    private readonly database: Surreal,
  ) {}

  static async connect(
    configuration: SurrealConfiguration,
  ): Promise<LegacyStore> {
    const database = new Surreal();
    await database.connect(configuration.url);
    await database.signin({
      namespace: configuration.namespace,
      database: configuration.database,
      username: configuration.username,
      password: configuration.password,
    });
    await database.use({
      namespace: configuration.namespace,
      database: configuration.database,
    });
    return new SurrealLegacyStore(configuration.name, database);
  }

  async listTables(): Promise<string[]> {
    const [info] = await this.database
      .query("INFO FOR DB;")
      .collect<[unknown]>();
    const tables =
      info && typeof info === "object" && "tables" in info
        ? (info as { tables?: unknown }).tables
        : undefined;
    return tables && typeof tables === "object" && !Array.isArray(tables)
      ? Object.keys(tables as Record<string, unknown>).sort()
      : [];
  }

  async selectPage(
    table: string,
    paging: { limit: number; start: number },
  ): Promise<unknown[]> {
    const [rows] = await this.database
      .query(
        "SELECT * FROM type::table($table) ORDER BY id LIMIT $limit START $start;",
        { table, limit: paging.limit, start: paging.start },
      )
      .collect<[unknown]>();
    return Array.isArray(rows) ? rows : [];
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}

function sourceIfPresent(
  name: string,
  bucket: R2Bucket | undefined,
): ObjectSource[] {
  return bucket ? [{ name, bucket: bucket as unknown as ArchiveBucket }] : [];
}

function kvIfPresent(
  name: string,
  namespace: KVNamespace | undefined,
): KvSource[] {
  return namespace
    ? [{ name, namespace: namespace as unknown as KvSource["namespace"] }]
    : [];
}

function objectSources(environment: LegacyExporterEnvironment): ObjectSource[] {
  return [
    ...sourceIfPresent(
      "savia-documents-develop",
      environment.LEGACY_R2_DEVELOP,
    ),
    ...sourceIfPresent(
      "savia-documents-production",
      environment.LEGACY_R2_PRODUCTION,
    ),
    ...sourceIfPresent("savia-documents-qa", environment.LEGACY_R2_QA),
  ];
}

function kvSources(environment: LegacyExporterEnvironment): KvSource[] {
  return [
    ...kvIfPresent("savia-oauth-develop", environment.LEGACY_KV_OAUTH_DEVELOP),
    ...kvIfPresent(
      "savia-oauth-production",
      environment.LEGACY_KV_OAUTH_PRODUCTION,
    ),
    ...kvIfPresent("savia-oauth-qa", environment.LEGACY_KV_OAUTH_QA),
    ...kvIfPresent(
      "savia-quote-api-cache-develop",
      environment.LEGACY_KV_QUOTE_CACHE_DEVELOP,
    ),
    ...kvIfPresent(
      "savia-quote-api-cache-production",
      environment.LEGACY_KV_QUOTE_CACHE_PRODUCTION,
    ),
    ...kvIfPresent(
      "savia-quote-api-cache-qa",
      environment.LEGACY_KV_QUOTE_CACHE_QA,
    ),
    ...kvIfPresent(
      "savia-sessions-develop",
      environment.LEGACY_KV_SESSIONS_DEVELOP,
    ),
    ...kvIfPresent(
      "savia-sessions-production",
      environment.LEGACY_KV_SESSIONS_PRODUCTION,
    ),
    ...kvIfPresent("savia-sessions-qa", environment.LEGACY_KV_SESSIONS_QA),
    ...kvIfPresent(
      "savia-system-control-develop",
      environment.LEGACY_KV_SYSTEM_CONTROL_DEVELOP,
    ),
    ...kvIfPresent(
      "savia-system-control-production",
      environment.LEGACY_KV_SYSTEM_CONTROL_PRODUCTION,
    ),
    ...kvIfPresent(
      "savia-system-control-qa",
      environment.LEGACY_KV_SYSTEM_CONTROL_QA,
    ),
  ];
}

function stores(environment: LegacyExporterEnvironment): () => LegacyStore[] {
  const configurations: SurrealConfiguration[] = [
    {
      name: "core",
      url: required(environment.SURREAL_CORE_URL, "SURREAL_CORE_URL"),
      namespace: required(
        environment.SURREAL_CORE_NAMESPACE,
        "SURREAL_CORE_NAMESPACE",
      ),
      database: required(
        environment.SURREAL_CORE_DATABASE,
        "SURREAL_CORE_DATABASE",
      ),
      username: required(
        environment.SURREAL_CORE_USERNAME,
        "SURREAL_CORE_USERNAME",
      ),
      password: required(
        environment.SURREAL_CORE_PASSWORD,
        "SURREAL_CORE_PASSWORD",
      ),
    },
    {
      name: "legacy-quotes",
      url: required(
        environment.SURREAL_LEGACY_QUOTES_URL,
        "SURREAL_LEGACY_QUOTES_URL",
      ),
      namespace: required(
        environment.SURREAL_LEGACY_QUOTES_NAMESPACE,
        "SURREAL_LEGACY_QUOTES_NAMESPACE",
      ),
      database: required(
        environment.SURREAL_LEGACY_QUOTES_DATABASE,
        "SURREAL_LEGACY_QUOTES_DATABASE",
      ),
      username: required(
        environment.SURREAL_LEGACY_QUOTES_USERNAME,
        "SURREAL_LEGACY_QUOTES_USERNAME",
      ),
      password: required(
        environment.SURREAL_LEGACY_QUOTES_PASSWORD,
        "SURREAL_LEGACY_QUOTES_PASSWORD",
      ),
    },
  ];
  return () =>
    configurations.map((configuration) => {
      let connection: Promise<LegacyStore> | undefined;
      return {
        name: configuration.name,
        listTables: async () => {
          connection ??= SurrealLegacyStore.connect(configuration);
          return (await connection).listTables();
        },
        selectPage: async (table, paging) => {
          connection ??= SurrealLegacyStore.connect(configuration);
          return (await connection).selectPage(table, paging);
        },
        close: async () => {
          if (connection) await (await connection).close();
        },
      };
    });
}

function requestSnapshotId(request: Request): Promise<string> {
  return request.json().then((body: unknown) => {
    const candidate = body as { snapshotId?: unknown } | null;
    if (!candidate || typeof candidate.snapshotId !== "string")
      throw new Response("Bad request", { status: 400 });
    return candidate.snapshotId;
  });
}

function requireBearer(request: Request, expected: string): void {
  if (request.headers.get("authorization") !== `Bearer ${expected}`)
    throw new Response("Not found", { status: 404 });
}

function dependencies(
  environment: LegacyExporterEnvironment,
): ExporterDependencies {
  return {
    stores: stores(environment),
    objectSources: objectSources(environment),
    kvSources: kvSources(environment),
  };
}

export function createLegacyExporter(
  environment: LegacyExporterEnvironment,
  configuredDependencies: ExporterDependencies = dependencies(environment),
) {
  const archive = environment.ARCHIVE;
  return {
    async fetch(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (
        request.method !== "POST" ||
        !["/_internal/legacy-export", "/_internal/legacy-cleanup"].includes(
          path,
        )
      )
        return new Response("Not found", { status: 404 });
      try {
        requireBearer(request, environment.LEGACY_EXPORT_BEARER);
        const snapshotId = await requestSnapshotId(request);
        if (path === "/_internal/legacy-export") {
          const manifest = await archiveSnapshot({
            snapshotId,
            stores: configuredDependencies.stores(),
            archive,
            objectSources: configuredDependencies.objectSources,
            kvSources: configuredDependencies.kvSources,
          });
          return Response.json(
            {
              snapshotId: manifest.snapshotId,
              streamCount: manifest.streams.length,
            },
            { status: 201 },
          );
        }
        if (environment.LEGACY_VERIFIED_SNAPSHOT_ID !== snapshotId)
          return new Response("Verification required", { status: 409 });
        const report = await cleanupLegacyObjects({
          verified: true,
          r2Sources: configuredDependencies.objectSources,
          kvSources: configuredDependencies.kvSources,
        });
        return Response.json({ snapshotId, ...report });
      } catch (exception) {
        if (exception instanceof Response) return exception;
        return new Response("Export failed", { status: 500 });
      }
    },
  };
}

export default {
  fetch(
    request: Request,
    environment: LegacyExporterEnvironment,
  ): Promise<Response> {
    return createLegacyExporter(environment).fetch(request);
  },
};
