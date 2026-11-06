/**
 * Drops every user table in a remote D1 database, children first so foreign
 * key constraints are not violated. Destructive one-off helper used to start
 * from a clean schema when a database was migrated by another tool.
 *
 * Requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID and
 * CLOUDFLARE_API_TOKEN.
 */
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = process.env.CLOUDFLARE_DATABASE_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;

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

const [tables] = await query(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
);
const names = (tables?.results ?? []).map((row) => row.name);
if (names.length === 0) {
  console.log("No user tables to drop.");
} else {
  // child -> parents it references
  const parents = new Map();
  for (const name of names) {
    const escaped = name.replaceAll('"', '""');
    const [rows] = await query(`PRAGMA foreign_key_list("${escaped}")`);
    parents.set(name, new Set((rows?.results ?? []).map((row) => row.table)));
  }

  const remaining = new Set(names);
  const order = [];
  while (remaining.size > 0) {
    let ready = [...remaining].filter((table) =>
      [...remaining].every(
        (other) => other === table || parents.get(other)?.has(table) !== true,
      ),
    );
    if (ready.length === 0) ready = [...remaining];
    for (const table of ready) {
      order.push(table);
      remaining.delete(table);
    }
  }

  const dropped = [];
  for (const name of order) {
    await query(`DROP TABLE IF EXISTS "${name.replaceAll('"', '""')}"`);
    dropped.push(name);
  }
  console.log(`Dropped ${dropped.length} tables: ${dropped.join(", ")}`);
}
