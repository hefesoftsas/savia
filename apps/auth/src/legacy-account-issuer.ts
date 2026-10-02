import { dialectFor } from "@savia/db/dialect";

const tableName = "account";
const repairTableName = "__savia_account_issuer_repair";
const obsoleteIndexColumns = ["issuer", "accountid"];

type SqliteObject = {
  name: string;
  sql: string | null;
  type: "index" | "trigger";
};
type TableInfo = { name: string; notnull: number; pk: number };
type IndexInfo = { name: string; unique: number; origin: string };
type IndexColumn = { name: string | null; seqno: number };

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function makeNullableIssuerTableSql(sql: string): string {
  const create = /^CREATE TABLE "account"\s*\(/i;
  const issuer = /("issuer"\s+text)\s+NOT NULL\b/i;
  if (!create.test(sql) || !issuer.test(sql))
    throw new Error("Unsupported legacy account table definition");
  return sql
    .replace(create, `CREATE TABLE ${quoteIdentifier(repairTableName)} (`)
    .replace(issuer, "$1");
}

async function isNullable(database: D1Database): Promise<boolean> {
  const columns = await database
    .prepare('PRAGMA table_info("account")')
    .all<TableInfo>();
  const issuer = columns.results.find(
    (column) => column.name.toLowerCase() === "issuer",
  );
  return Boolean(issuer && issuer.notnull === 0);
}

/**
 * Better Auth 1.7.0–1.7.2 left a required account.issuer column and unique
 * (issuer, accountId) index behind. Current versions do not write issuer.
 * Rebuild only that known legacy shape, preserving all rows and other objects.
 */
export async function ensureLegacyAccountIssuerOptional(
  database: D1Database,
): Promise<void> {
  if (dialectFor(database).name === "postgres") return;
  if (await isNullable(database)) return;

  const table = await database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .bind(tableName)
    .first<{ sql: string | null }>();
  if (!table?.sql) return;

  const columns = await database
    .prepare('PRAGMA table_info("account")')
    .all<TableInfo>();
  const issuer = columns.results.find(
    (column) => column.name.toLowerCase() === "issuer",
  );
  if (!issuer || issuer.notnull !== 1) return;
  if (issuer.pk !== 0)
    throw new Error("Refusing to change a primary-key account.issuer column");

  const temp = await database
    .prepare("SELECT name FROM sqlite_master WHERE name=?")
    .bind(repairTableName)
    .first<{ name: string }>();
  if (temp)
    throw new Error(
      "Refusing legacy account issuer repair: temporary table already exists",
    );

  const tableDefinitions = await database
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>?",
    )
    .bind(tableName)
    .all<{ name: string; sql: string | null }>();
  const externalReference = tableDefinitions.results.find(({ sql }) =>
    /\breferences\s*(?:"account"|`account`|\[account\]|account)(?:\s|\(|$)/i.test(
      sql?.replace(/\s+/g, " ") ?? "",
    ),
  );
  if (externalReference)
    throw new Error(
      `Refusing legacy account issuer repair: ${externalReference.name} may reference account`,
    );

  const objects = await database
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type, name",
    )
    .bind(tableName)
    .all<SqliteObject>();
  const indexInfo = await database
    .prepare(`PRAGMA index_list(${quoteIdentifier(tableName)})`)
    .all<IndexInfo>();
  const indexes: SqliteObject[] = [];
  for (const object of objects.results) {
    if (object.type !== "index") {
      indexes.push(object);
      continue;
    }
    const info = indexInfo.results.find((index) => index.name === object.name);
    const indexColumns = await database
      .prepare(`PRAGMA index_info(${quoteIdentifier(object.name)})`)
      .all<IndexColumn>();
    const columnsInIndex = indexColumns.results
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name?.toLowerCase());
    if (
      Number(info?.unique) === 1 &&
      columnsInIndex.length === obsoleteIndexColumns.length &&
      columnsInIndex.every(
        (column, index) => column === obsoleteIndexColumns[index],
      )
    ) {
      continue;
    }
    indexes.push(object);
  }

  const columnNames = columns.results.map((column) => column.name);
  const copyColumns = columnNames.map(quoteIdentifier).join(", ");
  const savedObjects = indexes.map((object) => object.sql!);
  try {
    await database.batch([
      database.prepare(makeNullableIssuerTableSql(table.sql)),
      database.prepare(
        `INSERT INTO ${quoteIdentifier(repairTableName)} (${copyColumns}) SELECT ${copyColumns} FROM ${quoteIdentifier(tableName)}`,
      ),
      database.prepare(`DROP TABLE ${quoteIdentifier(tableName)}`),
      database.prepare(
        `ALTER TABLE ${quoteIdentifier(repairTableName)} RENAME TO ${quoteIdentifier(tableName)}`,
      ),
      ...savedObjects.map((sql) => database.prepare(sql)),
    ]);
  } catch (error) {
    // Another isolate may have completed the same atomic rebuild after our
    // metadata read. Accept only the completed compatible schema.
    if (await isNullable(database)) return;
    throw error;
  }
}
