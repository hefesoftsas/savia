import {
  dialectFor,
  quoteIdentifier,
  sqlLiteral,
  type SqlDialect,
} from "@savia/db/dialect";
import { postgresJsonSortParts } from "@savia/db/postgres-dialect";
import type {
  RecordPerformance,
  StudioObject,
} from "@savia/studio-shared/metadata";
import { paginationScope } from "./record-pagination";
import { filterSchema } from "./query";

type Index = RecordPerformance["indexes"][number];
export const recordIndexName = async (
  tenant: string,
  objectName: string,
  index: Index,
) =>
  "studio_perf_" +
  (await paginationScope([tenant, objectName, index])).slice(0, 40);
export async function recordIndexStatements(
  db: D1Database,
  tenant: string,
  objectName: string,
  previous: Index[] = [],
  next: Index[] = [],
): Promise<D1PreparedStatement[]> {
  const dialect = dialectFor(db);
  const statements = await recordIndexSql(
    dialect,
    tenant,
    objectName,
    previous,
    next,
  );
  return statements.map((sql) => db.prepare(sql));
}

/** Generate configured record index DDL for startup, import, and adapters. */
export async function recordIndexSql(
  dialect: SqlDialect,
  tenant: string,
  objectName: string,
  previous: Index[] = [],
  next: Index[] = [],
): Promise<string[]> {
  const name = (index: Index) => recordIndexName(tenant, objectName, index);
  const statements: string[] = [];
  const keys = new Set(next.map((index) => JSON.stringify(index)));
  for (const index of previous)
    if (!keys.has(JSON.stringify(index)))
      statements.push(
        `DROP INDEX IF EXISTS ${quoteIdentifier(await name(index))}`,
      );
  for (const index of next) {
    if (previous.some((old) => JSON.stringify(old) === JSON.stringify(index)))
      continue;
    if (
      !index.fields.length ||
      index.fields.some((field) => !/^[a-z][a-z0-9_]{0,47}$/.test(field)) ||
      !["ASC", "DESC"].includes(index.order)
    )
      throw Error("Invalid performance index");
    const fields = index.fields.flatMap((field, i) => {
      const order = i === index.fields.length - 1 ? index.order : "ASC";
      if (["created_at", "updated_at"].includes(field))
        return [`${quoteIdentifier(field)} ${order}`];
      if (dialect.name === "postgres")
        return postgresJsonSortParts("data", "$." + field).map(
          (part) => `(${part}) ${order}`,
        );
      return [`${dialect.jsonSort("data", "$." + field)} ${order}`];
    });
    const indexName = await name(index);
    statements.push(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON studio_records(${fields.join(",")},id ASC) WHERE tenant_id=${sqlLiteral(tenant)} AND object_name=${sqlLiteral(objectName)} AND deleted_at IS NULL`,
    );
  }
  return statements;
}
/** Recognize only a single exact equality predicate; other predicates stay exact SQL. */
export function singleRecordEquality(
  object: StudioObject,
  params: Record<string, string | undefined>,
): { field: string; value: unknown } | undefined {
  if (params.q || params.trash === "true" || params.emptyStage === "true")
    return;
  if (params.stage && !params.filters)
    return {
      field: object.config.studio?.pipeline?.field ?? "stage",
      value: params.stage,
    };
  if (!params.filters || params.stage) return;
  let raw: unknown;
  try {
    raw = JSON.parse(params.filters);
  } catch {
    return;
  }
  const parsed = filterSchema.safeParse(raw);
  if (!parsed.success || parsed.data.conditions.length !== 1) return;
  const condition = parsed.data.conditions[0];
  if (condition.op !== "eq" || !object.config.fields[condition.field]) return;
  return { field: condition.field, value: condition.value ?? null };
}

function exactEqualityFields(
  object: StudioObject,
  params: Record<string, string | undefined>,
): Set<string> {
  const fields = new Set<string>();
  if (params.emptyStage === "true") return fields;

  const pipelineField = object.config.studio?.pipeline?.field ?? "stage";
  if (params.stage && object.config.fields[pipelineField])
    fields.add(pipelineField);

  if (!params.filters) return fields;
  let raw: unknown;
  try {
    raw = JSON.parse(params.filters);
  } catch {
    return fields;
  }
  const parsed = filterSchema.safeParse(raw);
  if (!parsed.success) return fields;
  const { conditions, logic } = parsed.data;
  if (logic === "or" && conditions.length !== 1) return fields;
  for (const condition of conditions)
    if (condition.op === "eq" && object.config.fields[condition.field])
      fields.add(condition.field);
  return fields;
}

export function indexedRecordSort(
  object: StudioObject,
  sort: string,
  order: string,
  params: Record<string, string | undefined>,
): Index | undefined {
  if (params.trash === "true" || params.q) return undefined;
  const equalityFields = exactEqualityFields(object, params);
  return (object.config.performance?.indexes ?? []).find(
    (index) =>
      index.order === order &&
      index.fields.at(-1) === sort &&
      index.fields.slice(0, -1).every((field) => equalityFields.has(field)),
  );
}
