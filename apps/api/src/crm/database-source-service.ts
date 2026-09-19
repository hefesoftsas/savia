import {
  databaseConnectionSchema,
  databaseReadSchema,
  databaseMutationSchema,
  databaseFieldInterface,
  deriveDatabaseCapabilities,
  resolveRecordKey,
  DatabaseBridgeError,
  type ResourceMetadata,
  type DatabaseKind,
} from "@savia/crm-shared/database-sources";
import { decryptSecret } from "@savia/crm-server/integrations";
import type { DatabaseBridgeClient } from "./database-bridge";
export type DatabaseSourceRow = {
  id: string;
  kind: DatabaseKind;
  config: string;
  encrypted_secret: string | null;
};
export function createDatabaseSourceService(options: {
  tenant: string;
  principalId: string;
  integrationKey?: string;
  bridge?: DatabaseBridgeClient;
}) {
  const requireBridge = () => {
    if (!options.bridge)
      throw new DatabaseBridgeError(
        "DATABASE_UNAVAILABLE",
        "Database bridge is unavailable.",
        503,
      );
    return options.bridge;
  };
  async function connection(row: DatabaseSourceRow) {
    const { writeEnabled: _writeEnabled, ...config } = JSON.parse(row.config);
    const password = row.encrypted_secret
      ? await decryptSecret(
          row.encrypted_secret,
          options.integrationKey,
          `${JSON.stringify([options.tenant, options.principalId])}:collection-source:${row.id}`,
        )
      : "";
    return databaseConnectionSchema.parse({
      ...config,
      kind: row.kind,
      password,
    });
  }
  async function inspect(row: DatabaseSourceRow, resource: string) {
    return requireBridge().inspect(await connection(row), resource);
  }
  return {
    connection,
    inspect,
    async test(row: DatabaseSourceRow) {
      await requireBridge().testConnection(await connection(row));
    },
    async inspection(row: DatabaseSourceRow, resource?: string) {
      if (!resource) {
        const resources = await requireBridge().listResources(
          await connection(row),
        );
        return {
          tables: resources.map((r) => ({
            table: r.resource,
            kind: r.kind,
            schema: JSON.parse(row.config).schema ?? "",
          })),
        };
      }
      const metadata = await inspect(row, resource);
      return {
        resourceType: resource,
        fields: Object.fromEntries(
          metadata.fields.map((f) => [f.name, databaseFieldInterface(f)]),
        ),
        relationships: {},
        primaryKey: metadata.primaryKey,
        kind: metadata.kind,
        metadata,
        sampled: metadata.sampled,
      };
    },
    async execute(
      row: DatabaseSourceRow,
      config: {
        resource: string;
        idColumn?: string;
        idType?: "string" | "objectId";
        databaseMetadata?: ResourceMetadata;
      },
      fields: Record<string, unknown>,
      operation: string,
      id: string | undefined,
      params: Record<string, string | undefined>,
      body?: Record<string, unknown>,
    ) {
      const bridge = requireBridge();
      const c = await connection(row);
      const columns = Object.keys(fields);
      const metadata = await inspect(row, config.resource);
      const idColumn = resolveRecordKey(metadata, config.idColumn);
      const capabilities = deriveDatabaseCapabilities(
        metadata,
        Boolean(JSON.parse(row.config).writeEnabled),
        idColumn,
      );
      if (
        metadata.kind === "collection" &&
        !metadata.fields.length &&
        config.idType
      ) {
        metadata.idType = config.idType;
        capabilities.read = true;
        capabilities.create = Boolean(JSON.parse(row.config).writeEnabled);
        capabilities.update = capabilities.create;
        capabilities.delete = capabilities.create;
      }
      if (
        !Object.hasOwn(capabilities, operation) ||
        !capabilities[operation as keyof typeof capabilities]
      )
        throw new DatabaseBridgeError(
          "DATABASE_READ_ONLY",
          "This source does not allow the operation.",
          405,
        );
      const common = {
        connection: c,
        resource: config.resource,
        columns,
        idColumn: idColumn ?? config.idColumn,
        idType: config.idType ?? metadata.idType,
      };
      if (["create", "update", "delete"].includes(operation)) {
        if (config.databaseMetadata) {
          for (const name of Object.keys(body ?? {})) {
            const old = config.databaseMetadata.fields.find(
              (f) => f.name === name,
            );
            const live = metadata.fields.find((f) => f.name === name);
            if (
              old &&
              live &&
              (old.nativeType !== live.nativeType ||
                old.generated !== live.generated)
            )
              throw new DatabaseBridgeError(
                "DATABASE_SCHEMA_CHANGED",
                "Field metadata changed. Synchronize before writing.",
                409,
              );
          }
        }
        const values = Object.fromEntries(
          Object.entries(body ?? {}).map(([name, value]) => {
            if (!columns.includes(name))
              throw new DatabaseBridgeError(
                "DATABASE_FIELD",
                `Unknown field ${name}.`,
                422,
              );
            const field = metadata.fields.find((f) => f.name === name);
            if (
              field?.generated ||
              (field && !field.writable) ||
              (operation === "update" && name === common.idColumn)
            )
              throw new DatabaseBridgeError(
                "DATABASE_FIELD",
                `Field ${name} is not writable.`,
                422,
              );
            if (field?.valueType === "json" && typeof value === "string") {
              try {
                return [name, JSON.parse(value)];
              } catch {
                throw new DatabaseBridgeError(
                  "DATABASE_VALUE",
                  `Invalid JSON in ${name}.`,
                  422,
                );
              }
            }
            return [name, value];
          }),
        );
        return bridge.mutate(
          databaseMutationSchema.parse({
            ...common,
            operation,
            ...(operation !== "create" ? { id } : {}),
            ...(operation !== "delete" ? { values } : {}),
          }),
        );
      }
      let filters: unknown[] = [];
      if (params.filters) {
        const parsed = JSON.parse(params.filters);
        if (
          parsed.logic !== "and" ||
          !Array.isArray(parsed.conditions) ||
          parsed.conditions.some(
            (f: any) => f.op !== "eq" || !columns.includes(f.field),
          )
        )
          throw new DatabaseBridgeError(
            "DATABASE_FILTER",
            "Only equality filters on declared fields are supported.",
            422,
          );
        filters = parsed.conditions.map(({ field, op, value }: any) => ({
          field,
          op,
          value,
        }));
      }
      if (params.stage || params.emptyStage || params.trash === "true")
        throw new DatabaseBridgeError(
          "DATABASE_FEATURE",
          "Source does not support stages or trash.",
          422,
        );
      const searchColumns = metadata.fields
        .filter((f) => columns.includes(f.name) && f.valueType === "string")
        .slice(0, 20)
        .map((f) => f.name);
      return bridge.read(
        databaseReadSchema.parse({
          ...common,
          operation,
          id,
          page: Math.max(1, Math.floor(Number(params.page) || 1)),
          perPage: Math.max(1, Math.floor(Number(params.perPage) || 25)),
          sort:
            params.sort === "updated_at"
              ? undefined
              : params.sort === "id"
                ? common.idColumn
                : params.sort,
          order: params.order === "ASC" ? "ASC" : "DESC",
          filters,
          search: params.q,
          searchColumns,
        }),
      );
    },
  };
}
