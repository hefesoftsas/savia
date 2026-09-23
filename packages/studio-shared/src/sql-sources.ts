import { z } from "zod";

/**
 * Contrato compartido para fuentes SQL externas (Postgres v1, read-only).
 *
 * La API de Savia corre en Workers/D1 y no abre TCP directo a Postgres.
 * Un servicio puente (`apps/db-bridge`, Node) con acceso de red a la base
 * ejecuta introspección y SELECT parametrizados; la API solo orquesta,
 * valida identificadores y proyecta a campos declarados.
 */

export const SQL_MAX_TABLES = 500;
export const SQL_MAX_PAGE_SIZE = 100;
export const SQL_DEFAULT_SCHEMA = "public";

/** Identificadores SQL seguros: sin comillas, sin puntos, sin inyección. */
export const sqlIdentifier = z
  .string()
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/,
    "Usa un identificador SQL válido (letras, números y guion bajo).",
  );

const hostname = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?|\d{1,3}(\.\d{1,3}){3})(\.([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/,
    "Nombre de host o IP inválido.",
  );

export const postgresConnectionSchema = z
  .object({
    host: hostname,
    port: z.coerce.number().int().min(1).max(65535).default(5432),
    database: z.string().trim().min(1).max(63),
    username: z.string().trim().min(1).max(63),
    schema: sqlIdentifier.default(SQL_DEFAULT_SCHEMA),
    ssl: z.boolean().default(true),
  })
  .strict();

export type PostgresConnection = z.infer<typeof postgresConnectionSchema>;

export const postgresSourceInputSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
    label: z.string().trim().min(1).max(100),
    kind: z.literal("postgres"),
    host: hostname,
    port: z.coerce.number().int().min(1).max(65535).optional(),
    database: z.string().trim().min(1).max(63),
    username: z.string().trim().min(1).max(63),
    password: z.string().max(10000).optional(),
    schema: z.string().trim().min(1).max(63).optional(),
    ssl: z.boolean().optional(),
  })
  .strict();

export type PostgresSourceInput = z.infer<typeof postgresSourceInputSchema>;

/** Config persistida en crm_collection_sources.config (sin secretos). */
export const postgresSourceConfigSchema = z
  .object({
    host: hostname,
    port: z.number().int().min(1).max(65535),
    database: z.string().min(1).max(63),
    username: z.string().min(1).max(63),
    schema: sqlIdentifier,
    ssl: z.boolean(),
  })
  .strict();

export type PostgresSourceConfig = z.infer<typeof postgresSourceConfigSchema>;

export function postgresSourceConfigFromInput(
  input: PostgresSourceInput,
): PostgresSourceConfig {
  return postgresSourceConfigSchema.parse({
    host: input.host,
    port: input.port ?? 5432,
    database: input.database,
    username: input.username,
    schema: input.schema ?? SQL_DEFAULT_SCHEMA,
    ssl: input.ssl ?? true,
  });
}

/**
 * Mapeo Postgres -> tipos de campo Savia (equivalente a la tabla de
 * field-type mapping de NocoBase para PostgreSQL).
 */
export function postgresTypeToFieldType(pgType: string): {
  type: string;
  readOnly: true;
} {
  const normalized = pgType
    .trim()
    .toLowerCase()
    .replace(/^"+|"+$/g, "");
  if (["boolean", "bool"].includes(normalized))
    return { type: "Toggle", readOnly: true };
  if (
    [
      "smallint",
      "int2",
      "integer",
      "int",
      "int4",
      "bigint",
      "int8",
      "smallserial",
      "serial2",
      "serial",
      "serial4",
      "bigserial",
      "serial8",
      "real",
      "float4",
      "double precision",
      "float8",
      "numeric",
      "decimal",
      "money",
    ].includes(normalized)
  )
    return { type: "Number", readOnly: true };
  if (
    [
      "date",
      "timestamp",
      "timestamptz",
      "timestamp with time zone",
      "timestamp without time zone",
      "time",
      "timetz",
      "interval",
    ].includes(normalized)
  )
    return { type: "DateControl", readOnly: true };
  if (["uuid"].includes(normalized)) return { type: "Textbox", readOnly: true };
  if (
    ["json", "jsonb", "xml", "hstore"].includes(normalized) ||
    normalized.endsWith("[]")
  )
    return { type: "Textarea", readOnly: true };
  if (
    [
      "bytea",
      "point",
      "line",
      "lseg",
      "box",
      "path",
      "polygon",
      "circle",
      "cidr",
      "inet",
      "macaddr",
      "macaddr8",
      "bit",
      "varbit",
      "tsvector",
      "tsquery",
    ].includes(normalized)
  )
    return { type: "Textarea", readOnly: true };
  if (normalized === "email") return { type: "Email", readOnly: true };
  if (normalized === "phone") return { type: "Phone", readOnly: true };
  if (normalized === "url") return { type: "Url", readOnly: true };
  return { type: "Textbox", readOnly: true };
}

export function postgresFieldLabel(column: string): string {
  return column
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

/* Protocolo API <-> puente (JSON sobre HTTPS + Bearer). */

export const bridgeFilterSchema = z.object({
  field: sqlIdentifier,
  op: z.literal("eq"),
  value: z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
});

export const bridgeQuerySchema = z
  .object({
    connection: postgresConnectionSchema.extend({
      password: z.string().max(10000),
    }),
    table: sqlIdentifier,
    operation: z.enum(["list", "read"]),
    id: z.string().min(1).max(300).optional(),
    idColumn: sqlIdentifier.optional(),
    page: z.number().int().min(1).max(100000).default(1),
    perPage: z.number().int().min(1).max(SQL_MAX_PAGE_SIZE).default(25),
    sort: sqlIdentifier.optional(),
    order: z.enum(["ASC", "DESC"]).default("DESC"),
    filters: z.array(bridgeFilterSchema).max(20).default([]),
    search: z.string().trim().min(1).max(200).optional(),
    searchColumns: z.array(sqlIdentifier).max(20).default([]),
    columns: z.array(sqlIdentifier).min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => (value.operation === "read" ? Boolean(value.id) : true), {
    message: "Consultar requiere un identificador.",
  });

export type BridgeQuery = z.infer<typeof bridgeQuerySchema>;

export const bridgeRowSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const bridgeQueryResultSchema = z
  .object({
    data: z.union([z.array(bridgeRowSchema), bridgeRowSchema, z.null()]),
    total: z.number().int().min(0).optional(),
    page: z.number().int().min(1),
    perPage: z.number().int().min(1),
    hasNext: z.boolean().nullable().optional(),
  })
  .strict();

export type BridgeQueryResult = z.infer<typeof bridgeQueryResultSchema>;

export const bridgeColumnSchema = z
  .object({
    name: sqlIdentifier,
    pgType: z.string().min(1).max(100),
    nullable: z.boolean(),
    isPrimaryKey: z.boolean(),
    isUnique: z.boolean(),
    defaultValue: z.string().max(500).nullable().optional(),
  })
  .strict();

export type BridgeColumn = z.infer<typeof bridgeColumnSchema>;

export const bridgeTableSchema = z
  .object({
    schema: sqlIdentifier,
    table: sqlIdentifier,
    kind: z.enum(["table", "view"]),
    rowEstimate: z.number().int().min(0).nullable().optional(),
  })
  .strict();

export type BridgeTable = z.infer<typeof bridgeTableSchema>;

export const bridgeIntrospectTablesResultSchema = z
  .object({ tables: z.array(bridgeTableSchema).max(SQL_MAX_TABLES) })
  .strict();

export const bridgeIntrospectColumnsResultSchema = z
  .object({
    schema: sqlIdentifier,
    table: sqlIdentifier,
    kind: z.enum(["table", "view"]),
    columns: z.array(bridgeColumnSchema).min(1).max(500),
    primaryKey: z.array(sqlIdentifier).max(10),
  })
  .strict();

export type BridgeIntrospectColumnsResult = z.infer<
  typeof bridgeIntrospectColumnsResultSchema
>;
