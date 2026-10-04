import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

test("isolates dependencies for every workspace package in writable volumes", async () => {
  const dockerfile = await readFile(".devcontainer/Dockerfile", "utf8");
  const mounted = new Set(
    [
      ...compose.matchAll(/^      - \w+:\/workspace\/(.+)\/node_modules$/gm),
    ].map(([, directory]) => directory),
  );
  const seeded = new Set(
    [...dockerfile.matchAll(/\/workspace\/(.+)\/node_modules/g)].map(
      ([, directory]) => directory,
    ),
  );
  const workspaces = new Set();
  for (const root of ["apps", "packages"]) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = `${root}/${entry.name}`;
      try {
        await readFile(`${directory}/package.json`);
        workspaces.add(directory);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  assert.deepEqual([...mounted].sort(), [...workspaces].sort());
  assert.deepEqual([...seeded].sort(), [...workspaces].sort());
});

test("connects the development Worker to the ready Mailpit service", () => {
  const dev = compose.split(/^  postgres:/m)[0];
  assert.match(dev, /SAVIA_SMTP_HOST:.*mailpit/);
  assert.match(dev, /SAVIA_SMTP_PORT:.*1025/);
  assert.match(dev, /SAVIA_SMTP_SECURITY:.*plain/);
  assert.match(dev, /SAVIA_SMTP_ALLOW_INSECURE:.*true/);
  assert.match(
    dev,
    /depends_on:\n      mailpit:\n        condition: service_healthy/,
  );
});

test("installs the package manager pinned by the repository", async () => {
  const dockerfile = await readFile(".devcontainer/Dockerfile", "utf8");
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.ok(
    dockerfile.includes(`pnpm@${manifest.packageManager.split("@")[1]}`),
  );
});
