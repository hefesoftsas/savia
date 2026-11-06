import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as renderer from "./render-from-outputs.mjs";
const { parseRenderArgs } = renderer;
import { resolveInfraNames } from "./naming.mjs";

const backend = {
  CLOUDFLARE_ACCOUNT_ID: "08a0d36f8b0357684f83e4bfeb6628b6",
  PULUMI_BACKEND_URL:
    "s3://savia-pulumi-state-preview?endpoint=example.r2.cloudflarestorage.com&region=auto",
  PULUMI_CONFIG_PASSPHRASE: "test-passphrase",
  AWS_ACCESS_KEY_ID: "test-access",
  AWS_SECRET_ACCESS_KEY: "test-secret",
};
const names = resolveInfraNames({
  environment: "preview",
  documentsBucket: "savia-documents-preview",
  publicOrigin: "https://savia-preview.hefesoft.com",
});
const outputs = {
  cloudflareAccountId: backend.CLOUDFLARE_ACCOUNT_ID,
  authD1Id: "auth-id",
  domainD1Id: "domain-id",
  documentsBucketName: names.bucket,
  resolvedPublicOrigin: names.publicOrigin,
  resolvedEnvironment: names.environment,
  workerNames: names.workers,
  databaseNames: names.databases,
  plannedFlowsResourceNames: names.flows,
  flowsEnabled: false,
  flowsResources: null,
};

describe("pulumi render-from-outputs", () => {
  it("accepts preview and production stacks", () => {
    assert.equal(parseRenderArgs(["--stack", "preview"]).stack, "preview");
    assert.equal(
      parseRenderArgs(["--stack", "production"]).stack,
      "production",
    );
  });

  it("rejects missing and unknown stacks", () => {
    assert.throws(() => parseRenderArgs([]));
    assert.throws(() => parseRenderArgs(["--stack", "qa"]));
  });

  it("explicitly selects the configured backend before reading an existing stack", async () => {
    assert.equal(typeof renderer.readDeploymentOutputs, "function");
    const calls = [];
    const result = await renderer.readDeploymentOutputs("preview", {
      env: backend,
      run: async (command, args) => {
        calls.push([command, ...args]);
        return {
          stdout:
            args[0] === "stack" && args[1] === "output"
              ? JSON.stringify(outputs)
              : "",
        };
      },
    });
    assert.equal(result.authD1Id, "auth-id");
    assert.deepEqual(
      calls.map((call) => call.slice(0, 3)),
      [
        ["pulumi", "login", backend.PULUMI_BACKEND_URL],
        ["pulumi", "stack", "select"],
        ["pulumi", "stack", "output"],
      ],
    );
  });

  it("refuses missing backend credentials before invoking the CLI", async () => {
    assert.equal(typeof renderer.readDeploymentOutputs, "function");
    await assert.rejects(
      renderer.readDeploymentOutputs("preview", {
        env: {},
        run: async () => {
          throw new Error("CLI must not run");
        },
      }),
      /backend is required/,
    );
  });

  it("rejects outputs from a different environment before rendering", async () => {
    assert.equal(typeof renderer.readDeploymentOutputs, "function");
    await assert.rejects(
      renderer.readDeploymentOutputs("production", {
        env: backend,
        run: async (_command, args) => ({
          stdout: args[1] === "output" ? JSON.stringify(outputs) : "",
        }),
      }),
      /environment disagree/,
    );
  });
});
