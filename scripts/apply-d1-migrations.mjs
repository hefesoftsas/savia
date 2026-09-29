/**
 * Apply reviewed D1 SQL as transactional statement batches. Statement
 * breakpoints preserve trigger bodies; migration ledger updates commit in the
 * same batch. Retired histories require an explicit verified reset.
 * Requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID and CLOUDFLARE_API_TOKEN.
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
    body: JSON.stringify(
      Array.isArray(sql)
        ? { batch: sql.map((statement) => ({ sql: statement })) }
        : { sql },
    ),
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

const unknown = [...applied].filter((filename) => !files.includes(filename));
if (unknown.length)
  throw new Error(
    "Database uses the retired migration history. Reset or explicitly reconcile its verified schema before applying the initial baseline.",
  );

let pending = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const statements = splitStatements(
    await readFile(migrationsDir + file, "utf8"),
  );
  const escaped = file.replaceAll("'", "''");
  // One transactional D1 batch preserves complete trigger bodies and prevents
  // partially applied initial schemas or bootstrap rows on retry.
  await query([
    ...statements,
    `INSERT INTO _savia_migrations(filename,applied_at) VALUES ('${escaped}',datetime('now'))`,
  ]);
  pending += 1;
  console.log(`Applied ${file} (${statements.length} statements).`);
}
console.log(
  pending
    ? `Applied ${pending} pending migration(s).`
    : "D1 schema is up to date.",
);
