import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

test("preview provider credentials come from the deployment environment", async () => {
  const config = await readFile(
    new URL("./Pulumi.preview.yaml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    config,
    /^\s*cloudflare:apiToken\s*:/m,
    "a checked-in provider token overrides the rotated deployment credential",
  );
});
