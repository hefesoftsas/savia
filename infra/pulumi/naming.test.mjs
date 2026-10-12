import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PREVIEW_PUBLIC_ORIGIN,
  resolveInfraNames,
  exportsForRender,
  stackProtection,
  assertAccountId,
  assertSafeR2Key,
  workerName,
  databaseName,
  validateFlowsResources,
  stateBackendName,
  stateBackendUrl,
} from "./naming.mjs";

describe("pulumi naming", () => {
  it("suffixes preview workers and databases", () => {
    const names = resolveInfraNames({
      environment: "preview",
      documentsBucket: "savia-documents-preview",
      publicOrigin: PREVIEW_PUBLIC_ORIGIN,
    });
    assert.equal(names.workers.api, "savia-agencies-preview");
    assert.equal(names.workers.auth, "savia-auth-preview");
    assert.equal(names.workers.gateway, "savia-preview");
    assert.equal(names.databases.auth, "savia-auth-preview");
    assert.equal(names.databases.domain, "savia-agencies-preview");
    assert.deepEqual(names.flows, {
      worker: "savia-flows-preview",
      database: "savia-flows-preview",
      kvNamespace: "savia-flows-preview",
      buckets: {
        resources: "savia-flows-resources-preview",
        datasets: "savia-flows-datasets-preview",
        inboxes: "savia-flows-inboxes-preview",
      },
      queue: "savia-flows-execute-preview",
      workflow: "savia-flows-execute-preview",
    });
  });

  it("keeps production names stable", () => {
    const names = resolveInfraNames({
      environment: "production",
      documentsBucket: "savia-documents",
      publicOrigin: "https://savia.app.hefesoft.com",
    });
    assert.equal(names.workers.api, "savia-agencies");
    assert.equal(names.databases.domain, "savia-agencies");
    assert.deepEqual(names.flows, {
      worker: "savia-flows",
      database: "savia-flows",
      kvNamespace: "savia-flows",
      buckets: {
        resources: "savia-flows-resources",
        datasets: "savia-flows-datasets",
        inboxes: "savia-flows-inboxes",
      },
      queue: "savia-flows-execute",
      workflow: "savia-flows-execute",
    });
  });

  it("rejects preview sharing the production bucket or origin", () => {
    assert.throws(() =>
      resolveInfraNames({
        environment: "preview",
        documentsBucket: "savia-documents",
        publicOrigin: PREVIEW_PUBLIC_ORIGIN,
      }),
    );
    assert.throws(() =>
      resolveInfraNames({
        environment: "preview",
        documentsBucket: "savia-documents-preview",
        publicOrigin: "https://savia.app.hefesoft.com",
      }),
    );
  });

  it("rejects preview search-index reuse and production use of preview index", () => {
    assert.throws(() =>
      resolveInfraNames({
        environment: "preview",
        documentsBucket: "savia-documents-preview",
        publicOrigin: PREVIEW_PUBLIC_ORIGIN,
        pagesSearchIndex: "savia-pages-search-prod",
      }),
    );
    assert.throws(() =>
      resolveInfraNames({
        environment: "production",
        documentsBucket: "savia-documents",
        publicOrigin: "https://savia.app.hefesoft.com",
        pagesSearchIndex: "savia-pages-search-preview",
      }),
    );
  });

  it("rejects unknown environments and empty buckets", () => {
    assert.throws(() => workerName("savia-auth", "qa"));
    assert.throws(() => databaseName("savia-auth", "qa"));
    assert.throws(() =>
      resolveInfraNames({
        environment: "production",
        documentsBucket: "  ",
        publicOrigin: "https://savia.app.hefesoft.com",
      }),
    );
  });

  it("maps stack outputs to render-script env vars", () => {
    const names = resolveInfraNames({
      environment: "production",
      documentsBucket: "savia-documents",
      publicOrigin: "https://savia.app.hefesoft.com",
    });
    const env = exportsForRender({
      authD1Id: "auth-uuid",
      domainD1Id: "domain-uuid",
      names,
    });
    assert.equal(env.SAVIA_AUTH_D1_ID, "auth-uuid");
    assert.equal(env.SAVIA_DOMAIN_D1_ID, "domain-uuid");
    assert.equal(env.SAVIA_DOCUMENTS_BUCKET, "savia-documents");
  });
  it("protects production stacks and keeps preview cheap to destroy", () => {
    const prod = stackProtection("production");
    assert.equal(prod.protect, true);
    assert.equal(prod.destroyRequires, "--i-understand-destroy-production");
    const preview = stackProtection("preview");
    assert.equal(preview.protect, false);
    assert.equal(preview.destroyRequires, "--apply");
    assert.throws(() => stackProtection("qa"));
  });

  it("validates account IDs before URL interpolation", () => {
    assert.equal(
      assertAccountId("08a0d36f8b0357684f83e4bfeb6628b6"),
      "08a0d36f8b0357684f83e4bfeb6628b6",
    );
    assert.throws(() => assertAccountId("abc123"));
    assert.throws(() => assertAccountId(""));
    assert.throws(() => assertAccountId(null));
    assert.throws(() => assertAccountId("08A0D36F8B0357684F83E4BFE6628B6"));
  });

  it("rejects unsafe R2 keys", () => {
    assert.equal(assertSafeR2Key("a/b/c.txt"), "a/b/c.txt");
    assert.throws(() => assertSafeR2Key(""));
    assert.throws(() => assertSafeR2Key("/abs/path"));
    assert.throws(() => assertSafeR2Key("a/../../evil"));
    assert.throws(() => assertSafeR2Key("a\\b"));
  });

  it("validates optional Flows outputs against isolated stack names", () => {
    assert.equal(validateFlowsResources(undefined, "preview"), null);
    const resources = {
      databaseId: "db-id",
      kvNamespaceId: "kv-id",
      workerName: "savia-flows-preview",
      workflowName: "savia-flows-execute-preview",
      queueName: "savia-flows-execute-preview",
      buckets: {
        resources: "savia-flows-resources-preview",
        datasets: "savia-flows-datasets-preview",
        inboxes: "savia-flows-inboxes-preview",
      },
    };
    assert.deepEqual(validateFlowsResources(resources, "preview"), resources);
    assert.throws(() =>
      validateFlowsResources({ ...resources, databaseId: " " }, "preview"),
    );
    assert.throws(() =>
      validateFlowsResources(
        { ...resources, workerName: "savia-flows" },
        "preview",
      ),
    );
    assert.throws(() => validateFlowsResources(resources, "staging"));
  });

  it("validates an optional environment-specific state bucket name", () => {
    assert.equal(stateBackendName("preview", undefined), undefined);
    assert.equal(stateBackendName("production", undefined), undefined);
    assert.equal(
      stateBackendName("preview", "savia-pulumi-state-preview"),
      "savia-pulumi-state-preview",
    );
    assert.equal(
      stateBackendName("production", "savia-pulumi-state"),
      "savia-pulumi-state",
    );
    assert.throws(() => stateBackendName("preview", "savia-pulumi-state"));
    assert.throws(() =>
      stateBackendName("production", "savia-pulumi-state-preview"),
    );
    assert.throws(() => stateBackendName("preview", "savia-documents-preview"));
    assert.throws(() => stateBackendName("production", "savia-documents"));
    assert.throws(() => stateBackendName("staging", undefined));
  });

  it("builds an authenticated-free R2 state URL after validating the account ID", () => {
    assert.equal(
      stateBackendUrl(
        "08a0d36f8b0357684f83e4bfeb6628b6",
        "savia-pulumi-state-preview",
      ),
      "s3://savia-pulumi-state-preview?endpoint=08a0d36f8b0357684f83e4bfeb6628b6.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true",
    );
    assert.throws(() =>
      stateBackendUrl("bad-id", "savia-pulumi-state-preview"),
    );
    assert.throws(() =>
      stateBackendUrl("08A0D36F8B0357684F83E4BFEF6628B6", "bucket"),
    );
  });
});
