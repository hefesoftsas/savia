import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as stackOutputs from "./outputs.mjs";
import { resolveInfraNames } from "./naming.mjs";
const { parseStackOutputs, renderEnvFromOutputs } = stackOutputs;

const OUTPUTS = {
  cloudflareAccountId: "08a0d36f8b0357684f83e4bfeb6628b6",
  authD1Id: "auth-uuid",
  domainD1Id: "domain-uuid",
  documentsBucketName: "savia-documents-preview",
  resolvedEnvironment: "preview",
  resolvedPublicOrigin: "https://savia-preview.hefesoft.com",
  workerNames: {
    auth: "savia-auth-preview",
    api: "savia-agencies-preview",
    request: "savia-request-preview",
    hookExecutor: "savia-hook-executor-preview",
    connectors: "savia-connectors-preview",
    mcp: "savia-mcp-preview",
    gateway: "savia-preview",
  },
  databaseNames: {
    auth: "savia-auth-preview",
    domain: "savia-agencies-preview",
  },
  deletionProtected: false,
  flowsEnabled: false,
  flowsResources: null,
  plannedFlowsResourceNames: {
    worker: "savia-flows-preview",
    database: "savia-flows-preview",
    kvNamespace: "savia-flows-preview",
    buckets: {
      resources: "savia-flows-resources-preview",
      datasets: "savia-flows-datasets-preview",
      inboxes: "savia-flows-inboxes-preview",
    },
    queue: "savia-flows-execute-preview",
    deadLetterQueue: "savia-flows-execute-dlq-preview",
    workflow: "savia-flows-execute-preview",
  },
};

describe("pulumi stack outputs", () => {
  it("requires the Pulumi account to match the Worker publisher before deployment", () => {
    assert.equal(typeof stackOutputs.assertDeploymentAccount, "function");
    stackOutputs.assertDeploymentAccount(OUTPUTS, OUTPUTS.cloudflareAccountId);
    assert.throws(
      () =>
        stackOutputs.assertDeploymentAccount(
          OUTPUTS,
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ),
      /account.*match/i,
    );
    assert.throws(
      () => stackOutputs.assertDeploymentAccount(OUTPUTS, undefined),
      /accountId/,
    );
    assert.throws(
      () =>
        parseStackOutputs(
          JSON.stringify({ ...OUTPUTS, cloudflareAccountId: undefined }),
        ),
      /cloudflareAccountId/,
    );
  });
  it("accepts the absent planned DLQ name from a legacy disabled stack", () => {
    const names = { ...OUTPUTS.plannedFlowsResourceNames };
    delete names.deadLetterQueue;
    const parsed = parseStackOutputs(
      JSON.stringify({
        ...OUTPUTS,
        plannedFlowsResourceNames: names,
      }),
    );
    assert.equal(
      parsed.plannedFlowsResourceNames.deadLetterQueue,
      "savia-flows-execute-dlq-preview",
    );
    assert.throws(
      () =>
        parseStackOutputs(
          JSON.stringify({
            ...OUTPUTS,
            plannedFlowsResourceNames: { ...names, deadLetterQueue: "wrong" },
          }),
        ),
      /deadLetterQueue/,
    );
  });

  it("parses and validates required outputs", () => {
    const parsed = parseStackOutputs(JSON.stringify(OUTPUTS));
    assert.equal(parsed.documentsBucketName, "savia-documents-preview");
    assert.equal(parsed.backupBucketName, null);
    assert.equal(parsed.backupRetentionDays, null);
    assert.deepEqual(parsed.tenantSubdomains, []);
    assert.equal(
      renderEnvFromOutputs(parsed, "/repo").SAVIA_TENANT_SUBDOMAINS,
      "[]",
    );
  });

  it("validates and exports explicit production tenant subdomains", () => {
    const productionNames = resolveInfraNames({
      environment: "production",
      documentsBucket: "savia-documents",
      publicOrigin: "https://savia.app.hefesoft.com",
    });
    const production = {
      ...OUTPUTS,
      documentsBucketName: productionNames.bucket,
      resolvedEnvironment: "production",
      resolvedPublicOrigin: productionNames.publicOrigin,
      workerNames: productionNames.workers,
      databaseNames: productionNames.databases,
      plannedFlowsResourceNames: productionNames.flows,
      tenantSubdomains: ["tenant-home", "acme-team"],
    };
    const parsed = parseStackOutputs(JSON.stringify(production));
    assert.deepEqual(parsed.tenantSubdomains, ["tenant-home", "acme-team"]);
    assert.equal(
      renderEnvFromOutputs(parsed, "/repo").SAVIA_TENANT_SUBDOMAINS,
      '["tenant-home","acme-team"]',
    );
    for (const tenantSubdomains of [
      ["api"],
      ["*.savia.app.hefesoft.com"],
      ["tenant-home", "tenant-home"],
      "tenant-home",
    ]) {
      assert.throws(() =>
        parseStackOutputs(JSON.stringify({ ...production, tenantSubdomains })),
      );
    }
    assert.throws(
      () =>
        parseStackOutputs(
          JSON.stringify({ ...OUTPUTS, tenantSubdomains: ["tenant-home"] }),
        ),
      /preview.*tenant subdomain/i,
    );
  });

  it("accepts legacy outputs without a backup bucket and renders disabled vars", () => {
    const legacy = { ...OUTPUTS };
    delete legacy.backupBucketName;
    delete legacy.backupRetentionDays;
    const parsed = parseStackOutputs(JSON.stringify(legacy));
    const env = renderEnvFromOutputs(parsed, "/repo");
    assert.equal(parsed.backupBucketName, null);
    assert.equal(parsed.backupRetentionDays, null);
    assert.equal(env.SAVIA_BACKUP_BUCKET, "");
    assert.equal(env.SAVIA_BACKUP_RETENTION_DAYS, "");
  });

  it("validates and renders the opt-in production backup bucket and retention", () => {
    const names = resolveInfraNames({
      environment: "production",
      documentsBucket: "savia-documents",
      publicOrigin: "https://savia.app.hefesoft.com",
    });
    const production = {
      ...OUTPUTS,
      documentsBucketName: names.bucket,
      resolvedEnvironment: "production",
      resolvedPublicOrigin: names.publicOrigin,
      workerNames: names.workers,
      databaseNames: names.databases,
      plannedFlowsResourceNames: names.flows,
      backupBucketName: "savia-production-backups",
      backupRetentionDays: 30,
    };
    const parsed = parseStackOutputs(JSON.stringify(production));
    const env = renderEnvFromOutputs(parsed, "/repo");
    assert.equal(parsed.backupBucketName, "savia-production-backups");
    assert.equal(parsed.backupRetentionDays, 30);
    assert.equal(env.SAVIA_BACKUP_BUCKET, "savia-production-backups");
    assert.equal(env.SAVIA_BACKUP_RETENTION_DAYS, "30");

    for (const invalid of [
      { ...production, backupBucketName: "savia-documents" },
      { ...production, backupBucketName: "savia-production-backups-preview" },
      { ...production, backupRetentionDays: 29 },
      { ...production, backupRetentionDays: null },
      { ...production, backupBucketName: null },
    ]) {
      assert.throws(() => parseStackOutputs(JSON.stringify(invalid)));
    }
    assert.throws(() =>
      parseStackOutputs(
        JSON.stringify({
          ...OUTPUTS,
          backupBucketName: "savia-production-backups",
          backupRetentionDays: 30,
        }),
      ),
    );
  });

  it("accepts validated adopted production D1 names and exports them to rendering", () => {
    const adoptedNames = resolveInfraNames({
      environment: "production",
      documentsBucket: "savia-documents",
      publicOrigin: "https://savia.app.hefesoft.com",
      authDatabaseName: "savia-auth-local-canonical-20260913-v2",
      domainDatabaseName: "savia-agencies-local-canonical-20260913-v2",
    });
    const production = {
      ...OUTPUTS,
      documentsBucketName: adoptedNames.bucket,
      resolvedEnvironment: "production",
      resolvedPublicOrigin: adoptedNames.publicOrigin,
      workerNames: adoptedNames.workers,
      databaseNames: adoptedNames.databases,
      plannedFlowsResourceNames: adoptedNames.flows,
    };
    const parsed = parseStackOutputs(JSON.stringify(production));
    const env = renderEnvFromOutputs(parsed, "/repo");
    assert.equal(
      env.SAVIA_AUTH_D1_NAME,
      "savia-auth-local-canonical-20260913-v2",
    );
    assert.equal(
      env.SAVIA_DOMAIN_D1_NAME,
      "savia-agencies-local-canonical-20260913-v2",
    );
    assert.throws(
      () =>
        parseStackOutputs(
          JSON.stringify({
            ...production,
            databaseNames: {
              auth: "savia-auth-preview",
              domain: "savia-agencies-local-canonical-20260913-v2",
            },
          }),
        ),
      /preview database/i,
    );
  });

  it("rejects invalid JSON and missing keys", () => {
    assert.throws(() => parseStackOutputs("not-json"));
    assert.throws(() => parseStackOutputs(JSON.stringify({})));
    assert.throws(() =>
      parseStackOutputs(JSON.stringify({ ...OUTPUTS, authD1Id: "  " })),
    );
    assert.throws(() =>
      parseStackOutputs(
        JSON.stringify({ ...OUTPUTS, databaseNames: { auth: "x" } }),
      ),
    );
  });

  it("rejects an environment that is not a supported stack", () => {
    assert.throws(() =>
      parseStackOutputs(
        JSON.stringify({ ...OUTPUTS, resolvedEnvironment: "staging" }),
      ),
    );
  });

  it("rejects resource names that do not match the resolved environment", () => {
    assert.throws(() =>
      parseStackOutputs(
        JSON.stringify({
          ...OUTPUTS,
          workerNames: { api: "savia-agencies" },
        }),
      ),
    );
    assert.throws(() =>
      parseStackOutputs(
        JSON.stringify({
          ...OUTPUTS,
          plannedFlowsResourceNames: {
            ...OUTPUTS.plannedFlowsResourceNames,
            worker: "savia-flows",
          },
        }),
      ),
    );
  });

  it("requires complete IDs and names when Flows resources are enabled", () => {
    const enabled = {
      ...OUTPUTS,
      flowsEnabled: true,
      flowsResources: {
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
      },
    };
    assert.equal(parseStackOutputs(JSON.stringify(enabled)).flowsEnabled, true);
    for (const flowsResources of [
      null,
      { ...enabled.flowsResources, databaseId: " " },
      { ...enabled.flowsResources, kvNamespaceId: undefined },
      { ...enabled.flowsResources, workerName: "savia-flows" },
    ]) {
      assert.throws(() =>
        parseStackOutputs(JSON.stringify({ ...enabled, flowsResources })),
      );
    }
  });

  it("emits Flows resources as JSON only when enabled", () => {
    assert.equal(
      renderEnvFromOutputs(OUTPUTS, "/repo").SAVIA_FLOWS_RESOURCES,
      "",
    );
    const flowsResources = {
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
    assert.equal(
      renderEnvFromOutputs(
        { ...OUTPUTS, flowsEnabled: true, flowsResources },
        "/repo",
      ).SAVIA_FLOWS_RESOURCES,
      JSON.stringify(flowsResources),
    );
  });

  it("builds render env from stack outputs", () => {
    const env = renderEnvFromOutputs(OUTPUTS, "/repo");
    assert.equal(env.SAVIA_AUTH_D1_ID, "auth-uuid");
    assert.equal(env.SAVIA_DOMAIN_D1_ID, "domain-uuid");
    assert.equal(env.SAVIA_DOCUMENTS_BUCKET, "savia-documents-preview");
    assert.equal(env.SAVIA_PUBLIC_ORIGIN, "https://savia-preview.hefesoft.com");
    assert.equal(env.SAVIA_DEPLOY_ENVIRONMENT, "preview");
    assert.equal(env.SAVIA_DEPLOY_CONFIG_ROOT, "/repo");
  });

  it("forwards the vectorize index only when configured", () => {
    assert.equal(
      renderEnvFromOutputs(
        { ...OUTPUTS, vectorizeIndex: "savia-pages-search-preview" },
        "/repo",
      ).SAVIA_PAGES_SEARCH_INDEX,
      "savia-pages-search-preview",
    );
    for (const vectorizeIndex of [undefined, null, "  "]) {
      assert.equal(
        renderEnvFromOutputs({ ...OUTPUTS, vectorizeIndex }, "/repo")
          .SAVIA_PAGES_SEARCH_INDEX,
        "",
      );
    }
  });
});
