import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { packageStorePlugin } from "./pack-store-plugin.mjs";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlugin } from "./plugin-create.mjs";
import { localOrigin, createBuildQueue } from "./plugin-dev.mjs";

test("scaffolds a workspace plugin with SDK/UI and refuses traversal or overwrite", () => {
  const root = mkdtempSync(join(tmpdir(), "savia-plugin-create-"));
  try {
    mkdirSync(join(root, "packages"));
    assert.throws(() => createPlugin("../oops", root));
    for (const name of ["tasks-", "tasks--items", "-tasks"]) {
      assert.throws(() => createPlugin(name, root), /lowercase plugin name/);
      assert.equal(existsSync(join(root, "packages", `plugin-${name}`)), false);
    }
    const directory = createPlugin("work-items", root);
    const manifest = JSON.parse(
      readFileSync(join(directory, "savia-extension.json"), "utf8"),
    );
    const store = JSON.parse(
      readFileSync(join(directory, "store.json"), "utf8"),
    );
    assert.equal(manifest.id, "custom.work-items");
    assert.equal(store.screens[0].object, "work_items");
    assert.equal(store.collections[0].object.name, "work_items");
    assert.match(
      readFileSync(join(directory, "entry.tsx"), "utf8"),
      /defineReactPlugin/,
    );
    assert.ok(existsSync(join(directory, "test/collections.test.ts")));
    assert.throws(() => createPlugin("work-items", root), /EEXIST/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("development origin cannot target remote hosts or carry credentials/query", () => {
  assert.equal(localOrigin("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  for (const value of [
    "https://savia-preview.hefesoft.com",
    "http://evil.test",
    "http://localhost.evil.test",
    "http://user:pass@localhost",
    "http://localhost/path",
    "http://localhost?key=x",
  ])
    assert.throws(() => localOrigin(value));
});

test("watch rebuilds are serialized and changes during a failed build recover", async () => {
  let release,
    calls = 0,
    active = 0,
    maxActive = 0;
  const errors = [];
  const queue = createBuildQueue(
    async () => {
      calls++;
      active++;
      maxActive = Math.max(active, maxActive);
      if (calls === 1) {
        await new Promise((resolve) => {
          release = resolve;
        });
        active--;
        throw new Error("Invalid source");
      }
      active--;
    },
    (error) => errors.push(error.message),
  );
  const pending = queue.run();
  await queue.run();
  await queue.run();
  release();
  await pending;
  assert.equal(calls, 2);
  assert.equal(maxActive, 1);
  assert.deepEqual(errors, ["Invalid source"]);
  queue.stop();
  await queue.run();
  assert.equal(calls, 2);
});

test("development versions are staged without changing the release manifest", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const directory = join(root, "packages/plugin-example-tasks");
  const manifestPath = join(directory, "savia-extension.json");
  const original = readFileSync(manifestPath, "utf8");
  const temporary = mkdtempSync(join(tmpdir(), "savia-plugin-pack-"));
  try {
    const outputPath = join(temporary, "plugin.zip");
    const result = packageStorePlugin({
      portDir: directory,
      outputPath,
      versionOverride: "1.0.123456789",
    });
    const staged = JSON.parse(
      execFileSync("unzip", ["-p", outputPath, "savia-extension.json"], {
        encoding: "utf8",
      }),
    );
    assert.equal(staged.version, "1.0.123456789");
    assert.equal(readFileSync(manifestPath, "utf8"), original);
    assert.ok(result.inputs.includes(join(directory, "entry.tsx")));
    assert.ok(
      result.inputs.some((path) => path.includes("packages/plugin-ui/src/")),
    );
    const originals = JSON.parse(
      execFileSync("unzip", ["-p", outputPath, "src/original-source.json"], {
        encoding: "utf8",
      }),
    );
    assert.equal(
      originals["packages/plugin-example-tasks/entry.tsx"],
      readFileSync(join(directory, "entry.tsx"), "utf8"),
    );
    assert.equal(
      originals["packages/plugin-ui/src/workbench.tsx"],
      readFileSync(join(root, "packages/plugin-ui/src/workbench.tsx"), "utf8"),
    );
    assert.ok(Object.keys(originals).some((path) => path.endsWith(".css")));
    assert.ok(
      Object.keys(originals).every((path) => !path.includes("node_modules")),
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
