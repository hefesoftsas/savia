/**
 * Applies packages/db/migrations/*.sql to a remote D1 database one statement
 * at a time.
 *
 * The migration files are Drizzle-generated and separate statements with
 * `--> statement-breakpoint`. `wrangler d1 migrations apply` sends each file
 * as one multi-statement query and the remote D1 API truncates
 * `CREATE TRIGGER ... BEGIN ... END;` bodies, while drizzle-kit batches every
 * pending statement into a single request that D1 rejects. Sending one
 * statement per request keeps both trigger bodies and large migrations intact.
 *
 * Requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID and
 * CLOUDFLARE_API_TOKEN.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = process.env.CLOUDFLARE_DATABASE_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const dryRun = process.argv.includes("--dry-run");

if (
  accountId === undefined ||
  databaseId === undefined ||
  token === undefined
) {
  console.error(
    "CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID and CLOUDFLARE_API_TOKEN are required",
  );
  process.exit(1);
}

const migrationsDir = fileURLToPath(
  new URL("../packages/db/migrations/", import.meta.url),
);
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

async function query(sql) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ sql }),
  });
  const payload = await response.json();
  if (response.ok === false || payload.success === false) {
    throw new Error(
      `D1 query failed (${response.status}): ${JSON.stringify(payload.errors ?? payload)}`,
    );
  }
  return payload.result ?? [];
}

function splitStatements(sql) {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

const files = (await readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

if (dryRun) {
  let total = 0;
  for (const file of files) {
    const statements = splitStatements(
      await readFile(migrationsDir + file, "utf8"),
    );
    total += statements.length;
  }
  console.log(`${files.length} migrations, ${total} statements`);
  process.exit(0);
}

await query(
  "CREATE TABLE IF NOT EXISTS _savia_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
);
const [appliedRows] = await query("SELECT filename FROM _savia_migrations");
const applied = new Set(
  (appliedRows?.results ?? []).map((row) => row.filename),
);

let pending = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  pending += 1;
  const statements = splitStatements(
    await readFile(migrationsDir + file, "utf8"),
  );
  // Only recover the verified prefix from the failed preview deployment.
  // Replaying bootstrap assignments could restore roles deliberately removed
  // after that prefix committed, so none of its data statements run again.
  const completedPrefix = new Set();
  if (file === "0055_access_control.sql") {
    const [schema] = await query(
      "SELECT name, type, sql FROM sqlite_master WHERE name LIKE 'access_%'",
    );
    const existing = new Map(
      (schema?.results ?? []).map((row) => [row.name, row]),
    );
    if (existing.size) {
      const normalize = (value) =>
        value.replace(/\s+/g, " ").trim().replace(/;$/, "");
      for (const [index, statement] of statements.entries()) {
        const definition = statement.replace(/^--[^\n]*(?:\n|$)/gm, "").trim();
        const object = /^CREATE (TABLE|INDEX|TRIGGER) (access_[a-z_]+)/.exec(
          definition,
        );
        if (object) {
          const saved = existing.get(object[2]);
          if (!saved && index >= 22) continue;
          if (
            !saved ||
            saved.type !== object[1].toLowerCase() ||
            normalize(saved.sql) !== normalize(definition)
          )
            throw new Error(
              `Unexpected ${object[2]} schema; refusing migration recovery`,
            );
        }
        completedPrefix.add(index);
      }
    }
  }
  if (file === "0063_tenant_crm_and_assistant_tables.sql") {
    const [schema] = await query(
      "SELECT name, type FROM sqlite_master WHERE name IN ('tenant_crm_connections', 'agency_crm_connections')",
    );
    const existing = new Map(
      (schema?.results ?? []).map((row) => [row.name, row.type]),
    );
    if (
      existing.get("agency_crm_connections") === "table" &&
      existing.has("tenant_crm_connections")
    ) {
      await query("DROP TABLE tenant_crm_connections");
    }
  }
  for (const [index, statement] of statements.entries()) {
    if (completedPrefix.has(index)) continue;
    try {
      // 0046 previously failed after committing its first 34 statements. Its
      // data moves and staging tables are replayable, but SQLite has no
      // ADD COLUMN IF NOT EXISTS. Inspect this one known recovery boundary;
      // do not swallow arbitrary migration errors or mark a partial file done.
      if (file === "0046_tenant_user_invariant.sql" && index === 0) {
        const [columns] = await query("PRAGMA table_info(tenants)");
        const kind = columns?.results?.find((column) => column.name === "kind");
        if (kind) {
          if (
            kind.type !== "TEXT" ||
            kind.notnull !== 1 ||
            kind.dflt_value !== "'commercial'"
          ) {
            throw new Error(
              "Unexpected tenants.kind schema; refusing migration recovery",
            );
          }
          continue;
        }
      }
      await query(statement);
    } catch (error) {
      throw new Error(
        `${file} statement ${index + 1}/${statements.length} failed: ${error.message}\n---\n${statement.slice(0, 400)}`,
      );
    }
  }
  const escaped = file.replaceAll("'", "''");
  await query(
    `INSERT INTO _savia_migrations (filename, applied_at) VALUES ('${escaped}', '${new Date().toISOString()}')`,
  );
  console.log(`applied ${file} (${statements.length} statements)`);
}
console.log(
  pending === 0
    ? "D1 schema is up to date."
    : `Applied ${pending} pending migration(s).`,
);
