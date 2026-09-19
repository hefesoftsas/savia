import {
  databaseFieldName,
  databaseReadSchema,
  databaseMutationSchema,
  resolveRecordKey,
  type DatabaseConnection,
  type DatabaseRead,
  type DatabaseMutation,
  type ResourceMetadata,
} from "@savia/crm-shared/database-sources";
import { DatabaseBridgeError } from "./database-errors";
import { validateFieldValue } from "./database-values";
export type BuiltDatabaseQuery = { text: string; params: unknown[] };
export function quoteDatabaseIdentifier(
  kind: DatabaseConnection["kind"],
  value: string,
) {
  databaseFieldName.parse(value);
  return kind === "mysql"
    ? `\`${value}\``
    : kind === "mssql"
      ? `[${value}]`
      : `"${value}"`;
}
export function databaseTable(
  connection: DatabaseConnection,
  resource: string,
) {
  const q = (s: string) => quoteDatabaseIdentifier(connection.kind, s);
  return connection.kind === "postgres" || connection.kind === "mssql"
    ? `${q(connection.schema)}.${q(resource)}`
    : q(resource);
}
function validateColumns(
  input: DatabaseRead | DatabaseMutation,
  meta: ResourceMetadata,
) {
  for (const name of input.columns)
    if (!meta.fields.some((f) => f.name === name))
      throw new DatabaseBridgeError(
        "DATABASE_FIELD",
        `Unknown field ${name}.`,
        422,
      );
}
export function validateMutation(
  input: DatabaseMutation,
  meta: ResourceMetadata,
) {
  databaseMutationSchema.parse(input);
  validateColumns(input, meta);
  if (meta.kind === "view" || !resolveRecordKey(meta, input.idColumn))
    throw new DatabaseBridgeError(
      "DATABASE_READ_ONLY",
      "Resource has no writable record identifier.",
      405,
    );
  if (input.operation !== "delete") {
    for (const [name, value] of Object.entries(input.values)) {
      const field = meta.fields.find((f) => f.name === name);
      if (
        !field ||
        field.generated ||
        !field.writable ||
        !input.columns.includes(name) ||
        (input.operation === "update" && name === input.idColumn)
      )
        throw new DatabaseBridgeError(
          "DATABASE_FIELD",
          `Field ${name} is not writable.`,
          422,
        );
      validateFieldValue(field, value);
    }
    if (input.operation === "create")
      for (const f of meta.fields)
        if (
          !f.nullable &&
          !f.generated &&
          !f.hasDefault &&
          !(f.name in input.values)
        )
          throw new DatabaseBridgeError(
            "DATABASE_REQUIRED",
            `Field ${f.name} is required.`,
            422,
          );
  }
}
export function buildDatabaseRead(
  input: DatabaseRead,
  meta: ResourceMetadata,
): BuiltDatabaseQuery {
  databaseReadSchema.parse(input);
  validateColumns(input, meta);
  const kind = input.connection.kind;
  const q = (s: string) => quoteDatabaseIdentifier(kind, s);
  const params: unknown[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return kind === "mysql"
      ? "?"
      : kind === "mssql"
        ? `@p${params.length - 1}`
        : `$${params.length}`;
  };
  const columns = input.columns
    .map((name) => {
      const f = meta.fields.find((f) => f.name === name)!;
      if (["bigint", "decimal"].includes(f.valueType))
        return kind === "postgres"
          ? `${q(name)}::text AS ${q(name)}`
          : `CAST(${q(name)} AS ${kind === "mysql" ? "CHAR" : "nvarchar(200)"}) AS ${q(name)}`;
      return q(name);
    })
    .join(", ");
  const predicates: string[] = [];
  if (input.operation === "read") {
    if (!resolveRecordKey(meta, input.idColumn))
      throw new DatabaseBridgeError(
        "DATABASE_KEY",
        "Resource requires a unique identifier.",
        405,
      );
    predicates.push(`${q(input.idColumn!)} = ${bind(input.id)}`);
  }
  for (const filter of input.filters) {
    if (!input.columns.includes(filter.field))
      throw new DatabaseBridgeError(
        "DATABASE_FIELD",
        "Unknown filter field.",
        422,
      );
    predicates.push(
      `${q(filter.field)} ${filter.value === null ? "IS NULL" : `= ${bind(filter.value)}`}`,
    );
  }
  if (input.search) {
    const terms = input.searchColumns.map((name) => {
      if (!input.columns.includes(name))
        throw new DatabaseBridgeError(
          "DATABASE_FIELD",
          "Unknown search field.",
          422,
        );
      const escaped = input.search!.replace(/[!%_\[]/g, "!$&");
      const value = bind(`%${escaped}%`);
      return `${kind === "postgres" ? `${q(name)}::text` : `CAST(${q(name)} AS ${kind === "mysql" ? "CHAR" : "nvarchar(max)"})`} ${kind === "postgres" ? "ILIKE" : "LIKE"} ${value} ESCAPE '!'`;
    });
    if (!terms.length)
      throw new DatabaseBridgeError(
        "DATABASE_SEARCH",
        "No searchable fields are selected.",
        422,
      );
    predicates.push(`(${terms.join(" OR ")})`);
  }
  const key = resolveRecordKey(meta, input.idColumn);
  const sort = input.sort ?? key ?? input.columns[0]!;
  if (!input.columns.includes(sort) && sort !== key)
    throw new DatabaseBridgeError("DATABASE_FIELD", "Unknown sort field.", 422);
  const order = `ORDER BY ${q(sort)} ${input.order}${key && key !== sort ? `, ${q(key)} ${input.order}` : ""}`;
  const limit = input.operation === "read" ? 2 : input.perPage + 1;
  const offset =
    input.operation === "read" ? 0 : (input.page - 1) * input.perPage;
  const page =
    kind === "mssql"
      ? `OFFSET ${bind(offset)} ROWS FETCH NEXT ${bind(limit)} ROWS ONLY`
      : `LIMIT ${bind(limit)} OFFSET ${bind(offset)}`;
  return {
    text: `SELECT ${columns} FROM ${databaseTable(input.connection, input.resource)}${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""} ${order} ${page}`,
    params,
  };
}
export function buildDatabaseMutation(
  input: DatabaseMutation,
  meta: ResourceMetadata,
): BuiltDatabaseQuery {
  validateMutation(input, meta);
  const kind = input.connection.kind;
  const q = (s: string) => quoteDatabaseIdentifier(kind, s);
  const params: unknown[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return kind === "mysql"
      ? "?"
      : kind === "mssql"
        ? `@p${params.length - 1}`
        : `$${params.length}`;
  };
  const table = databaseTable(input.connection, input.resource);
  const output =
    kind === "mssql"
      ? `OUTPUT CONVERT(nvarchar(300),${input.operation === "delete" ? "DELETED" : "INSERTED"}.${q(input.idColumn)}) INTO @ids`
      : "";
  const values =
    input.operation === "delete"
      ? []
      : Object.entries(input.values).map(
          ([name, value]) =>
            [
              name,
              meta.fields.find((f) => f.name === name)?.valueType === "json"
                ? JSON.stringify(value)
                : value,
            ] as const,
        );
  let text: string;
  if (input.operation === "create")
    text = values.length
      ? `INSERT INTO ${table} (${values.map(([n]) => q(n)).join(", ")}) ${output} VALUES (${values.map(([, v]) => bind(v)).join(", ")})`
      : `INSERT INTO ${table} ${output} ${kind === "mysql" ? "() VALUES ()" : "DEFAULT VALUES"}`;
  else if (input.operation === "update")
    text = `UPDATE ${table} SET ${values.map(([n, v]) => `${q(n)} = ${bind(v)}`).join(", ")} ${output} WHERE ${q(input.idColumn)} = ${bind(input.id)}`;
  else
    text = `DELETE FROM ${table} ${output} WHERE ${q(input.idColumn)} = ${bind(input.id)}`;
  if (kind === "postgres")
    text += ` RETURNING ${q(input.idColumn)}::text AS "__insertId"`;
  if (kind === "mssql")
    text = `DECLARE @ids TABLE ([value] nvarchar(300)); ${text}; SELECT [value] AS __insertId FROM @ids;`;
  return { text, params };
}
