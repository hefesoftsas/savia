import type {
  AccessAction,
  AccessPolicy,
  AccessPredicate,
  AccessResource,
  Operand,
  Scalar,
} from "@savia/crm-shared/access-control";
import { HTTPException } from "hono/http-exception";
export function compileAccessWhere(
  policy: AccessPolicy,
  resource: AccessResource,
  action: AccessAction,
  columns: Readonly<Record<string, string>>,
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
    if ("all" in p) return p.all ? "1" : "0";
    if ("and" in p)
      return p.and.length ? "(" + p.and.map(emit).join(" AND ") + ")" : "0";
    if ("or" in p)
      return p.or.length ? "(" + p.or.map(emit).join(" OR ") + ")" : "0";
    const expr = Object.hasOwn(columns, p.field) ? columns[p.field] : undefined;
    if (!expr)
      throw new HTTPException(403, {
        message: "Unsupported permission predicate field.",
      });
    const kind = expr.startsWith("json_extract(")
      ? expr.replace("json_extract(", "json_type(")
      : `typeof(${expr})`;
    const compare = (v: Operand, op: string) => {
      const literal = value(v);
      if (literal === null) {
        if (op !== "IS") return "0";
        return `(${expr} IS NULL)`;
      }
      const types =
        typeof literal === "number"
          ? "'integer','real'"
          : typeof literal === "boolean"
            ? "'true','false'"
            : "'text'";
      if (typeof literal === "boolean" && op !== "IS") return "0";
      bindings.push(typeof literal === "boolean" ? Number(literal) : literal);
      return `(${kind} IN (${types}) AND ${expr} ${op} ?)`;
    };
    if (p.op === "in")
      return "(" + p.values.map((v) => compare(v, "IS")).join(" OR ") + ")";
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
      : "0",
    bindings,
  };
}
