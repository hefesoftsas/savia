import type { CrmObject } from "@savia/crm-shared/metadata";
import { z } from "zod";
import { fail } from "./context";
export const filterSchema = z.object({
  logic: z.enum(["and", "or"]).default("and"),
  conditions: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum([
          "eq",
          "ne",
          "gt",
          "gte",
          "lt",
          "lte",
          "contains",
          "startsWith",
          "endsWith",
          "empty",
          "in",
        ]),
        value: z.unknown().optional(),
      }),
    )
    .max(20),
});
function resolveSearchFields(
  object: CrmObject,
  params: Record<string, string | undefined>,
) {
  if (params.searchFields) {
    return params.searchFields
      .split(",")
      .map((field) => field.trim())
      .filter((field) => object.config.fields[field])
      .slice(0, 20);
  }
  if (params.searchField && object.config.fields[params.searchField])
    return [params.searchField];
  return [];
}
export function buildWhere(
  object: CrmObject,
  tenant: string,
  params: Record<string, string | undefined>,
) {
  const args: any[] = [tenant, object.name];
  let where = `tenant_id=? AND object_name=? AND deleted_at IS ${params.trash === "true" ? "NOT " : ""}NULL`;
  if (params.q) {
    const pattern =
      "%" + params.q.slice(0, 200).replace(/[\\%_]/g, "\\$&") + "%";
    const searchFields = resolveSearchFields(object, params);
    if (searchFields.length) {
      where += ` AND (${searchFields
        .map(
          (field) =>
            `CAST(json_extract(data,'$.${field}') AS TEXT) LIKE ? ESCAPE '\\'`,
        )
        .join(" OR ")})`;
      args.push(...searchFields.map(() => pattern));
    } else {
      where +=
        " AND EXISTS(SELECT 1 FROM json_each(data) search WHERE CAST(search.value AS TEXT) LIKE ? ESCAPE '\\')";
      args.push(pattern);
    }
  }
  const pipeline = object.config.studio?.pipeline?.field ?? "stage";
  if (params.stage && object.config.fields[pipeline]) {
    where += ` AND json_extract(data,'$.${pipeline}')=?`;
    args.push(params.stage);
  }
  if (params.emptyStage === "true" && object.config.fields[pipeline])
    where += ` AND (json_extract(data,'$.${pipeline}') IS NULL OR json_extract(data,'$.${pipeline}')='')`;
  if (params.filters) {
    let raw;
    try {
      raw = JSON.parse(params.filters);
    } catch {
      return fail("Filtros inválidos.", 422);
    }
    const filters = filterSchema.parse(raw);
    const parts: string[] = [];
    for (const condition of filters.conditions) {
      if (!object.config.fields[condition.field])
        return fail("Campo de filtro desconocido.", 422);
      const expr = `json_extract(data,'$.${condition.field}')`;
      const value = condition.value;
      if (condition.op === "empty") {
        parts.push(`(${expr} IS NULL OR ${expr}='' OR ${expr}='[]')`);
        continue;
      }
      if (condition.op === "in") {
        if (
          !Array.isArray(value) ||
          !value.length ||
          value.length > 100 ||
          value.some((v) => !["string", "number", "boolean"].includes(typeof v))
        )
          return fail("Filtro de lista inválido.", 422);
        parts.push(`${expr} IN (${value.map(() => "?").join(",")})`);
        args.push(
          ...value.map((v) => (typeof v === "boolean" ? Number(v) : v)),
        );
        continue;
      }
      if (
        !["string", "number", "boolean"].includes(typeof value) &&
        value !== null
      )
        return fail("Valor de filtro inválido.", 422);
      if (["contains", "startsWith", "endsWith"].includes(condition.op)) {
        parts.push(`CAST(${expr} AS TEXT) LIKE ? ESCAPE '\\'`);
        const text = String(value ?? "").replace(/[\\%_]/g, "\\$&");
        args.push(
          condition.op === "contains"
            ? `%${text}%`
            : condition.op === "startsWith"
              ? `${text}%`
              : `%${text}`,
        );
        continue;
      }
      const ops: Record<string, string> = {
        eq: "IS",
        ne: "IS NOT",
        gt: ">",
        gte: ">=",
        lt: "<",
        lte: "<=",
      };
      parts.push(`${expr} ${ops[condition.op]} ?`);
      args.push(typeof value === "boolean" ? Number(value) : (value ?? null));
    }
    if (parts.length)
      where +=
        " AND (" + parts.join(filters.logic === "and" ? " AND " : " OR ") + ")";
  }
  return { where, args };
}
