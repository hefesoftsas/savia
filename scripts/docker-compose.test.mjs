import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compose = await readFile("docker-compose.yml", "utf8");

test("keeps Workers together instead of introducing separate network services", () => {
  assert.doesNotMatch(compose, /^  (?:api|mcp):/m);
  assert.doesNotMatch(compose, /SAVIA_PROVIDER_(?:SURA_BASE_URL|GATEWAY_URL)/);
});

test("makes the legacy PostgreSQL source opt-in", () => {
  assert.match(
    compose,
    /^  postgres:\n[\s\S]*?^    profiles:\n      - legacy-source/m,
  );
});
