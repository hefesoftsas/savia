import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderSharedRegistry } from "./shared-registry/render.mjs";

const backend = {
  CLOUDFLARE_ACCOUNT_ID: "08a0d36f8b0357684f83e4bfeb6628b6",
  PULUMI_BACKEND_URL:
    "s3://savia-pulumi-state?endpoint=example.r2.cloudflarestorage.com&region=auto",
  PULUMI_CONFIG_PASSPHRASE: "test-passphrase",
  AWS_ACCESS_KEY_ID: "test-access",
  AWS_SECRET_ACCESS_KEY: "test-secret",
};
const outputs = {
  cloudflareAccountId: backend.CLOUDFLARE_ACCOUNT_ID,
  environment: "shared",
  workerName: "savia-plugin-registry",
  bucketName: "savia-plugin-registry",
  bucketProtected: true,
};

test("shared registry refuses a publisher account different from the adopted bucket account", async () => {
  await assert.rejects(
    renderSharedRegistry({
      env: {
        ...backend,
        CLOUDFLARE_ACCOUNT_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      run: async (_command, args) => ({
        stdout: args[1] === "output" ? JSON.stringify(outputs) : "",
      }),
    }),
    /account.*match/i,
  );
});

test("shared registry renderer selects the existing stack and writes production config", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "savia-shared-render-"));
  const calls = [];
  try {
    const result = await renderSharedRegistry({
      outputRoot,
      env: backend,
      run: async (command, args, options) => {
        calls.push({ command, args, options });
        return {
          stdout:
            args[0] === "stack" && args[1] === "output"
              ? JSON.stringify(outputs)
              : "",
        };
      },
    });
    const config = JSON.parse(
      await readFile(
        join(outputRoot, "apps/plugin-registry/wrangler.production.jsonc"),
        "utf8",
      ),
    );

    assert.equal(result.name, "savia-plugin-registry");
    assert.equal(config.name, "savia-plugin-registry");
    assert.deepEqual(config.r2_buckets, [
      { binding: "PLUGIN_REGISTRY", bucket_name: "savia-plugin-registry" },
    ]);
    assert.deepEqual(
      calls.map(({ args }) => args.slice(0, 3)),
      [
        ["login", backend.PULUMI_BACKEND_URL, "--non-interactive"],
        ["stack", "select", "shared"],
        ["stack", "output", "--json"],
      ],
    );
    assert.ok(
      calls.every(({ options }) =>
        options.cwd.replace(/[\\/]$/, "").endsWith("shared-registry"),
      ),
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("shared registry renderer rejects missing backend credentials before CLI calls", async () => {
  await assert.rejects(
    renderSharedRegistry({
      env: {},
      run: async () => {
        throw new Error("Pulumi must not run");
      },
    }),
    /backend is required/i,
  );
});

test("shared registry renderer rejects unsafe outputs without writing a manifest", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "savia-shared-render-"));
  try {
    await assert.rejects(
      renderSharedRegistry({
        outputRoot,
        env: backend,
        run: async (_command, args) => ({
          stdout:
            args[0] === "stack" && args[1] === "output"
              ? JSON.stringify({ ...outputs, bucketProtected: false })
              : "",
        }),
      }),
      /protected shared/i,
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
