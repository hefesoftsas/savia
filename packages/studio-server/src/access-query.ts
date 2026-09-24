import { sqliteDialect, type SqlDialect } from "@savia/db/dialect";
export type AccessColumn =
  string | { expression: string; type: string; document: string; path: string };
import type {
  AccessAction,
  AccessPolicy,
  AccessPredicate,
  AccessResource,
  Operand,
  Scalar,
} from "@savia/studio-shared/access-control";
import { HTTPException } from "hono/http-exception";
export function compileAccessWhere(
  policy: AccessPolicy,
  resource: AccessResource,
  action: AccessAction,
  columns: Readonly<Record<string, AccessColumn>>,
  dialect: SqlDialect = sqliteDialect,
) {
  const bindings: Scalar[] = [];
  const value = (v: Operand): Scalar =>
    "literal" in v
      ? v.literal
      : v.variable === "principalId"
        ? policy.principalId
        : policy.scope.startsWith("tenant:")
          ? Number(policy.scope.slice(7))
          : null;
  const emit = (p: AccessPredicate): string => {
    if ("all" in p) return p.all ? "1=1" : "1=0";
    if ("and" in p)
      return p.and.length ? "(" + p.and.map(emit).join(" AND ") + ")" : "1=0";
    if ("or" in p)
      return p.or.length ? "(" + p.or.map(emit).join(" OR ") + ")" : "1=0";
    const column = Object.hasOwn(columns, p.field)
      ? columns[p.field]
      : undefined;
    const expr = typeof column === "string" ? column : column?.expression;
    if (!expr)
      throw new HTTPException(403, {
        message: "Unsupported permission predicate field.",
      });
    const kind =
      typeof column === "object"
        ? column.type
        : expr.startsWith("json_extract(")
          ? expr.replace("json_extract(", "json_type(")
          : dialect.scalarType(expr);
    const compare = (v: Operand, op: string) => {
      const literal = value(v);
      if (literal === null) {
        if (op !== "IS") return "1=0";
        return `(${expr} IS NULL)`;
      }
      const types =
        typeof literal === "number"
          ? "'integer','real'"
          : typeof literal === "boolean"
            ? "'true','false'"
            : "'text'";
      if (typeof literal === "boolean" && op !== "IS") return "1=0";
      if (typeof column === "object") {
        const comparison = dialect.jsonCompare(
          column.document,
          column.path,
          (
            {
              IS: "eq",
              "<": "lt",
              "<=": "lte",
              ">": "gt",
              ">=": "gte",
            } as const
          )[op as "IS" | "<" | "<=" | ">" | ">="],
          literal,
        );
        bindings.push(...(comparison.parameters as Scalar[]));
        return `(${kind} IN (${types}) AND ${comparison.sql})`;
      }
      bindings.push(typeof literal === "boolean" ? Number(literal) : literal);
      return `(${kind} IN (${types}) AND ${expr} ${op === "IS" ? dialect.nullSafeEqual : op} ?)`;
    };
    if (p.op === "in")
      return p.values.length
        ? "(" + p.values.map((v) => compare(v, "IS")).join(" OR ") + ")"
        : "1=0";
    return compare(
      p.value,
      { eq: "IS", lt: "<", lte: "<=", gt: ">", gte: ">=" }[p.op],
    );
  };
  const grants = policy.grants.filter(
    (g) => g.resource === resource && g.action === action,
  );
  return {
    sql: grants.length
      ? "(" + grants.map((g) => emit(g.predicate)).join(" OR ") + ")"
      : "1=0",
    bindings,
  };
}
