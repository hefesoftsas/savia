import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStackOutputs, renderEnvFromOutputs } from "./outputs.mjs";

const OUTPUTS = {
  authD1Id: "auth-uuid",
  domainD1Id: "domain-uuid",
  documentsBucketName: "savia-documents-preview",
  resolvedEnvironment: "preview",
  resolvedPublicOrigin: "https://savia-preview.hefesoft.com",
  workerNames: { api: "savia-agencies-preview" },
  databaseNames: {
    auth: "savia-auth-preview",
    domain: "savia-agencies-preview",
  },
  deletionProtected: false,
};

describe("pulumi stack outputs", () => {
  it("parses and validates required outputs", () => {
    const parsed = parseStackOutputs(JSON.stringify(OUTPUTS));
    assert.equal(parsed.documentsBucketName, "savia-documents-preview");
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

  it("builds render env from stack outputs", () => {
    const env = renderEnvFromOutputs(OUTPUTS, "/repo");
    assert.equal(env.SAVIA_AUTH_D1_ID, "auth-uuid");
    assert.equal(env.SAVIA_DOMAIN_D1_ID, "domain-uuid");
    assert.equal(env.SAVIA_DOCUMENTS_BUCKET, "savia-documents-preview");
    assert.equal(
      env.SAVIA_PUBLIC_ORIGIN,
      "https://savia-preview.hefesoft.com",
    );
    assert.equal(env.SAVIA_DEPLOY_ENVIRONMENT, "preview");
    assert.equal(env.SAVIA_DEPLOY_CONFIG_ROOT, "/repo");
  });
});
