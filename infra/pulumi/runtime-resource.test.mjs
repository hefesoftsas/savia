import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as pulumi from "@pulumi/pulumi";

test("compiled runtime resource preserves Pulumi's registered output properties", async () => {
  const dir = await mkdtemp(join(tmpdir(), "savia-runtime-compiled-"));
  const root = fileURLToPath(new URL("./", import.meta.url));
  try {
    execFileSync(
      process.execPath,
      [
        join(root, "node_modules/typescript/bin/tsc"),
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--skipLibCheck",
        "--allowJs",
        "--outDir",
        dir,
        join(root, "runtime-resource.ts"),
      ],
      { cwd: root, stdio: "pipe" },
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    await symlink(join(root, "node_modules"), join(dir, "node_modules"), "dir");
    pulumi.runtime.setMocks(
      {
        newResource: ({ inputs, name }) => ({
          id: name,
          state: {
            ...inputs,
            status: "ready",
            workerVersions: [{ versionId: "v1" }],
            namespaceIds: [],
            attachments: [],
          },
        }),
        call: ({ inputs }) => inputs,
      },
      "runtime-test",
      "unit",
    );
    const { RuntimeRelease } = await import(
      pathToFileURL(join(dir, "runtime-resource.js")).href
    );
    const release = new RuntimeRelease(
      "runtime",
      {
        accountId: "a".repeat(32),
        environment: "preview",
        workers: [{ name: "savia-preview", cloudId: "b".repeat(32) }],
        mode: "adopt",
      },
      () => ({}),
    );
    assert.equal(await pulumi.output(release.status).promise(), "ready");
    assert.deepEqual(await pulumi.output(release.namespaceIds).promise(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
