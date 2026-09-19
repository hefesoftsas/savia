import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("migrates adopted insurance solutions to the optional quotes extension", async () => {
  const migration = await readFile(
    fileURLToPath(
      new URL(
        "../packages/db/migrations/0048_insurance_quotes_extension.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  assert.match(migration, /insurance\.quotes/);
  assert.match(migration, /json_set\(manifest, '\$\.requires'/);
});
