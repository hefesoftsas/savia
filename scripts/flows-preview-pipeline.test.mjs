import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { flowsWorkerConfig } from "../infra/pulumi/flows-worker-config.mjs";
test("preview activation is explicit and has bounded compute settings", async () => {
  const yaml = await readFile(
    new URL("../infra/pulumi/Pulumi.preview.yaml", import.meta.url),
    "utf8",
  );
  assert.match(yaml, /savia-cloudflare:flowsEnabled: true/);
  assert.match(yaml, /savia-cloudflare:flowsExecutionEnabled: true/);
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
  assert.equal(flow.queues.consumers[0].max_retries, 5);
});
test("release stops on a failed backup and publishes the executor before Flows", async () => {
  const pipeline = await readFile(
    new URL("../.github/workflows/deploy-preview.yml", import.meta.url),
    "utf8",
  );
  const stages = [
    "Validate planned Flows",
    "Verify isolated preview resources",
    "Capture preview Worker recovery state",
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

test("failed or cancelled preview releases restore only workers whose pause was attempted", async () => {
  const pipeline = await readFile(
    new URL("../.github/workflows/deploy-preview.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    pipeline,
    /name: Capture preview Worker recovery state\n\s+id: capture_recovery\n\s+if: env\.SAVIA_FLOWS_PROVISIONED == 'true'/,
  );
  assert.match(
    pipeline,
    /--action capture --environment preview[\s\S]*?--apply(?:\s|$)/,
  );
  assert.match(
    pipeline,
    /id: pause_agencies[\s\S]*?command: deploy --config wrangler\.preview\.jsonc --var SAVIA_MAINTENANCE:true/,
  );
  assert.match(
    pipeline,
    /id: pause_flows[\s\S]*?command: deploy --config wrangler\.preview\.jsonc --var SAVIA_FLOWS_EXECUTION_ENABLED:false/,
  );
  assert.match(
    pipeline,
    /name: Restore preview Workers after an unsuccessful release\n\s+id: restore_recovery\n\s+if: \$\{\{ always\(\) &&[\s\S]*?failure\(\) \|\| cancelled\(\)/,
  );
  assert.match(
    pipeline,
    /SAVIA_AGENCIES_PAUSE_ATTEMPTED: \$\{\{ steps\.pause_agencies\.outcome == 'success' \|\| steps\.pause_agencies\.outcome == 'failure' \|\| steps\.pause_agencies\.outcome == 'cancelled' \}\}/,
  );
  assert.match(
    pipeline,
    /SAVIA_FLOWS_PAUSE_ATTEMPTED: \$\{\{ steps\.pause_flows\.outcome == 'success' \|\| steps\.pause_flows\.outcome == 'failure' \|\| steps\.pause_flows\.outcome == 'cancelled' \}\}/,
  );
  assert.match(
    pipeline,
    /--action restore --environment preview[\s\S]*?--apply(?:\s|$)/,
  );
  assert.doesNotMatch(
    pipeline,
    /name: Restore preview Workers after an unsuccessful release[\s\S]*?continue-on-error:/,
  );
});
