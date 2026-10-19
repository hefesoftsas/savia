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
  const workspaceConfig = await readFile("pnpm-workspace.yaml", "utf8");
  const mounted = new Set(
    [
      ...compose.matchAll(/^      - \w+:\/workspace\/(.+)\/node_modules$/gm),
    ].map(([, directory]) => directory),
  );
  const mountedVolumeNames = [
    ...compose.matchAll(/^      - (\w+):\/workspace\/.+\/node_modules$/gm),
  ].map(([, name]) => name);
  const volumeSection = compose.match(/^volumes:\n((?:[ \t]+[^\n]*\n)*)/m)?.[1];
  const declaredVolumeNames = new Set(
    [...(volumeSection ?? "").matchAll(/^  ([^:\n]+):/gm)].map(
      ([, name]) => name,
    ),
  );
  const seeded = new Set(
    [...dockerfile.matchAll(/\/workspace\/(.+)\/node_modules/g)].map(
      ([, directory]) => directory,
    ),
  );
  const packagePatterns = workspaceConfig
    .match(/^packages:\n((?:[ \t]+-\s+[^\n]*\n)+)/m)?.[1]
    .matchAll(/^\s+-\s+([^\s#]+)/gm);
  assert.ok(
    packagePatterns,
    "pnpm-workspace.yaml must declare package patterns",
  );

  async function expandPackagePattern(pattern) {
    let paths = [""];
    for (const segment of pattern.split("/")) {
      const nextPaths = [];
      for (const base of paths) {
        if (segment === "*") {
          const entries = await readdir(base || ".", { withFileTypes: true });
          nextPaths.push(
            ...entries
              .filter((entry) => entry.isDirectory())
              .map((entry) => (base ? `${base}/${entry.name}` : entry.name)),
          );
        } else {
          nextPaths.push(base ? `${base}/${segment}` : segment);
        }
      }
      paths = nextPaths;
    }
    const workspaces = [];
    for (const directory of paths) {
      try {
        await readFile(`${directory}/package.json`);
        workspaces.push(directory);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return workspaces;
  }

  const workspaces = new Set();
  for (const [, pattern] of packagePatterns) {
    for (const directory of await expandPackagePattern(pattern)) {
      workspaces.add(directory);
    }
  }
  assert.deepEqual([...mounted].sort(), [...workspaces].sort());
  for (const name of mountedVolumeNames) {
    assert.ok(
      declaredVolumeNames.has(name),
      `workspace dependency volume ${name} must be declared at the Compose root`,
    );
  }
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
