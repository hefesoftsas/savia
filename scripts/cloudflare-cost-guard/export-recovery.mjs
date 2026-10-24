import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.umask(0o077);
const directory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../infra/secrets/cloudflare-cost-guard",
);
const credentials = JSON.parse(
  await readFile(resolve(directory, "credentials.private.json"), "utf8"),
);
const records = [];
let cursor = "";
const seen = new Set();
do {
  if (seen.has(cursor))
    throw new Error("Repeated recovery cursor; refusing incomplete export");
  seen.add(cursor);
  const url = new URL(
    "https://savia-cost-guard.jose-douglas-dev.workers.dev/recovery",
  );
  if (cursor) url.searchParams.set("cursor", cursor);
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${credentials.GUARD_ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Recovery export failed (${r.status})`);
  const page = await r.json();
  if (!Array.isArray(page.records))
    throw new Error("Invalid recovery response");
  records.push(...page.records);
  cursor = page.nextCursor;
} while (cursor);
const target = resolve(
  directory,
  "recovery-export-" + Date.now() + ".private.json",
);
await writeFile(target, JSON.stringify(records, null, 2), { mode: 0o600 });
console.log(`Saved ${records.length} recovery records to ${target}`);
