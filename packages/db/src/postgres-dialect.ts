import {
  jsonField,
  quoteIdentifier,
  sqlLiteral,
  type SqlDialect,
} from "./dialect";
const node = (document: string, path: string) => {
  const field = jsonField(path);
  return field === null
    ? `(${document})::jsonb`
    : `((${document})::jsonb -> ${sqlLiteral(field)})`;
};
const rawNode = (d: string, p: string) =>
  jsonField(p) === null
    ? `(${d})::json`
    : `((${d})::json -> ${sqlLiteral(jsonField(p)!)})`;
// Keep quoted JSON strings intact while removing only structural whitespace.
const compactJson = (expression: string) =>
  `regexp_replace((${expression})::text, ${sqlLiteral(String.raw`("(?:[^"\\]|\\.)*")|\s+`)}, ${sqlLiteral(String.raw`\1`)}, 'g')`;
const numericText = (d: string, p: string) => {
  const raw = `(${rawNode(d, p)} #>> '{}')`;
  const number = `((${raw}::double precision)::text)`;
  return `(CASE WHEN ${raw} ~ '[.eE]' THEN regexp_replace(${number}, '^(-?[0-9]+)(e)', ${sqlLiteral(String.raw`\1.0\2`)}) || CASE WHEN ${number} !~ '[.eE]' THEN '.0' ELSE '' END ELSE ${raw} END)`;
};
const text = (d: string, p: string) => {
  const n = node(d, p);
  return `(CASE jsonb_typeof(${n}) WHEN 'null' THEN NULL WHEN 'boolean' THEN CASE WHEN ${n}='true'::jsonb THEN '1' ELSE '0' END WHEN 'number' THEN ${numericText(d, p)} WHEN 'array' THEN ${compactJson(rawNode(d, p))} WHEN 'object' THEN ${compactJson(rawNode(d, p))} ELSE ${rawNode(d, p)} #>> '{}' END) COLLATE "C"`;
};
const type = (d: string, p: string) => {
  const n = node(d, p);
  return `(CASE jsonb_typeof(${n}) WHEN 'string' THEN 'text' WHEN 'number' THEN CASE WHEN (${rawNode(d, p)})::text ~ '[.eE]' OR (${n} #>> '{}')::numeric NOT BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'real' ELSE 'integer' END WHEN 'boolean' THEN ${n} #>> '{}' ELSE jsonb_typeof(${n}) END)`;
};
// SQLite compares JSON numbers (including booleans) numerically, then text.
const rank = (d: string, p: string) =>
  `(CASE WHEN ${node(d, p)} IS NULL OR jsonb_typeof(${node(d, p)})='null' THEN NULL WHEN jsonb_typeof(${node(d, p)})='number' THEN 1 WHEN jsonb_typeof(${node(d, p)})='boolean' THEN 1 ELSE 2 END)`;
const numeric = (d: string, p: string) =>
  `(CASE WHEN ${rank(d, p)}=1 THEN (${text(d, p)})::numeric END)`;
export const postgresDialect: SqlDialect = {
  name: "postgres",
  quoteIdentifier,
  jsonValue: text,
  jsonText: text,
  jsonType: type,
  jsonEach(d, p, a) {
    const n = node(d, p);
    // Match json_each for objects, arrays, and scalar values, including JSON null.
    return `LATERAL (SELECT entry.key, ${text("entry.value", "$")} AS value, ${type("entry.value", "$")} AS type FROM json_each(CASE WHEN jsonb_typeof(${n})='object' THEN ${rawNode(d, p)} ELSE '{}'::json END) entry UNION ALL SELECT (entry.ordinality-1)::text, ${text("entry.value", "$")}, ${type("entry.value", "$")} FROM json_array_elements(CASE WHEN jsonb_typeof(${n})='array' THEN ${rawNode(d, p)} ELSE '[]'::json END) WITH ORDINALITY entry(value,ordinality) UNION ALL SELECT NULL, ${text(d, p)}, ${type(d, p)} WHERE jsonb_typeof(${n}) NOT IN ('object','array')) ${quoteIdentifier(a)}`;
  },
  jsonCompare(d, p, op, value) {
    const equal = op === "eq" || op === "ne";
    if (value === null)
      return {
        sql: equal
          ? `${text(d, p)} IS ${op === "ne" ? "NOT " : ""}NULL`
          : "FALSE",
        parameters: [],
      };
    if (!["number", "boolean", "string"].includes(typeof value))
      throw new Error("Unsupported JSON comparison value");
    const isNumber = typeof value !== "string",
      r = isNumber ? 1 : 2;
    const expr = isNumber ? numeric(d, p) : text(d, p);
    if (equal)
      return {
        sql: `${op === "ne" ? "NOT " : ""}(COALESCE(${rank(d, p)}=${r} AND ${expr} = ?,FALSE))`,
        parameters: [typeof value === "boolean" ? Number(value) : value],
      };
    const sqlOp = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
    return {
      sql: `(${rank(d, p)} ${op === "gt" || op === "gte" ? ">" : "<"} ${r} OR (${rank(d, p)}=${r} AND ${expr} ${sqlOp} ?))`,
      parameters: [typeof value === "boolean" ? Number(value) : value],
    };
  },
  jsonSort: (d, p) =>
    `ROW(COALESCE(${rank(d, p)},0),COALESCE(${numeric(d, p)},0),(CASE WHEN ${rank(d, p)}=2 THEN ${text(d, p)} ELSE '' END) COLLATE "C")`,
  scalarType: (e) =>
    `(CASE pg_typeof(${e})::text WHEN 'text' THEN 'text' WHEN 'character varying' THEN 'text' WHEN 'integer' THEN 'integer' WHEN 'bigint' THEN 'integer' WHEN 'double precision' THEN 'real' ELSE pg_typeof(${e})::text END)`,
  nullSafeEqual: "IS NOT DISTINCT FROM",
  textLike: (expression) =>
    `translate(${expression},'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') LIKE translate(?,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') ESCAPE '\\'`,
  booleanInteger: (e) => `CASE WHEN ${e} THEN 1 ELSE 0 END`,
  utcNow: () =>
    `to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  tableExists: (name) => ({
    sql: "SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?",
    parameters: [name],
  }),
  tableColumns: (name) => ({
    sql: `SELECT ordinal_position-1 AS cid,column_name AS name,data_type AS type,CASE WHEN is_nullable='NO' THEN 1 ELSE 0 END AS "notnull",column_default AS dflt_value,CASE WHEN EXISTS(SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.constraint_schema=kcu.constraint_schema WHERE tc.table_schema=c.table_schema AND tc.table_name=c.table_name AND tc.constraint_type='PRIMARY KEY' AND kcu.column_name=c.column_name) THEN 1 ELSE 0 END AS pk FROM information_schema.columns c WHERE table_schema=current_schema() AND table_name=? ORDER BY ordinal_position`,
    parameters: [name],
  }),
};
