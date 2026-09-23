import {
  sqliteDialect,
  type SqlDialect,
  type JsonOperator,
} from "@savia/db/dialect";
import type { StudioObject } from "@savia/studio-shared/metadata";
import { z } from "zod";
import { fail } from "./context";
import type { AccessPolicy } from "@savia/studio-shared/access-control";
import { compileAccessWhere } from "./access-query";
import { accessColumns, requireQueryAccess } from "./access-authorization";
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
  object: StudioObject,
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
  object: StudioObject,
  tenant: string,
  params: Record<string, string | undefined>,
  policy?: AccessPolicy,
  dialect: SqlDialect = sqliteDialect,
) {
  if (policy)
    requireQueryAccess(
      policy,
      object.name,
      params,
      object.config.studio?.pipeline?.field ?? "stage",
    );
  const args: any[] = [tenant, object.name];
  let where = `tenant_id=? AND object_name=? AND deleted_at IS ${params.trash === "true" ? "NOT " : ""}NULL`;
  if (policy) {
    const access = compileAccessWhere(
      policy,
      `collection:${object.name}`,
      "read",
      accessColumns(object, dialect),
      dialect,
    );
    where += ` AND ${access.sql}`;
    args.push(...access.bindings);
  }
  if (params.q) {
    const pattern =
      "%" + params.q.slice(0, 200).replace(/[\\%_]/g, "\\$&") + "%";
    const searchFields = resolveSearchFields(object, params);
    if (searchFields.length) {
      where += ` AND (${searchFields
        .map((field) =>
          dialect.textLike(dialect.jsonText("data", "$." + field)),
        )
        .join(" OR ")})`;
      args.push(...searchFields.map(() => pattern));
    } else {
      where += ` AND EXISTS(SELECT 1 FROM ${dialect.jsonEach("data", "$", "search")} WHERE ${dialect.textLike("CAST(search.value AS TEXT)")})`;
      args.push(pattern);
    }
  }
  const pipeline = object.config.studio?.pipeline?.field ?? "stage";
  if (params.stage && object.config.fields[pipeline]) {
    const comparison = dialect.jsonCompare(
      "data",
      "$." + pipeline,
      "eq",
      params.stage,
    );
    where += ` AND ${comparison.sql}`;
    args.push(...comparison.parameters);
  }
  if (params.emptyStage === "true" && object.config.fields[pipeline])
    where += ` AND (${dialect.jsonText("data", "$." + pipeline)} IS NULL OR ${dialect.jsonText("data", "$." + pipeline)}='')`;
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
      const expr = dialect.jsonText("data", "$." + condition.field);
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
        const comparisons = value.map((v) =>
          dialect.jsonCompare("data", "$." + condition.field, "eq", v),
        );
        parts.push("(" + comparisons.map((c) => c.sql).join(" OR ") + ")");
        args.push(...comparisons.flatMap((c) => c.parameters));
        continue;
      }
      if (
        !["string", "number", "boolean"].includes(typeof value) &&
        value !== null
      )
        return fail("Valor de filtro inválido.", 422);
      if (["contains", "startsWith", "endsWith"].includes(condition.op)) {
        parts.push(dialect.textLike(`CAST(${expr} AS TEXT)`));
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
      const comparison = dialect.jsonCompare(
        "data",
        "$." + condition.field,
        condition.op as JsonOperator,
        value ?? null,
      );
      parts.push(comparison.sql);
      args.push(...comparison.parameters);
    }
    if (parts.length)
      where +=
        " AND (" + parts.join(filters.logic === "and" ? " AND " : " OR ") + ")";
  }
  return { where, args };
}
