import { readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9_]*$/.test(name))
  throw Error(
    "Usage: pnpm --filter @savia/db generate <lowercase_migration_name>",
  );
const dir = new URL("../packages/db/migrations/", import.meta.url);
const next =
  Math.max(
    0,
    ...readdirSync(dir)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .map((f) => Number(f.slice(0, 4))),
  ) + 1;
const target = new URL(`${String(next).padStart(4, "0")}_${name}.sql`, dir);
writeFileSync(
  target,
  "-- Add reviewed forward-only SQL. Separate complete statements with:\n-- --> statement-breakpoint\n",
  { flag: "wx" },
);
console.log(fileURLToPath(target));
