import assert from "node:assert/strict";
import test from "node:test";
import { verifyFlows, verifyFlowsPreview } from "./verify-flows-preview.mjs";
import { flowsWorkerConfig } from "../infra/pulumi/flows-worker-config.mjs";
const env = {
  SAVIA_FLOWS_PROVISIONED: "true",
  SAVIA_FLOWS_EXECUTION_ENABLED: "false",
  CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
  CLOUDFLARE_API_TOKEN: "secret-token",
};
const config = flowsWorkerConfig(
  { workerName: "savia-flows-preview", buckets: {} },
  "https://savia-preview.hefesoft.com",
  "preview",
);
const settings = {
  bindings: [
    ...config.services.map((binding) => ({
      name: binding.binding,
      type: "service",
      service: binding.service,
      entrypoint: binding.entrypoint,
    })),
    ...Object.entries(config.vars).map(([name, text]) => ({
      name,
      text,
      type: "plain_text",
    })),
  ],
};
test("disabled Flows verification has no requests or credential requirements", async () => {
  assert.deepEqual(
    await verifyFlowsPreview({}, () => {
      throw new Error("network must not run");
    }),
    { skipped: true },
  );
});
test("verifies actual settings and the published named QuickJS entrypoint", async () => {
  const urls = [];
  const result = await verifyFlowsPreview(env, async (url) => {
    urls.push(url);
    return url.endsWith("/settings")
      ? Response.json({ success: true, result: settings })
      : new Response("export { FlowsExecutor }");
  });
  assert.equal(result.executionEnabled, false);
  assert.equal(urls.length, 2);
  await assert.rejects(
    verifyFlowsPreview(env, async (url) =>
      url.endsWith("/settings")
        ? Response.json({ success: true, result: settings })
        : new Response("old executor"),
    ),
    /missing FlowsExecutor/,
  );
});
test("does not expose API bodies or credentials on verification failure", async () => {
  await assert.rejects(
    verifyFlowsPreview(
      env,
      async () => new Response("secret-token", { status: 403 }),
    ),
    (error) =>
      error.message.includes("403") && !error.message.includes("secret-token"),
  );
});

test("verifies production Flows policy and production executor bindings", async () => {
  const productionEnv = { ...env, SAVIA_DEPLOY_ENVIRONMENT: "production" };
  const productionConfig = flowsWorkerConfig(
    { workerName: "savia-flows", buckets: {} },
    "https://savia.app.hefesoft.com",
    "production",
  );
  const productionSettings = {
    bindings: [
      ...productionConfig.services.map((binding) => ({
        name: binding.binding,
        type: "service",
        service: binding.service,
        entrypoint: binding.entrypoint,
      })),
      ...Object.entries(productionConfig.vars).map(([name, text]) => ({
        name,
        text,
        type: "plain_text",
      })),
    ],
  };
  const urls = [];
  await verifyFlows(productionEnv, async (url) => {
    urls.push(url);
    return url.endsWith("/settings")
      ? Response.json({ success: true, result: productionSettings })
      : new Response("export { FlowsExecutor }");
  });
  assert.ok(urls.some((url) => url.includes("/savia-flows/settings")));
  assert.ok(urls.some((url) => url.includes("/savia-hook-executor")));
});
