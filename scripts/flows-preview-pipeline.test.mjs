import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { flowsWorkerConfig } from "../infra/pulumi/flows-worker-config.mjs";
test("preview preparation is disabled by default and has bounded compute settings", async () => {
  const yaml = await readFile(
    new URL("../infra/pulumi/Pulumi.preview.yaml", import.meta.url),
    "utf8",
  );
  assert.match(yaml, /savia-cloudflare:flowsEnabled: false/);
  assert.match(yaml, /savia-cloudflare:flowsExecutionEnabled: false/);
  const flow = flowsWorkerConfig(
    { buckets: {} },
    "https://savia-preview.hefesoft.com",
    "preview",
  );
  assert.equal(flow.vars.CLOUDFLARE_ENV, "preview");
  assert.equal(flow.vars.SAVIA_FLOWS_EXECUTION_ENABLED, "false");
  assert.equal(flow.vars.SAVIA_FLOWS_MAINTENANCE, "false");
  assert.equal(flow.limits.cpu_ms, 30000);
  assert.equal(flow.queues.consumers[0].max_concurrency, 1);
  assert.equal(flow.queues.consumers[0].max_retries, 100);
});
test("release stops on a failed backup and publishes the executor before Flows", async () => {
  const pipeline = await readFile(
    new URL("../.github/workflows/deploy-preview.yml", import.meta.url),
    "utf8",
  );
  const stages = [
    "Validate planned Flows",
    "Verify isolated preview resources",
    "Pause Savia writes",
    "Pause existing Flows",
    "Snapshot Flows Durable",
    "Back up all existing persistence",
    "Encrypt recovery archive",
    "Retain encrypted recovery archive",
    "Apply infrastructure before",
    "Apply Savia domain migrations",
    "Deploy private QuickJS hook executor",
    "Apply Flows D1 migrations",
    "Deploy private Savia Flows",
    "Deploy savia-agencies",
    "Verify Flows private bindings",
  ];
  let previous = -1;
  for (const stage of stages) {
    const position = pipeline.indexOf(stage);
    assert.ok(position > previous, stage);
    previous = position;
  }
  assert.doesNotMatch(pipeline, /continue-on-error:/);
  assert.match(
    pipeline,
    /name: Retain encrypted recovery archive[\s\S]*?path: \$\{\{ runner\.temp \}\}\/flows-release-backup\.enc/,
  );
  assert.match(
    pipeline,
    /name: Deploy private Savia Flows\n\s+if: env.SAVIA_FLOWS_PROVISIONED == 'true'/,
  );
  assert.match(
    pipeline,
    /name: Snapshot Flows Durable Object databases\n\s+if: env.SAVIA_FLOWS_PROVISIONED == 'true'/,
  );
});
