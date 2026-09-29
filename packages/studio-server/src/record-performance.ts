import { dialectFor, sqlLiteral } from "@savia/db/dialect";
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
  if (dialectFor(db).name !== "sqlite") return [];
  const name = (index: Index) => recordIndexName(tenant, objectName, index);
  const statements: D1PreparedStatement[] = [];
  const keys = new Set(next.map((index) => JSON.stringify(index)));
  for (const index of previous)
    if (!keys.has(JSON.stringify(index)))
      statements.push(db.prepare(`DROP INDEX IF EXISTS ${await name(index)}`));
  for (const index of next) {
    if (previous.some((old) => JSON.stringify(old) === JSON.stringify(index)))
      continue;
    if (
      !index.fields.length ||
      index.fields.some((field) => !/^[a-z][a-z0-9_]{0,47}$/.test(field)) ||
      !["ASC", "DESC"].includes(index.order)
    )
      throw Error("Invalid performance index");
    const fields = index.fields.map(
      (field, i) =>
        `${["created_at", "updated_at"].includes(field) ? field : dialectFor(db).jsonSort("data", "$." + field)} ${i === index.fields.length - 1 ? index.order : "ASC"}`,
    );
    statements.push(
      db.prepare(
        `CREATE INDEX IF NOT EXISTS ${await name(index)} ON studio_records(${fields.join(",")},id ASC) WHERE tenant_id=${sqlLiteral(tenant)} AND object_name=${sqlLiteral(objectName)} AND deleted_at IS NULL`,
      ),
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
