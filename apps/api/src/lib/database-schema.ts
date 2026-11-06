import { dialectFor } from "@savia/db/dialect";

/** Inspect only the current application schema, never another tenant database. */
export async function tableNames(
  db: D1Database,
  column?: string,
): Promise<string[]> {
  if (dialectFor(db).name === "postgres") {
    const query = column
      ? db
          .prepare(
            "SELECT DISTINCT table_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND column_name=?",
          )
          .bind(column)
      : db.prepare(
          "SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'",
        );
    return (await query.all<{ name: string }>()).results.map((row) => row.name);
  }
  const names = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
      )
      .all<{ name: string }>()
  ).results.map((row) => row.name);
  if (!column) return names;
  const matching: string[] = [];
  for (const name of names) {
    const query = dialectFor(db).tableColumns(name);
    const columns = await db
      .prepare(query.sql)
      .bind(...query.parameters)
      .all<{ name: string }>();
    if (columns.results.some((item) => item.name === column))
      matching.push(name);
  }
  return matching;
}
export type ForeignKey = {
  id: number;
  table: string;
  from: string;
  to: string | null;
  on_delete: string;
};
export async function foreignKeys(
  db: D1Database,
  name: string,
): Promise<ForeignKey[]> {
  if (dialectFor(db).name === "sqlite")
    return (
      await db
        .prepare(
          `PRAGMA foreign_key_list(${dialectFor(db).quoteIdentifier(name)})`,
        )
        .all<ForeignKey>()
    ).results;
  return (
    await db
      .prepare(
        `SELECT c.oid::bigint AS id, parent.relname AS "table", child_col.attname AS "from", parent_col.attname AS "to",
    CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class child ON child.oid=c.conrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid=child.relnamespace
    JOIN pg_catalog.pg_class parent ON parent.oid=c.confrelid
    CROSS JOIN LATERAL unnest(c.conkey,c.confkey) AS keys(child_id,parent_id)
    JOIN pg_catalog.pg_attribute child_col ON child_col.attrelid=child.oid AND child_col.attnum=keys.child_id
    JOIN pg_catalog.pg_attribute parent_col ON parent_col.attrelid=parent.oid AND parent_col.attnum=keys.parent_id
    WHERE c.contype='f' AND ns.nspname=current_schema() AND child.relname=?
    ORDER BY c.oid,child_col.attnum`,
      )
      .bind(name)
      .all<ForeignKey>()
  ).results;
}
