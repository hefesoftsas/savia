import assert from "node:assert/strict";
import { mkdtemp, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { flowsWorkerConfig } from "./flows-worker-config.mjs";
import { renderProductionConfigs } from "./worker-config.mjs";

const preview = {
  deploymentEnvironment: "preview",
  authD1Id: "auth-id",
  domainD1Id: "domain-id",
  publicOrigin: "https://savia-preview.hefesoft.com",
  documentsBucket: "savia-documents-preview",
};
const production = {
  deploymentEnvironment: "production",
  authD1Id: "auth-id",
  domainD1Id: "domain-id",
  publicOrigin: "https://savia.app.hefesoft.com",
  documentsBucket: "savia-documents",
};
const flows = {
  databaseId: "flows-db-id",
  kvNamespaceId: "flows-kv-id",
  workerName: "savia-flows-preview",
  workflowName: "savia-flows-execute-preview",
  queueName: "savia-flows-execute-preview",
  deadLetterQueueName: "savia-flows-execute-dlq-preview",
  buckets: {
    resources: "savia-flows-resources-preview",
    datasets: "savia-flows-datasets-preview",
    inboxes: "savia-flows-inboxes-preview",
  },
};
const productionFlows = {
  databaseId: "flows-db-id",
  kvNamespaceId: "flows-kv-id",
  workerName: "savia-flows",
  workflowName: "savia-flows-execute",
  queueName: "savia-flows-execute",
  deadLetterQueueName: "savia-flows-execute-dlq",
  buckets: {
    resources: "savia-flows-resources",
    datasets: "savia-flows-datasets",
    inboxes: "savia-flows-inboxes",
  },
};
const readConfig = async (root, app) =>
  JSON.parse(
    await readFile(join(root, "apps", app, "wrangler.preview.jsonc"), "utf8"),
  );

test("preview generates the isolated plugin editor manifest from the infrastructure project", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-editor-"));
  try {
    await renderProductionConfigs({ ...preview, outputRoot: root });
    const editor = await readConfig(root, "plugin-editor-runtime");
    assert.equal(editor.name, "savia-plugin-editor-preview");
    assert.equal(editor.assets.directory, "../admin/dist-plugin-editor");
    assert.equal(editor.workers_dev, true);
    assert.equal("r2_buckets" in editor, false);
    assert.equal("d1_databases" in editor, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disabled Flows neither adds a binding nor leaves a generated cloud manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-workers-"));
  try {
    await renderProductionConfigs({ ...preview, outputRoot: root });
    const api = await readConfig(root, "api");
    assert.equal(api.vars.CLOUDFLARE_ENV, "preview");
    assert.equal(api.vars.SAVIA_FLOWS_EXECUTION_ENABLED, "false");
    assert.equal(api.vars.SAVIA_FLOWS_QUOTAS_ENABLED, "false");
    assert.equal(
      api.services.some((b) => b.binding === "SAVIA_FLOWS"),
      false,
    );
    await assert.rejects(
      access(join(root, "apps/flows/api/wrangler.preview.jsonc")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Flows manifest uses stack resource IDs and isolated reciprocal bindings", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-workers-"));
  try {
    await renderProductionConfigs({
      ...preview,
      flowsResources: flows,
      outputRoot: root,
    });
    const flow = await readConfig(root, "flows/api");
    const api = await readConfig(root, "api");
    assert.equal(flow.name, flows.workerName);
    assert.equal(flow.d1_databases[0].database_id, flows.databaseId);
    assert.equal(flow.kv_namespaces[0].id, flows.kvNamespaceId);
    assert.deepEqual(flow.services, [
      { binding: "SAVIA_HOST", service: "savia-agencies-preview" },
      {
        binding: "CODE_EXECUTOR",
        service: "savia-hook-executor-preview",
        entrypoint: "FlowsExecutor",
      },
    ]);
    assert.ok(
      api.services.some(
        (b) => b.binding === "SAVIA_FLOWS" && b.service === flows.workerName,
      ),
    );
    assert.equal(flow.workflows[0].name, flows.workflowName);
    assert.equal(flow.queues.producers[0].queue, flows.queueName);
    assert.equal(flow.queues.consumers[0].queue, flows.queueName);
    assert.equal(
      flow.queues.consumers[0].dead_letter_queue,
      flows.deadLetterQueueName,
    );
    assert.equal(flow.queues.consumers[0].retry_delay, 60);
    assert.equal(flow.queues.consumers[0].max_retries, 5);
    assert.equal(flow.migrations[0].new_sqlite_classes.length, 5);
    assert.deepEqual(flow.triggers.crons, ["* * * * *"]);
    assert.equal("worker_loaders" in flow, false);
    assert.equal(flow.vars.WEBSITE_URL, preview.publicOrigin);
    assert.equal(flow.vars.SAVIA_FLOWS_LOCAL_ONLY, "true");
    assert.equal(api.vars.CLOUDFLARE_ENV, "preview");
    assert.equal(api.vars.SAVIA_FLOWS_EXECUTION_ENABLED, "false");
    assert.equal(api.vars.SAVIA_FLOWS_QUOTAS_ENABLED, "true");
    for (const [name, value] of Object.entries(flow.vars)) {
      if (name.startsWith("SAVIA_FLOWS_MAX_"))
        assert.equal(api.vars[name], value, name);
    }
    for (const key of [
      "ai",
      "browser",
      "containers",
      "send_email",
      "analytics_engine_datasets",
    ])
      assert.equal(key in flow, false);
    assert.equal(flow.workers_dev, false);
    assert.equal(flow.preview_urls, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production Flows uses the named private QuickJS executor service binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-workers-"));
  try {
    await renderProductionConfigs({
      ...production,
      flowsResources: productionFlows,
      outputRoot: root,
    });
    const flow = JSON.parse(
      await readFile(
        join(root, "apps/flows/api/wrangler.production.jsonc"),
        "utf8",
      ),
    );
    assert.ok(
      flow.services.some(
        (service) =>
          service.binding === "CODE_EXECUTOR" &&
          service.service === "savia-hook-executor" &&
          service.entrypoint === "FlowsExecutor",
      ),
    );
    assert.equal("worker_loaders" in flow, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview rejects production Flows resources before generating manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-workers-"));
  try {
    await assert.rejects(
      renderProductionConfigs({
        ...preview,
        outputRoot: root,
        flowsResources: { ...flows, workerName: "savia-flows" },
      }),
      /Flows|flows|isolat/,
    );
    await assert.rejects(access(join(root, "apps/api/wrangler.preview.jsonc")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disabling Flows removes an earlier generated manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "savia-iac-workers-"));
  try {
    await renderProductionConfigs({
      ...preview,
      flowsResources: flows,
      outputRoot: root,
    });
    await renderProductionConfigs({ ...preview, outputRoot: root });
    await assert.rejects(
      access(join(root, "apps/flows/api/wrangler.preview.jsonc")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("execution cannot be enabled from legacy outputs without a dead-letter queue", () => {
  const { deadLetterQueueName, ...legacy } = flows;
  assert.throws(
    () => flowsWorkerConfig(legacy, preview.publicOrigin, "preview", true),
    /dead-letter queue/,
  );
  assert.doesNotThrow(() =>
    flowsWorkerConfig(legacy, preview.publicOrigin, "preview", false),
  );
});
