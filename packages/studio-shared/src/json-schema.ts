export type SchemaNode = Record<string, any>;
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
const equal = (a: any, b: any) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function resolveSchema(
  document: SchemaNode,
  schema: SchemaNode,
  seen = new Set<string>(),
): SchemaNode {
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    throw new Error("El esquema no es válido.");
  if (schema.$ref) {
    const ref = schema.$ref;
    if (typeof ref !== "string" || !ref.startsWith("#/"))
      throw new Error("Solo se admiten referencias locales #/.");
    if (seen.has(ref))
      throw new Error(
        "Las referencias circulares requieren un esquema sin ciclos.",
      );
    const node = ref
      .slice(2)
      .split("/")
      .reduce(
        (v: any, key: string) =>
          v?.[key.replace(/~1/g, "/").replace(/~0/g, "~")],
        document,
      );
    if (!node) throw new Error(`No se encontró la referencia ${ref}.`);
    const { $ref, ...siblings } = schema;
    return {
      ...resolveSchema(document, node, new Set(seen).add(ref)),
      ...siblings,
    };
  }
  return schema;
}
/** Materializes the supported JSON Schema subset; cycles/external references fail closed. */
export function materializeSchema(
  document: SchemaNode,
  raw: SchemaNode,
  trail = new Set<string>(),
  depth = 0,
  budget = { remaining: 10000 },
): SchemaNode {
  if (depth > 24 || --budget.remaining < 0)
    throw new Error("El esquema excede 24 niveles o 10000 nodos.");
  if (raw?.$ref && trail.has(raw.$ref))
    throw new Error(
      "Las referencias circulares requieren un esquema sin ciclos.",
    );
  const next = raw?.$ref ? new Set(trail).add(raw.$ref) : trail;
  const schema = resolveSchema(document, raw);
  const supported = new Set([
    "contentSchema",
    "contentMediaType",
    "contentEncoding",
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "allOf",
    "oneOf",
    "anyOf",
    "enum",
    "const",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minItems",
    "maxItems",
    "uniqueItems",
    "minProperties",
    "maxProperties",
    "nullable",
    "title",
    "description",
    "default",
    "example",
    "examples",
    "deprecated",
    "readOnly",
    "writeOnly",
    "discriminator",
    "xml",
    "externalDocs",
    "$schema",
    "$id",
    "$defs",
    "definitions",
    "$comment",
  ]);
  for (const keyword of Object.keys(schema))
    if (!supported.has(keyword) && !keyword.startsWith("x-"))
      throw new Error(
        `El validador no admite ${keyword}; simplifica el esquema.`,
      );
  const result: SchemaNode = { ...schema };
  if (schema.contentSchema)
    result.contentSchema = materializeSchema(document, schema.contentSchema, next, depth + 1, budget);
  if (schema.properties)
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, s]) => [
        key,
        materializeSchema(document, s as SchemaNode, next, depth + 1, budget),
      ]),
    );
  if (schema.items)
    result.items = materializeSchema(
      document,
      schema.items,
      next,
      depth + 1,
      budget,
    );
  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
  )
    result.additionalProperties = materializeSchema(
      document,
      schema.additionalProperties,
      next,
      depth + 1,
      budget,
    );
  for (const key of ["allOf", "oneOf", "anyOf"])
    if (schema[key])
      result[key] = schema[key].map((s: SchemaNode) =>
        materializeSchema(document, s, next, depth + 1, budget),
      );
  if (
    schema.pattern &&
    (schema.pattern.length > 120 ||
      /[()|]|\\[1-9]/.test(schema.pattern) ||
      (schema.pattern.match(/[+*{]/g)?.length ?? 0) > 1)
  )
    throw new Error("Patrón complejo no admitido.");
  if (schema.pattern)
    try {
      new RegExp(schema.pattern);
    } catch {
      throw new Error("Patrón inválido.");
    }
  return result;
}
export function validateJsonSchema(
  document: SchemaNode,
  raw: SchemaNode,
  value: unknown,
): string[] {
  const schema = materializeSchema(document, raw);
  const check = (s: SchemaNode, v: any, path: string, depth = 0): string[] => {
    if (depth > 24) return [`${path}: demasiados niveles`];
    const errors: string[] = [];
    const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
    const matches = (type: string) =>
      type === "null"
        ? v === null
        : type === "array"
          ? Array.isArray(v)
          : type === "object"
            ? v !== null && typeof v === "object" && !Array.isArray(v)
            : type === "integer"
              ? Number.isInteger(v)
              : type === "number"
                ? typeof v === "number" && Number.isFinite(v)
                : typeof v === type;
    if (types.length && !(v === null && s.nullable) && !types.some(matches))
      return [`${path}: tipo esperado ${types.join(" / ")}`];
    if (s.enum && !s.enum.some((x: any) => equal(x, v)))
      errors.push(`${path}: opción inválida`);
    if ("const" in s && !equal(s.const, v))
      errors.push(`${path}: valor fijo distinto`);
    for (const branch of s.allOf ?? [])
      errors.push(...check(branch, v, path, depth + 1));
    for (const key of ["oneOf", "anyOf"])
      if (s[key]) {
        const count = s[key].filter(
          (branch: SchemaNode) => !check(branch, v, path, depth + 1).length,
        ).length;
        if (key === "oneOf" ? count !== 1 : count < 1)
          errors.push(`${path}: no satisface ${key}`);
      }
    if (typeof v === "string") {
      if (s.minLength !== undefined && v.length < s.minLength)
        errors.push(`${path}: mínimo ${s.minLength} caracteres`);
      if (v.length > Math.min(s.maxLength ?? 100000, 100000))
        errors.push(`${path}: texto demasiado largo`);
      if (s.pattern && !new RegExp(s.pattern).test(v))
        errors.push(`${path}: formato inválido`);
      if (s.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
        errors.push(`${path}: correo inválido`);
      if (
        s.format === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
          !Number.isFinite(Date.parse(v)) ||
          new Date(v).toISOString().slice(0, 10) !== v)
      )
        errors.push(`${path}: fecha inválida`);
      if (
        s.format === "date-time" &&
        (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
          v,
        ) ||
          !Number.isFinite(Date.parse(v)))
      )
        errors.push(`${path}: fecha/hora inválida`);
      if (s.format === "uri")
        try {
          new URL(v);
        } catch {
          errors.push(`${path}: URL inválida`);
        }
    }
    if (typeof v === "number") {
      if (
        (s.minimum !== undefined && v < s.minimum) ||
        (s.maximum !== undefined && v > s.maximum)
      )
        errors.push(`${path}: fuera del rango permitido`);
      if (
        (typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum) ||
        (s.exclusiveMinimum === true && v <= s.minimum) ||
        (typeof s.exclusiveMaximum === "number" && v >= s.exclusiveMaximum) ||
        (s.exclusiveMaximum === true && v >= s.maximum)
      )
        errors.push(`${path}: fuera del rango exclusivo`);
      if (
        s.multipleOf &&
        Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) > 1e-9
      )
        errors.push(`${path}: múltiplo inválido`);
    }
    if (Array.isArray(v)) {
      if (
        v.length < (s.minItems ?? 0) ||
        v.length > Math.min(s.maxItems ?? 1000, 1000)
      )
        errors.push(`${path}: cantidad de elementos inválida`);
      if (
        s.uniqueItems &&
        new Set(v.map((x) => JSON.stringify(canonical(x)))).size !== v.length
      )
        errors.push(`${path}: elementos duplicados`);
      if (s.items)
        v.slice(0, 1001).forEach((x, i) =>
          errors.push(...check(s.items, x, `${path}[${i}]`, depth + 1)),
        );
    } else if (v !== null && typeof v === "object") {
      if (
        Object.keys(v).length < (s.minProperties ?? 0) ||
        Object.keys(v).length > (s.maxProperties ?? 10000)
      )
        errors.push(`${path}: cantidad de propiedades inválida`);
      for (const name of s.required ?? [])
        if (!Object.hasOwn(v, name) || v[name] === undefined)
          errors.push(`${path}.${name}: obligatorio`);
      for (const [name, child] of Object.entries(v)) {
        if (forbidden.has(name)) errors.push(`${path}: clave reservada`);
        else if (s.properties?.[name] && child !== undefined)
          errors.push(
            ...check(s.properties[name], child, `${path}.${name}`, depth + 1),
          );
        else if (s.additionalProperties === false)
          errors.push(`${path}.${name}: propiedad desconocida`);
        else if (typeof s.additionalProperties === "object")
          errors.push(
            ...check(
              s.additionalProperties,
              child,
              `${path}.${name}`,
              depth + 1,
            ),
          );
      }
    }
    return errors.slice(0, 30);
  };
  return check(schema, value, "Datos");
}
