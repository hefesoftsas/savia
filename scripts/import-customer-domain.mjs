import { spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = resolve(scriptDirectory, "..");

export const customerImportPlan = Object.freeze([
  { sourceTable: "app_country", targetTable: "countries" },
  { sourceTable: "app_department", targetTable: "departments" },
  { sourceTable: "app_city", targetTable: "cities" },
  {
    sourceTable: "app_economicactivity",
    targetTable: "app_economicactivity",
  },
  { sourceTable: "business_agency", targetTable: "agencies" },
  { sourceTable: "business_agencycontact", targetTable: "agency_contacts" },
  {
    sourceTable: "business_commercialunit",
    targetTable: "business_commercialunit",
  },
  { sourceTable: "app_documenttag", targetTable: "app_documenttag" },
  { sourceTable: "customer_group", targetTable: "customer_group" },
  { sourceTable: "business_seller", targetTable: "business_seller" },
  { sourceTable: "customer_address", targetTable: "customer_address" },
  { sourceTable: "customer_client", targetTable: "customer_client" },
  {
    sourceTable: "customer_clientagency",
    targetTable: "customer_clientagency",
  },
  {
    sourceTable: "customer_clientlog",
    targetTable: "customer_clientlog",
    nullColumns: ["created_by_id"],
  },
  {
    sourceTable: "customer_customersellershare",
    targetTable: "customer_customersellershare",
  },
  {
    sourceTable: "customer_naturalperson",
    targetTable: "customer_naturalperson",
  },
  { sourceTable: "customer_legalperson", targetTable: "customer_legalperson" },
  {
    sourceTable: "customer_legalpersoncontact",
    targetTable: "customer_legalpersoncontact",
  },
  {
    sourceTable: "customer_document",
    targetTable: "customer_document",
    nullColumns: ["uploaded_by_id"],
  },
  {
    sourceTable: "customer_document_tags",
    targetTable: "customer_document_tags",
  },
  { sourceTable: "customer_consortium", targetTable: "customer_consortium" },
  { sourceTable: "customer_prospect", targetTable: "customer_prospect" },
  {
    sourceTable: "customer_prospectdocument",
    targetTable: "customer_prospectdocument",
    nullColumns: ["uploaded_by_id"],
  },
  {
    sourceTable: "customer_prospectdocument_tags",
    targetTable: "customer_prospectdocument_tags",
  },
  {
    sourceTable: "customer_prospectlog",
    targetTable: "customer_prospectlog",
    nullColumns: ["created_by_id"],
  },
]);

function quotedIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function textLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function countryReconciliationStatements(rows) {
  return rows.flatMap(([rawId, code]) => {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id < 1)
      throw new Error(`Invalid source country ID: ${rawId}`);
    const literalCode = textLiteral(code);
    return [
      `UPDATE departments SET country_id = ${id} WHERE country_id IN (SELECT id FROM countries WHERE code = ${literalCode} AND id <> ${id});`,
      `UPDATE countries SET id = ${id} WHERE code = ${literalCode} AND id <> ${id};`,
    ];
  });
}

function parsePostgresArray(value) {
  if (value === "{}") return [];
  if (!value.startsWith("{") || !value.endsWith("}"))
    throw new Error(`Unsupported PostgreSQL array value: ${value}`);

  const values = [];
  let field = "";
  let quoted = false;
  let escaped = false;
  for (const character of value.slice(1, -1)) {
    if (escaped) {
      field += character;
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === ",") {
      values.push(field === "NULL" ? null : field);
      field = "";
      continue;
    }
    field += character;
  }
  if (quoted || escaped)
    throw new Error(`Malformed PostgreSQL array value: ${value}`);
  values.push(field === "NULL" ? null : field);
  return values;
}

export function convertSourceValue(value, column) {
  if (value === "\\N") return "NULL";
  if (column.dataType === "boolean") {
    if (value === "t") return "1";
    if (value === "f") return "0";
    throw new Error(
      `Invalid PostgreSQL boolean for ${column.columnName}: ${value}`,
    );
  }
  if (column.dataType === "ARRAY")
    return textLiteral(JSON.stringify(parsePostgresArray(value)));
  if (column.dataType === "jsonb" || column.dataType === "numeric")
    return textLiteral(value);
  if (
    ["smallint", "integer", "bigint"].includes(column.dataType) &&
    /^-?\d+$/.test(value)
  )
    return value;
  return textLiteral(value);
}

export function buildInsertStatement(plan, columns, values) {
  if (columns.length !== values.length)
    throw new Error(`Column and value counts differ for ${plan.sourceTable}`);
  const nullColumns = new Set(plan.nullColumns ?? []);
  const columnNames = columns.map(({ columnName }) => columnName);
  const encodedValues = values.map((value, index) =>
    nullColumns.has(columns[index].columnName)
      ? "NULL"
      : convertSourceValue(value, columns[index]),
  );
  const updateColumns = columnNames.filter((columnName) => columnName !== "id");
  const conflict = updateColumns.length
    ? `DO UPDATE SET ${updateColumns.map((columnName) => `${columnName} = excluded.${columnName}`).join(", ")}`
    : "DO NOTHING";
  return `INSERT INTO ${plan.targetTable} (${columnNames.join(", ")}) VALUES (${encodedValues.join(", ")}) ON CONFLICT(id) ${conflict};`;
}

export function parseCsv(content) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;
  let quotePending = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quotePending) {
      if (character === '"') {
        field += '"';
        quotePending = false;
        continue;
      }
      quoted = false;
      quotePending = false;
    }
    if (quoted) {
      if (character === '"') {
        quotePending = true;
        continue;
      }
      field += character;
      continue;
    }
    if (character === '"' && field === "") {
      quoted = true;
      continue;
    }
    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (character === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
      continue;
    }
    if (character !== "\r") field += character;
  }
  if (quotePending) quoted = false;
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

class StreamingCsvParser {
  #buffer = "";

  #quoted = false;

  #quotePending = false;

  #field = "";

  #row = [];

  push(content) {
    const rows = [];
    let index = 0;
    while (index < content.length) {
      const character = content[index];
      if (this.#quotePending) {
        if (character === '"') {
          this.#field += '"';
          this.#quotePending = false;
          index += 1;
          continue;
        }
        this.#quoted = false;
        this.#quotePending = false;
      }
      if (this.#quoted) {
        if (character === '"') this.#quotePending = true;
        else this.#field += character;
        index += 1;
        continue;
      }
      if (character === '"' && this.#field === "") {
        this.#quoted = true;
      } else if (character === ",") {
        this.#row.push(this.#field);
        this.#field = "";
      } else if (character === "\n") {
        this.#row.push(this.#field);
        rows.push(this.#row);
        this.#field = "";
        this.#row = [];
      } else if (character !== "\r") {
        this.#field += character;
      }
      index += 1;
    }
    return rows;
  }

  finish() {
    if (this.#quotePending) this.#quoted = false;
    if (this.#quoted) throw new Error("Unterminated quoted CSV field");
    if (!this.#field && !this.#row.length) return [];
    this.#row.push(this.#field);
    const lastRow = this.#row;
    this.#field = "";
    this.#row = [];
    return [lastRow];
  }
}

function parseArgs(args) {
  const unknown = args.filter((argument) => argument !== "--apply");
  if (unknown.length)
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  return { apply: args.includes("--apply") };
}

function sourceCommand(sql) {
  return [
    "compose",
    "exec",
    "-T",
    process.env.SAVIA_SOURCE_SERVICE ?? "postgres",
    "psql",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    process.env.SAVIA_SOURCE_USER ?? "savia",
    "-d",
    process.env.SAVIA_SOURCE_DB ?? "savia_source",
    "-c",
    sql,
  ];
}

function sourceCsv(sql) {
  const child = spawn("docker", sourceCommand(sql), {
    cwd: workspaceDirectory,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const completed = new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", resolvePromise);
  });
  return { completed, stdout: child.stdout, stderr: () => stderr };
}

async function collectSourceCsv(sql) {
  const { completed, stdout, stderr } = sourceCsv(sql);
  let content = "";
  stdout.setEncoding("utf8");
  for await (const chunk of stdout) content += chunk;
  const exitCode = await completed;
  if (exitCode !== 0) throw new Error(`Source query failed: ${stderr()}`);
  return parseCsv(content);
}

async function sourceColumns() {
  const sourceTables = customerImportPlan
    .map(({ sourceTable }) => textLiteral(sourceTable))
    .join(", ");
  const rows = await collectSourceCsv(
    `COPY (SELECT table_name, column_name, data_type, ordinal_position FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${sourceTables}) ORDER BY table_name, ordinal_position) TO STDOUT WITH (FORMAT csv, NULL '\\N');`,
  );
  return Map.groupBy(
    rows.map(([tableName, columnName, dataType]) => ({
      tableName,
      columnName,
      dataType,
    })),
    ({ tableName }) => tableName,
  );
}

async function reconcileCountries(sqlite) {
  const rows = await collectSourceCsv(
    "COPY (SELECT id, code FROM app_country ORDER BY id) TO STDOUT WITH (FORMAT csv, NULL '\\N');",
  );
  for (const statement of countryReconciliationStatements(rows))
    await sqlite.write(statement);
}

async function sourceCount(sourceTable) {
  const rows = await collectSourceCsv(
    `COPY (SELECT count(*) FROM ${quotedIdentifier(sourceTable)}) TO STDOUT WITH (FORMAT csv, NULL '\\N');`,
  );
  return Number(rows[0]?.[0] ?? 0);
}

async function discoverLocalD1() {
  if (process.env.SAVIA_LOCAL_D1_FILE) {
    await access(process.env.SAVIA_LOCAL_D1_FILE);
    return process.env.SAVIA_LOCAL_D1_FILE;
  }
  const directory = join(
    workspaceDirectory,
    "apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject",
  );
  const candidates = (await readdir(directory))
    .filter((entry) => entry.endsWith(".sqlite") && entry !== "metadata.sqlite")
    .map((entry) => join(directory, entry));
  if (candidates.length !== 1)
    throw new Error(
      `Expected one persisted local D1 database, found ${candidates.length}`,
    );
  return candidates[0];
}

function startSqlite(databaseFile) {
  const child = spawn("sqlite3", ["-bail", databaseFile], {
    cwd: workspaceDirectory,
    stdio: ["pipe", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const completed = new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`SQLite import failed: ${stderr}`));
    });
  });
  return {
    child,
    errorOutput: () => stderr,
    write: (statement) =>
      new Promise((resolvePromise, reject) => {
        child.stdin.write(`${statement}\n`, (error) => {
          if (error) reject(error);
          else resolvePromise();
        });
      }),
    close: async () => {
      child.stdin.end();
      await completed;
    },
  };
}

async function streamTableRows(sourceTable, onRow) {
  const { completed, stdout, stderr } = sourceCsv(
    `COPY (SELECT * FROM ${quotedIdentifier(sourceTable)} ORDER BY id) TO STDOUT WITH (FORMAT csv, NULL '\\N');`,
  );
  const parser = new StreamingCsvParser();
  stdout.setEncoding("utf8");
  for await (const chunk of stdout)
    for (const row of parser.push(chunk)) await onRow(row);
  for (const row of parser.finish()) await onRow(row);
  const exitCode = await completed;
  if (exitCode !== 0)
    throw new Error(`Source stream failed for ${sourceTable}: ${stderr()}`);
}

async function importAll(databaseFile, columnsByTable) {
  const sqlite = startSqlite(databaseFile);
  const counts = new Map();
  try {
    await sqlite.write("PRAGMA busy_timeout = 10000;");
    await sqlite.write("PRAGMA foreign_keys = ON;");
    await sqlite.write("PRAGMA defer_foreign_keys = ON;");
    await sqlite.write("BEGIN IMMEDIATE;");
    await reconcileCountries(sqlite);
    for (const plan of customerImportPlan) {
      const columns = columnsByTable.get(plan.sourceTable);
      if (!columns?.length)
        throw new Error(`No source columns found for ${plan.sourceTable}`);
      let count = 0;
      await streamTableRows(plan.sourceTable, async (row) => {
        await sqlite.write(buildInsertStatement(plan, columns, row));
        count += 1;
      });
      counts.set(plan.targetTable, count);
      console.info(
        `${plan.sourceTable}: ${count.toLocaleString("en-US")} rows staged`,
      );
    }
    await sqlite.write("COMMIT;");
    await sqlite.close();
    return counts;
  } catch (error) {
    try {
      await sqlite.write("ROLLBACK;");
    } catch {
      // The SQLite process may have already exited after the triggering error.
    }
    try {
      await sqlite.close();
    } catch {
      // Preserve the source error as the actionable failure.
    }
    throw error;
  }
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  const sourceCounts = await Promise.all(
    customerImportPlan.map(async (plan) => ({
      ...plan,
      count: await sourceCount(plan.sourceTable),
    })),
  );
  const total = sourceCounts.reduce((sum, { count }) => sum + count, 0);
  console.table(
    sourceCounts.map(({ sourceTable, targetTable, count }) => ({
      sourceTable,
      targetTable,
      rows: count,
    })),
  );
  console.info(`Planned rows: ${total.toLocaleString("en-US")}`);
  if (!apply) {
    console.info("Dry run only. Re-run with --apply to write local D1.");
    return;
  }

  const [databaseFile, columnsByTable] = await Promise.all([
    discoverLocalD1(),
    sourceColumns(),
  ]);
  const importedCounts = await importAll(databaseFile, columnsByTable);
  console.info(
    `Committed ${[...importedCounts.values()].reduce((sum, count) => sum + count, 0).toLocaleString("en-US")} local D1 rows.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
