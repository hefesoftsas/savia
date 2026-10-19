import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { previewNames } from "../../scripts/preview-environment.mjs";
import { prepareRuntimeArtifact } from "./runtime-publisher.mjs";
import { createBranchPublisher } from "./runtime-publisher-prepared-branch.mjs";

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "savia-prepared-branch-"));
  try {
    const names = previewNames("test");
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "worker.mjs"), "export default {};");
    await mkdir(join(source, "migrations"));
    await writeFile(join(source, "migrations", "0000.sql"), "SELECT 1;");
    const configs = Object.fromEntries(
      ["auth", "request", "mcp", "api", "gateway"].map((role) => [
        `${role}.json`,
        {
          name: names.workers[role],
          main: "worker.mjs",
          ...(role === "api"
            ? {
                d1_databases: [
                  {
                    binding: "DB",
                    database_id:
                      "d".repeat(8) +
                      "-" +
                      "d".repeat(4) +
                      "-" +
                      "d".repeat(4) +
                      "-" +
                      "d".repeat(4) +
                      "-" +
                      "d".repeat(12),
                  },
                ],
              }
            : {}),
        },
      ]),
    );
    const artifact = await prepareRuntimeArtifact({
      environment: "branch-test",
      release: { directory: source, configs },
      destination: join(root, "artifact"),
    });
    const inputs = {
      ...artifact,
      accountId: "a".repeat(32),
      workers: Object.values(configs).map((c) => ({
        name: c.name,
        cloudId: "b".repeat(32),
      })),
    };
    await fn(inputs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const keys = {
  auth: ["BETTER_AUTH_SECRET", "SAVIA_INTERNAL_BRIDGE_KEY"],
  request: ["ENCRYPTION_KEY"],
  mcp: ["SAVIA_MCP_SHARED_SECRET"],
  api: [
    "ASSISTANT_SETTINGS_ENCRYPTION_KEY",
    "EXTENSION_CONNECTIONS_ENCRYPTION_KEY",
    "STUDIO_INTEGRATION_KEY",
    "SAVIA_MCP_SHARED_SECRET",
    "SAVIA_INTERNAL_BRIDGE_KEY",
  ],
  gateway: [],
};
test("prepared branch publication preserves complete existing opaque secrets", () =>
  fixture(async (inputs) => {
    const calls = [];
    const publisher = await createBranchPublisher(inputs, {
      env: { CLOUDFLARE_ACCOUNT_ID: inputs.accountId },
      client: {
        api: async (path) => ({
          bindings: (
            keys[
              Object.keys(keys).find((role) =>
                path.includes(previewNames("test").workers[role]),
              )
            ] ?? []
          ).map((name) => ({ type: "secret_text", name })),
        }),
      },
      run: async (...args) => calls.push(args),
      runWrangler: async (...args) => calls.push(args),
    });
    await publisher.publish();
    assert.equal(
      calls.some(([args]) => Array.isArray(args) && args[0] === "secret"),
      false,
    );
    assert.ok(
      calls.some(
        ([executable, args, opts]) =>
          executable === "node" &&
          args.includes("--migrations-dir") &&
          opts.env.CLOUDFLARE_DATABASE_ID,
      ),
    );
    assert.equal(
      calls.filter(([args]) => Array.isArray(args) && args[0] === "deploy")
        .length,
      5,
    );
  }));
test("partial branch secret custody fails before migration or publication", () =>
  fixture(async (inputs) => {
    let calls = 0;
    await assert.rejects(
      createBranchPublisher(inputs, {
        env: { CLOUDFLARE_ACCOUNT_ID: inputs.accountId },
        client: {
          api: async () => ({
            bindings: [{ type: "secret_text", name: "BETTER_AUTH_SECRET" }],
          }),
        },
        run: async () => calls++,
        runWrangler: async () => calls++,
      }),
      /partial|custody/i,
    );
    assert.equal(calls, 0);
  }));
