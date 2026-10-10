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
  });

  it("keeps production names stable", () => {
    const names = resolveInfraNames({
      environment: "production",
      documentsBucket: "savia-documents",
      publicOrigin: "https://savia.app.hefesoft.com",
    });
    assert.equal(names.workers.api, "savia-agencies");
    assert.equal(names.databases.domain, "savia-agencies");
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
    assert.throws(() =>
      assertAccountId("08A0D36F8B0357684F83E4BFE6628B6"),
    );
  });

  it("rejects unsafe R2 keys", () => {
    assert.equal(assertSafeR2Key("a/b/c.txt"), "a/b/c.txt");
    assert.throws(() => assertSafeR2Key(""));
    assert.throws(() => assertSafeR2Key("/abs/path"));
    assert.throws(() => assertSafeR2Key("a/../../evil"));
    assert.throws(() => assertSafeR2Key("a\\b"));
  });
});
