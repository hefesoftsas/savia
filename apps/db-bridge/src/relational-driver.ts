import {
  databaseReadSchema,
  databaseMutationSchema,
  resourceMetadataSchema,
  type DatabaseConnection,
  type ResourceMetadata,
  type DatabaseKind,
  type DatabaseResult,
} from "@savia/crm-shared/database-sources";
import type { DatabaseDriver } from "./driver";
import {
  buildDatabaseRead,
  buildDatabaseMutation,
  databaseTable,
  validateMutation,
} from "./database-sql";
import { serializeDatabaseValue } from "./database-values";
import { DatabaseBridgeError, databaseError } from "./database-errors";
export type SqlSession = {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; affected: number }>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): Promise<void>;
};
export type RelationalOptions = {
  kind: DatabaseKind;
  connect(c: DatabaseConnection): Promise<SqlSession>;
  inspect(
    s: SqlSession,
    c: DatabaseConnection,
    r: string,
  ): Promise<ResourceMetadata>;
  list(
    s: SqlSession,
    c: DatabaseConnection,
  ): Promise<{ resource: string; kind: "table" | "view" }[]>;
  close(): Promise<void>;
};
export function createRelationalDriver(
  options: RelationalOptions,
): DatabaseDriver {
  async function using<T>(
    connection: DatabaseConnection,
    work: (session: SqlSession) => Promise<T>,
    mutation = false,
  ) {
    if (connection.kind !== options.kind)
      throw new DatabaseBridgeError(
        "DATABASE_KIND",
        "Invalid driver selection.",
        422,
      );
    let session: SqlSession | undefined;
    try {
      session = await options.connect(connection);
      return await work(session);
    } catch (e) {
      throw databaseError(e, mutation);
    } finally {
      await session?.release();
    }
  }
  const inspect = async (s: SqlSession, c: DatabaseConnection, r: string) =>
    resourceMetadataSchema.parse(await options.inspect(s, c, r));
  return {
    testConnection: (c) =>
      using(c, async (s) => {
        await s.query("SELECT 1 AS ok");
      }),
    listResources: (c) => using(c, (s) => options.list(s, c)),
    inspect: (c, r) => using(c, (s) => inspect(s, c, r)),
    read: (raw) => {
      const input = databaseReadSchema.parse(raw);
      return using(input.connection, async (s) => {
        const meta = await inspect(s, input.connection, input.resource);
        const built = buildDatabaseRead(input, meta);
        const result = await s.query(built.text, built.params);
        if (input.operation === "read" && result.rows.length !== 1)
          throw new DatabaseBridgeError(
            "DATABASE_NOT_FOUND",
            "Record not found.",
            404,
          );
        const rows = result.rows
          .slice(0, input.operation === "read" ? 1 : input.perPage)
          .map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([k, v]) => [
                k,
                serializeDatabaseValue(v),
              ]),
            ),
          );
        return {
          data: input.operation === "read" ? rows[0]! : rows,
          page: input.page,
          perPage: input.perPage,
          hasNext:
            input.operation === "list" && result.rows.length > input.perPage,
        };
      });
    },
    mutate: (raw) => {
      const input = databaseMutationSchema.parse(raw);
      return using(
        input.connection,
        async (s) => {
          await s.begin();
          let committed = false;
          try {
            // PostgreSQL holds a table lock to prevent schema drift while validating and writing.
            if (input.connection.kind === "postgres")
              await s.query(
                `LOCK TABLE ${databaseTable(input.connection, input.resource)} IN ROW EXCLUSIVE MODE`,
              );
            const meta = await inspect(s, input.connection, input.resource);
            validateMutation(input, meta);
            const built = buildDatabaseMutation(input, meta);
            const written = await s.query(built.text, built.params);
            if (written.affected > 1 || written.rows.length > 1)
              throw new DatabaseBridgeError(
                "DATABASE_KEY",
                "Identifier matched multiple records.",
                409,
              );
            if (
              input.operation !== "create" &&
              written.affected === 0 &&
              input.connection.kind !== "mysql"
            )
              throw new DatabaseBridgeError(
                "DATABASE_NOT_FOUND",
                "Record not found.",
                404,
              );
            let id: unknown =
              input.operation === "create"
                ? input.values[input.idColumn]
                : input.id;
            if (input.operation === "create" && id === undefined) {
              id = written.rows[0]?.__insertId as string | undefined;
              if (id === undefined && input.connection.kind === "mysql")
                id = (
                  await s.query(
                    "SELECT CAST(LAST_INSERT_ID() AS CHAR) AS __insertId",
                  )
                ).rows[0]?.__insertId as string | undefined;
            }
            if (id === undefined || id === null)
              throw new DatabaseBridgeError(
                "DATABASE_KEY",
                "The database did not return the created identifier.",
                422,
              );
            let result: DatabaseResult;
            if (input.operation === "delete") {
              if (written.affected === 0)
                throw new DatabaseBridgeError(
                  "DATABASE_NOT_FOUND",
                  "Record not found.",
                  404,
                );
              result = { data: { id: String(id), deleted: true } };
            } else {
              const read = buildDatabaseRead(
                databaseReadSchema.parse({
                  connection: input.connection,
                  resource: input.resource,
                  columns: input.columns,
                  idColumn: input.idColumn,
                  operation: "read",
                  id: String(id),
                }),
                meta,
              );
              const selected = await s.query(read.text, read.params);
              if (selected.rows.length !== 1)
                throw new DatabaseBridgeError(
                  "DATABASE_NOT_FOUND",
                  "Record not found after write.",
                  404,
                );
              result = {
                data: Object.fromEntries(
                  Object.entries(selected.rows[0]!).map(([k, v]) => [
                    k,
                    serializeDatabaseValue(v),
                  ]),
                ),
              };
            }
            await s.commit();
            committed = true;
            return result;
          } catch (e) {
            if (!committed) await s.rollback().catch(() => {});
            throw e;
          }
        },
        true,
      );
    },
    close: options.close,
  };
}
