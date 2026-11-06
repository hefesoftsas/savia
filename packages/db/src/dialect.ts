/** Explicit SQL operations; expression arguments are trusted application SQL. */
export type SqlStatement = { sql: string; parameters: unknown[] };
export type JsonOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
export interface SqlDialect {
  readonly name: "sqlite" | "postgres";
  quoteIdentifier(name: string): string;
  jsonValue(document: string, path: string): string;
  jsonText(document: string, path: string): string;
  jsonType(document: string, path: string): string;
  jsonEach(document: string, path: string, alias: string): string;
  jsonCompare(
    document: string,
    path: string,
    operator: JsonOperator,
    value: unknown,
  ): SqlStatement;
  jsonSort(document: string, path: string): string;
  scalarType(expression: string): string;
  nullSafeEqual: string;
  textLike(expression: string): string;
  booleanInteger(expression: string): string;
  utcNow(): string;
  tableExists(name: string): SqlStatement;
  tableColumns(name: string): SqlStatement;
}
export const sqlLiteral = (value: string) =>
  "'" + value.replaceAll("'", "''") + "'";
export const quoteIdentifier = (name: string) =>
  '"' + name.replaceAll('"', '""') + '"';
/** Paths are a root or a single field, including Unicode and punctuation. */
export function jsonField(path: string): string | null {
  if (path === "$") return null;
  if (!path.startsWith("$."))
    throw new Error("Expected a root or field JSON path");
  return path.slice(2);
}
const sqlitePath = (path: string) => {
  const field = jsonField(path);
  // SQLite JSON paths cannot consistently address embedded quotes across versions.
  // json_each's key equality below supports every key without path interpolation.
  return field;
};
const sqliteExtract = (
  document: string,
  path: string,
  column: "value" | "type",
) => {
  const field = sqlitePath(path);
  if (field === null)
    return column === "value"
      ? `json_extract(${document},'$')`
      : `json_type(${document},'$')`;
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field))
    return `${column === "value" ? "json_extract" : "json_type"}(${document},${sqlLiteral("$." + field)})`;
  return `(SELECT j.${column} FROM json_each(${document}) j WHERE j.key=${sqlLiteral(field)} LIMIT 1)`;
};
export const sqliteDialect: SqlDialect = {
  name: "sqlite",
  quoteIdentifier,
  jsonValue: (d, p) => sqliteExtract(d, p, "value"),
  jsonText: (d, p) => `CAST(${sqliteExtract(d, p, "value")} AS TEXT)`,
  jsonType: (d, p) => sqliteExtract(d, p, "type"),
  jsonEach(d, p, a) {
    const field = jsonField(p);
    if (field === null || /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field))
      return `json_each(${d},${sqlLiteral(p)}) ${quoteIdentifier(a)}`;
    const value = sqliteExtract(d, p, "value"),
      type = sqliteExtract(d, p, "type");
    return `(SELECT key,value,type FROM json_each(CASE WHEN ${type} IN ('array','object') THEN ${value} END) UNION ALL SELECT NULL,${value},${type} WHERE ${type} NOT IN ('array','object')) ${quoteIdentifier(a)}`;
  },
  jsonCompare: (d, p, op, value) => ({
    sql: `${sqliteExtract(d, p, "value")} ${{ eq: "IS", ne: "IS NOT", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op]} ?`,
    parameters: [typeof value === "boolean" ? Number(value) : value],
  }),
  jsonSort: (d, p) => sqliteExtract(d, p, "value"),
  scalarType: (e) => `typeof(${e})`,
  nullSafeEqual: "IS",
  textLike: (expression) => `${expression} LIKE ? ESCAPE '\\'`,
  booleanInteger: (e) => e,
  utcNow: () => "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  tableExists: (name) => ({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    parameters: [name],
  }),
  tableColumns: (name) => ({
    sql: `PRAGMA table_info(${quoteIdentifier(name)})`,
    parameters: [],
  }),
};
const dialects = new WeakMap<object, SqlDialect>();
export function dialectFor(database: object): SqlDialect {
  return dialects.get(database) ?? sqliteDialect;
}
export function registerDialect(database: object, dialect: SqlDialect): void {
  dialects.set(database, dialect);
}
export function inheritDialect(source: object, target: object): void {
  registerDialect(target, dialectFor(source));
}
