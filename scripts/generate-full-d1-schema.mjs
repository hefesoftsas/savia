#!/usr/bin/env node

/**
 * Generates the schema-only D1 projection from the restored PostgreSQL dump.
 *
 * The output deliberately excludes source data and all PostGIS objects.  The
 * ten tables that already have typed, public Drizzle projections keep their
 * stable D1 names; every other table keeps its source name as an internal
 * storage detail.  OpenAPI must use the domain/collection layer, never this
 * manifest directly.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFileSync } from "node:fs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = resolve(
  repositoryRoot,
  "packages/db/migrations/0006_full_source_schema.sql",
);
const manifestPath = resolve(
  repositoryRoot,
  "docs/full-d1-schema-manifest.json",
);
const internalSchemaPath = resolve(
  repositoryRoot,
  "packages/db/src/internal-schema.generated.ts",
);

const publicProjections = new Map([
  ["business_agency", "agencies"],
  ["business_agencycontact", "agency_contacts"],
  ["app_country", "countries"],
  ["app_department", "departments"],
  ["app_city", "cities"],
  ["business_category", "categories"],
  ["business_subramo", "sub_ramos"],
  ["business_ramo", "ramos"],
  ["business_agencybranch", "agency_branches"],
  ["business_insurercompany", "insurer_companies"],
]);

function psqlJson(sql) {
  const output = execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-q",
      "-U",
      "savia",
      "-d",
      "savia_source",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();

  return JSON.parse(output || "[]");
}

function quote(identifier) {
  return `\`${identifier.replaceAll("`", "``")}\``;
}

function d1Type(column) {
  if (column.udtName.startsWith("_")) return "TEXT";

  switch (column.dataType) {
    case "smallint":
    case "integer":
      return "INTEGER";
    case "bigint":
      return "BIGINT";
    case "boolean":
      return "INTEGER";
    case "numeric":
    case "decimal":
      return "TEXT";
    default:
      return "TEXT";
  }
}

function internalTableVariable(tableName) {
  return `table_${tableName.replaceAll("-", "_")}`;
}

function drizzleColumn(column, primaryKeyColumn) {
  const isPrimaryKey = column.name === primaryKeyColumn;
  const isIdentityPrimaryKey = isPrimaryKey && column.identity;
  const columnName = JSON.stringify(column.name);
  let definition;

  if (isIdentityPrimaryKey) {
    definition = `integer(${columnName})`;
  } else if (column.udtName.startsWith("_")) {
    definition = `text(${columnName})`;
  } else {
    switch (column.dataType) {
      case "smallint":
      case "integer":
        definition = `integer(${columnName})`;
        break;
      case "bigint":
        definition = `bigint(${columnName})`;
        break;
      case "boolean":
        definition = `integer(${columnName}, { mode: "boolean" })`;
        break;
      default:
        definition = `text(${columnName})`;
    }
  }

  if (isPrimaryKey) {
    definition += isIdentityPrimaryKey
      ? ".primaryKey({ autoIncrement: true })"
      : ".primaryKey()";
  }
  if (!column.nullable) definition += ".notNull()";

  return definition;
}

function publicTableName(sourceTable) {
  return publicProjections.get(sourceTable) ?? sourceTable;
}

function domainFor(sourceTable) {
  const prefix = sourceTable.split("_", 1)[0];
  return prefix === sourceTable ? "platform" : prefix;
}

function translatePostgresExpression(expression) {
  return expression
    .replaceAll("::character varying", "")
    .replaceAll("::text", "")
    .replaceAll("::integer", "")
    .replaceAll("::bigint", "")
    .replaceAll("::boolean", "")
    .replaceAll("::date", "")
    .replaceAll("::timestamp with time zone", "")
    .replaceAll("::timestamp without time zone", "")
    .replace(/=\s*ANY\s*\(ARRAY\[/gi, "IN (")
    .replaceAll("])" , ")");
}

function checkExpression(definition, table) {
  const prefix = "CHECK ";
  if (!definition.startsWith(prefix)) {
    throw new Error(`Unsupported check definition: ${definition}`);
  }

  let expression = translatePostgresExpression(definition.slice(prefix.length));
  for (const column of [...table.columns].sort(
    (left, right) => right.name.length - left.name.length,
  )) {
    const escapedName = column.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expression = expression.replace(
      new RegExp(`(?<![\\w\"])${escapedName}(?![\\w\"])`, "g"),
      quote(column.name),
    );
  }

  return `CHECK ${expression}`;
}

const tables = psqlJson(`
  SELECT COALESCE(json_agg(row_to_json(result) ORDER BY table_name), '[]')
  FROM (
    SELECT
      c.table_name,
      json_agg(
        json_build_object(
          'name', c.column_name,
          'dataType', c.data_type,
          'udtName', c.udt_name,
          'nullable', c.is_nullable = 'YES',
          'identity', c.is_identity = 'YES',
          'maxLength', c.character_maximum_length
        )
        ORDER BY c.ordinal_position
      ) AS columns
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name <> 'spatial_ref_sys'
    GROUP BY c.table_name
  ) result;
`);

const primaryKeys = psqlJson(`
  SELECT COALESCE(json_agg(row_to_json(result) ORDER BY table_name), '[]')
  FROM (
    SELECT tc.table_name, array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_schema = tc.constraint_schema
      AND kcu.constraint_name = tc.constraint_name
      AND kcu.table_name = tc.table_name
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_name <> 'spatial_ref_sys'
    GROUP BY tc.table_name
  ) result;
`);

const foreignKeys = psqlJson(`
  SELECT COALESCE(json_agg(row_to_json(result) ORDER BY table_name, constraint_name), '[]')
  FROM (
    SELECT
      tc.table_name,
      tc.constraint_name,
      array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns,
      ccu.table_name AS target_table,
      array_agg(ccu.column_name ORDER BY kcu.ordinal_position) AS target_columns,
      rc.update_rule,
      rc.delete_rule,
      c.condeferrable,
      c.condeferred
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_schema = tc.constraint_schema
      AND kcu.constraint_name = tc.constraint_name
      AND kcu.table_name = tc.table_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_schema = tc.constraint_schema
      AND ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_schema = tc.constraint_schema
      AND rc.constraint_name = tc.constraint_name
    JOIN pg_constraint c ON c.conname = tc.constraint_name
      AND c.connamespace = 'public'::regnamespace
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name <> 'spatial_ref_sys'
    GROUP BY tc.table_name, tc.constraint_name, ccu.table_name,
      rc.update_rule, rc.delete_rule, c.condeferrable, c.condeferred
  ) result;
`);

const indexes = psqlJson(`
  SELECT COALESCE(json_agg(row_to_json(result) ORDER BY table_name, index_name), '[]')
  FROM (
    SELECT
      t.relname AS table_name,
      i.relname AS index_name,
      ix.indisunique AS is_unique,
      array_agg(a.attname ORDER BY key.ordinality) AS columns,
      pg_get_expr(ix.indpred, ix.indrelid) AS predicate
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS key(attnum, ordinality) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = key.attnum
    WHERE n.nspname = 'public'
      AND t.relkind = 'r'
      AND t.relname <> 'spatial_ref_sys'
      AND NOT ix.indisprimary
      AND ix.indexprs IS NULL
    GROUP BY t.relname, i.relname, ix.indisunique, ix.indpred, ix.indrelid
  ) result;
`);

const checks = psqlJson(`
  SELECT COALESCE(json_agg(row_to_json(result) ORDER BY table_name, constraint_name), '[]')
  FROM (
    SELECT
      rel.relname AS table_name,
      c.conname AS constraint_name,
      pg_get_constraintdef(c.oid, true) AS definition
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    WHERE c.connamespace = 'public'::regnamespace
      AND c.contype = 'c'
      AND rel.relname <> 'spatial_ref_sys'
  ) result;
`);

const primaryKeyByTable = new Map(
  primaryKeys.map((primaryKey) => [primaryKey.table_name, primaryKey.columns]),
);
const foreignKeysByTable = Map.groupBy(foreignKeys, (foreignKey) => foreignKey.table_name);
const checksByTable = Map.groupBy(checks, (check) => check.table_name);
const projectedTables = tables.filter(
  (table) => !publicProjections.has(table.table_name),
);

const migration = [
  "-- Generated from the restored legacy PostgreSQL schema. Do not edit by hand.",
  "-- Schema only: no data, PostGIS, extensions, views, sequences, or triggers.",
  "-- The public OpenAPI surface is domain/collection based; these are internal D1 tables.",
  "",
];

for (const table of projectedTables) {
  const primaryKeyColumns = primaryKeyByTable.get(table.table_name);
  if (!primaryKeyColumns || primaryKeyColumns.length !== 1) {
    throw new Error(`Expected a single-column primary key for ${table.table_name}`);
  }

  const [primaryKeyColumn] = primaryKeyColumns;
  const definitions = table.columns.map((column) => {
    const isIdentityPrimaryKey = column.identity && column.name === primaryKeyColumn;
    const sqlType = isIdentityPrimaryKey ? "INTEGER" : d1Type(column);
    const modifiers = [quote(column.name), sqlType];

    if (column.name === primaryKeyColumn) modifiers.push("PRIMARY KEY");
    if (!column.nullable) modifiers.push("NOT NULL");

    return modifiers.join(" ");
  });

  for (const foreignKey of foreignKeysByTable.get(table.table_name) ?? []) {
    const localColumns = foreignKey.columns.map(quote).join(", ");
    const targetColumns = foreignKey.target_columns.map(quote).join(", ");
    const targetTable = quote(publicTableName(foreignKey.target_table));
    const deferrable = foreignKey.condeferrable
      ? foreignKey.condeferred
        ? " DEFERRABLE INITIALLY DEFERRED"
        : " DEFERRABLE"
      : "";

    definitions.push(
      `CONSTRAINT ${quote(foreignKey.constraint_name)} FOREIGN KEY (${localColumns}) REFERENCES ${targetTable} (${targetColumns}) ON UPDATE ${foreignKey.update_rule} ON DELETE ${foreignKey.delete_rule}${deferrable}`,
    );
  }

  for (const check of checksByTable.get(table.table_name) ?? []) {
    definitions.push(
      `CONSTRAINT ${quote(check.constraint_name)} ${checkExpression(check.definition, table)}`,
    );
  }

  migration.push(
    `CREATE TABLE ${quote(table.table_name)} (\n  ${definitions.join(",\n  ")}\n);`,
    "--> statement-breakpoint",
  );
}

for (const index of indexes) {
  if (publicProjections.has(index.table_name)) continue;

  const predicate = index.predicate
    ? ` WHERE ${translatePostgresExpression(index.predicate)}`
    : "";
  migration.push(
    `CREATE ${index.is_unique ? "UNIQUE " : ""}INDEX ${quote(index.index_name)} ON ${quote(index.table_name)} (${index.columns.map(quote).join(", ")})${predicate};`,
    "--> statement-breakpoint",
  );
}

const internalSchema = [
  "// Generated from the restored legacy PostgreSQL schema. Do not edit by hand.",
  "// @internal Raw relational tables for domain repositories; never expose through OpenAPI.",
  'import { customType, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";',
  "",
  "const bigint = customType<{ data: number; driverData: number }>({",
  '  dataType: () => "BIGINT",',
  "});",
  "",
];

for (const table of projectedTables) {
  const primaryKeyColumns = primaryKeyByTable.get(table.table_name);
  if (!primaryKeyColumns || primaryKeyColumns.length !== 1) {
    throw new Error(`Expected a single-column primary key for ${table.table_name}`);
  }

  const [primaryKeyColumn] = primaryKeyColumns;
  internalSchema.push(
    `const ${internalTableVariable(table.table_name)} = sqliteTable(`,
    `  ${JSON.stringify(table.table_name)},`,
    "  {",
    ...table.columns.map(
      (column) => `    ${JSON.stringify(column.name)}: ${drizzleColumn(column, primaryKeyColumn)},`,
    ),
    "  },",
    ");",
    "",
  );
}

internalSchema.push(
  "export const internalTables = {",
  ...projectedTables.map(
    (table) => `  ${JSON.stringify(table.table_name)}: ${internalTableVariable(table.table_name)},`,
  ),
  "} as const;",
  "",
);

const manifest = {
  source: "legacy PostgreSQL public schema",
  generatedBy: "scripts/generate-full-d1-schema.mjs",
  excluded: {
    tables: ["spatial_ref_sys"],
    features: ["PostGIS", "source data", "views", "sequences", "triggers"],
  },
  publicBoundary: "OpenAPI accesses domain collections, never raw internal tables.",
  totals: {
    sourceTables: tables.length,
    existingPublicProjections: publicProjections.size,
    generatedInternalTables: projectedTables.length,
    resultingD1Tables: tables.length,
    foreignKeys: foreignKeys.length,
    indexes: indexes.length,
    checks: checks.length,
  },
  typeMapping: {
    integer: "INTEGER",
    bigint: "BIGINT (INTEGER for identity primary keys)",
    boolean: "INTEGER",
    numeric: "TEXT",
    temporal_json_array_uuid_geometry: "TEXT",
  },
  tables: tables.map((table) => ({
    sourceTable: table.table_name,
    internalTable: publicTableName(table.table_name),
    exposure: publicProjections.has(table.table_name)
      ? "legacy typed projection"
      : "internal only",
    domain: domainFor(table.table_name),
    columns: table.columns.map((column) => ({
      sourceName: column.name,
      sourceType: column.udtName,
      d1Type: column.identity && primaryKeyByTable.get(table.table_name)?.[0] === column.name
        ? "INTEGER"
        : d1Type(column),
      nullable: column.nullable,
      identity: column.identity,
      maxLength: column.maxLength,
    })),
  })),
};

writeFileSync(migrationPath, `${migration.join("\n")}\n`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(internalSchemaPath, `${internalSchema.join("\n")}\n`);

console.log(
  `Generated ${projectedTables.length} internal D1 tables, ${indexes.length} indexes, ${checks.length} checks, and Drizzle internal models.`,
);
