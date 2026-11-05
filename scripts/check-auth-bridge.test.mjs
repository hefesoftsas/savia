import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  checkAuthBridge,
  validateActiveRevisionMetadata,
} from "./check-auth-bridge.mjs";

const id = "00000000-0000-4000-8000-000000000001";
const version = (revision) => ({
  resources: {
    bindings: [
      {
        type: "plain_text",
        name: "SAVIA_AUTH_DEPLOYMENT_REVISION",
        text: revision,
      },
    ],
  },
});

test("accepts metadata for every serving Auth version only when revisions are valid and nonzero", () => {
  const deployments = {
    deployments: [
      {
        versions: [
          { version_id: id, percentage: 60 },
          {
            version_id: "00000000-0000-4000-8000-000000000002",
            percentage: 40,
          },
        ],
      },
    ],
  };
  assert.deepEqual(
    validateActiveRevisionMetadata(deployments, [
      version("a".repeat(40)),
      version("b".repeat(40)),
    ]),
    ["a".repeat(40), "b".repeat(40)],
  );
  assert.throws(
    () =>
      validateActiveRevisionMetadata(deployments, [
        version("a".repeat(40)),
        version("0".repeat(40)),
      ]),
    /sentinel/,
  );
});

test("checks the mocked Cloudflare deployment and sends one private sentinel request", async () => {
  const account = "a".repeat(32);
  const token = "cloudflare-test-token";
  const secret = "mcp-secret-test-value";
  const revision = "c".repeat(40);
  const calls = [];
  const reports = [];
  let configPath;
  const result = await checkAuthBridge({
    env: {
      CLOUDFLARE_ACCOUNT_ID: account,
      CLOUDFLARE_API_TOKEN: token,
      SAVIA_MCP_SHARED_SECRET: secret,
      AUTH_PROBE_WRANGLER_BIN: "/tmp/wrangler",
    },
    report: (value) => reports.push(value),
    start: (_binary, args, options) => {
      configPath = args[args.indexOf("--config") + 1];
      assert.equal(options.env.SAVIA_MCP_SHARED_SECRET, undefined);
      assert.equal(options.env.CLOUDFLARE_API_TOKEN, token);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      return child;
    },
    fetcher: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith("/deployments"))
        return Response.json({
          success: true,
          result: {
            deployments: [{ versions: [{ version_id: id, percentage: 100 }] }],
          },
        });
      if (url.endsWith(`/versions/${id}`))
        return Response.json({ success: true, result: version(revision) });
      if (url.endsWith("/ready")) {
        const config = JSON.parse(await readFile(configPath, "utf8"));
        return Response.json({ nonce: config.vars.PROBE_NONCE });
      }
      if (url.endsWith("/initialize")) {
        const source = await readFile(configPath, "utf8");
        const config = JSON.parse(source);
        assert.equal(
          options.headers["x-savia-probe-nonce"],
          config.vars.PROBE_NONCE,
        );
        assert.equal(
          options.headers["x-savia-bridge-key"],
          createHmac("sha256", secret)
            .update("savia:auth-tenant-user-administration:v1")
            .digest("hex"),
        );
        assert.equal(config.vars.AUTH_REVISION, "0".repeat(40));
        assert.doesNotMatch(source, /mcp-secret-test-value|x-savia-bridge-key/);
        return Response.json(
          { error: "REVISION_MISMATCH", upstreamStatus: 409 },
          { status: 502 },
        );
      }
      throw new Error("Unexpected fetch URL");
    },
  });
  assert.deepEqual(result, {
    category: "REVISION_MISMATCH",
    upstreamStatus: 409,
  });
  assert.equal(
    calls.filter(({ url }) => url.endsWith("/initialize")).length,
    1,
  );
  assert.deepEqual(reports, ["REVISION_MISMATCH upstream HTTP 409"]);
  await assert.rejects(access(configPath), /ENOENT/);
});
