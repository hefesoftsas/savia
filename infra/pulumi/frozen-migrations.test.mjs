import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
test("D1 helper consumes explicitly frozen migrations instead of checkout SQL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "savia-frozen-sql-"));
  try {
    await writeFile(
      join(directory, "0000.sql"),
      "SELECT 1;\n--> statement-breakpoint\nSELECT 2;",
    );
    const { stdout } = await exec(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../scripts/apply-d1-migrations.mjs", import.meta.url),
        ),
        "--dry-run",
        "--migrations-dir",
        directory,
      ],
      {
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
          CLOUDFLARE_DATABASE_ID: "fixture",
          CLOUDFLARE_API_TOKEN: "test-canary",
        },
      },
    );
    assert.match(stdout, /^1 migrations, 2 statements/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
