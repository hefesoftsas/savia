import type { CrmObject } from "./metadata";
export type Condition = {
  field: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "empty" | "in";
  value?: unknown;
};
export function evaluateCondition(
  condition: Condition | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!condition) return true;
  const actual = values[condition.field],
    expected = condition.value;
  switch (condition.op) {
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "gt":
      return typeof actual === "number" && actual > Number(expected);
    case "gte":
      return typeof actual === "number" && actual >= Number(expected);
    case "lt":
      return typeof actual === "number" && actual < Number(expected);
    case "lte":
      return typeof actual === "number" && actual <= Number(expected);
    case "contains":
      return Array.isArray(actual)
        ? actual.includes(expected)
        : String(actual ?? "")
            .toLocaleLowerCase()
            .includes(String(expected ?? "").toLocaleLowerCase());
    case "empty":
      return (
        actual == null ||
        actual === "" ||
        (Array.isArray(actual) && actual.length === 0)
      );
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    default:
      return false;
  }
}

export function isSectionVisible(
  section: { visibleWhen?: Condition } | undefined,
  values: Record<string, unknown>,
): boolean {
  return evaluateCondition(section?.visibleWhen, values);
}

export function prepareRecord(
  object: CrmObject,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const data = { ...values };
  const done = new Set<string>(),
    visiting = new Set<string>();
  for (const [name, field] of Object.entries(object.config.fields))
    if (data[name] === undefined && field.defaultValue !== undefined)
      data[name] = structuredClone(field.defaultValue);
  function compute(name: string) {
    if (done.has(name)) return;
    const formula = object.config.fields[name]?.config?.formula as
      { op: string; fields: string[] } | undefined;
    if (!formula) return;
    if (visiting.has(name))
      throw new Error("Dependencia circular en los cálculos.");
    visiting.add(name);
    formula.fields.forEach(compute);
    const raw = formula.fields.map((field) => data[field]);
    if (
      raw.some(
        (v) =>
          v == null || v === "" || typeof v !== "number" || !Number.isFinite(v),
      )
    )
      data[name] = null;
    else {
      const numbers = raw as number[];
      const result =
        formula.op === "sum"
          ? numbers.reduce((a, b) => a + b, 0)
          : formula.op === "product"
            ? numbers.reduce((a, b) => a * b, 1)
            : formula.op === "difference"
              ? numbers[0] - numbers[1]
              : numbers[1] === 0
                ? null
                : numbers[0] / numbers[1];
      data[name] =
        result !== null && Number.isFinite(result)
          ? Math.round(result * 1e8) / 1e8
          : null;
    }
    visiting.delete(name);
    done.add(name);
  }
  Object.keys(object.config.fields).forEach(compute);
  return data;
}
