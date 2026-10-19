import assert from "node:assert/strict";
import test from "node:test";

import {
  branchStackName,
  parseD1List,
  parseR2BucketList,
  branchStackConfig,
  ensureBranchInfrastructure,
  listR2Buckets,
  selectBranchInfrastructure,
  validateBranchOutputs,
} from "./branch-preview-resources.mjs";
import { previewNames } from "../../scripts/preview-environment.mjs";

const TEST_ACCOUNT_ID = "08a0d36f8b0357684f83e4bfeb6628b6";

test("uses an isolated deterministic Pulumi stack per validated branch slug", () => {
  assert.equal(branchStackName("feature-login"), "branch-feature-login");
  assert.throws(() => branchStackName("main"), /protected ref/);
  assert.throws(() => branchStackName("../login"), /slug/);
});

test("parses Wrangler D1 and Cloudflare R2 inventories for safe adoption", () => {
  assert.deepEqual(
    parseD1List(
      JSON.stringify({
        result: [
          { name: "unrelated", uuid: "other-id" },
          { name: "savia-auth-preview-feature-login", uuid: "auth-id" },
        ],
      }),
    ),
    [
      { name: "unrelated", uuid: "other-id" },
      { name: "savia-auth-preview-feature-login", uuid: "auth-id" },
    ],
  );
  assert.deepEqual(
    parseR2BucketList(
      JSON.stringify({
        success: true,
        result: {
          buckets: [{ name: "savia-documents-preview-feature-login" }],
        },
      }),
    ),
    [{ name: "savia-documents-preview-feature-login" }],
  );
  assert.throws(() => parseD1List("not json"), /valid JSON/);
  assert.deepEqual(parseD1List('{"result":[]}'), []);
  assert.throws(() => parseR2BucketList('{"buckets":[{}]}'), /bucket list/);
});

test("lists all R2 buckets through the paginated authenticated Cloudflare API", async () => {
  const calls = [];
  const rows = await listR2Buckets({
    accountId: TEST_ACCOUNT_ID,
    token: "secret-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const page = new URL(url).searchParams.has("cursor") ? 2 : 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            buckets: [{ name: page === 1 ? "bucket-one" : "bucket-two" }],
          },
          result_info: {
            total_count: 2,
            ...(page === 1 ? { cursor: "second-page" } : {}),
          },
        }),
      };
    },
  });
  assert.deepEqual(rows, [{ name: "bucket-one" }, { name: "bucket-two" }]);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).searchParams.has("cursor"), false);
  assert.match(calls[1].url, /cursor=second-page/);
  assert.equal(calls[0].options.headers.authorization, "Bearer secret-token");
  await assert.rejects(
    listR2Buckets({
      accountId: TEST_ACCOUNT_ID,
      token: "secret-token",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        json: async () => ({ success: false }),
      }),
    }),
    /bucket list failed \(403\)/,
  );
  await assert.rejects(
    listR2Buckets({
      accountId: TEST_ACCOUNT_ID,
      token: "secret-token",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: { buckets: [] } }),
      }),
    }),
    /pagination metadata is invalid/,
  );
});

test("configures exact existing D1 and R2 IDs as provider imports", () => {
  const names = previewNames("feature-login");
  assert.deepEqual(
    branchStackConfig({
      accountId: TEST_ACCOUNT_ID,
      names,
      existing: { authD1Id: "auth-id", domainD1Id: null, bucket: true },
    }),
    {
      accountId: TEST_ACCOUNT_ID,
      branchSlug: "feature-login",
      authDatabaseName: names.databases.auth,
      domainDatabaseName: names.databases.domain,
      bucketName: names.bucket,
      importAuthD1Id: `${TEST_ACCOUNT_ID}/auth-id`,
      importDomainD1Id: "",
      importBucketId: `${TEST_ACCOUNT_ID}/savia-documents-preview-feature-login/default`,
    },
  );
});

test("validates Pulumi outputs against the requested branch names and IDs", () => {
  const names = previewNames("feature-login");
  const outputs = {
    branchSlug: "feature-login",
    cloudflareAccountId: TEST_ACCOUNT_ID,
    authDatabaseName: names.databases.auth,
    domainDatabaseName: names.databases.domain,
    documentsBucketName: names.bucket,
    authD1Id: "auth-id",
    domainD1Id: "domain-id",
  };
  assert.deepEqual(
    validateBranchOutputs(outputs, "feature-login", TEST_ACCOUNT_ID),
    outputs,
  );
  assert.throws(
    () =>
      validateBranchOutputs(
        outputs,
        "feature-login",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    /account must match/,
  );
  assert.throws(
    () =>
      validateBranchOutputs(
        { ...outputs, branchSlug: "other" },
        "feature-login",
      ),
    /slug does not match/,
  );
  assert.throws(
    () =>
      validateBranchOutputs({ ...outputs, domainD1Id: "" }, "feature-login"),
    /domainD1Id is required/,
  );
});

function branchDependencyFixture(outputs) {
  const names = previewNames("feature-login"),
    events = [];
  const deps = {
    context: async () => ({
      checkpoint: outputs
        ? {
            stateExport: {
              deployment: {
                resources: [{ type: "pulumi:pulumi:Stack", outputs }],
              },
            },
          }
        : undefined,
    }),
    inventory: async () => ({
      version: 1,
      accountId: TEST_ACCOUNT_ID,
      environment: "branch-feature-login",
      project: "savia-branch-preview",
      stack: "branch-feature-login",
      profile: {
        enabledWorkers: [],
        flowsEnabled: false,
        searchEnabled: false,
        tenantSubdomains: [],
      },
      resources: [],
    }),
    assertManagementProtected: async () => true,
    plan: async (args) => {
      events.push(args);
      return { operation: "provision" };
    },
    applyPlan: async () => {
      events.push("apply");
      outputs = {
        branchSlug: "feature-login",
        cloudflareAccountId: TEST_ACCOUNT_ID,
        authDatabaseName: names.databases.auth,
        domainDatabaseName: names.databases.domain,
        documentsBucketName: names.bucket,
        authD1Id: "auth-id",
        domainD1Id: "domain-id",
      };
      return { status: "applied" };
    },
  };
  return { deps, events };
}
test("legacy branch selection is read-only and rejects absent or mismatched stack outputs", async () => {
  const { deps, events } = branchDependencyFixture();
  await assert.rejects(
    selectBranchInfrastructure({
      slug: "feature-login",
      env: { CLOUDFLARE_ACCOUNT_ID: TEST_ACCOUNT_ID },
      dependencies: deps,
    }),
    /No deployed stack/,
  );
  assert.deepEqual(events, []);
  const wrong = branchDependencyFixture({
    branchSlug: "other",
    cloudflareAccountId: TEST_ACCOUNT_ID,
  });
  await assert.rejects(
    ensureBranchInfrastructure({
      slug: "feature-login",
      env: { CLOUDFLARE_ACCOUNT_ID: TEST_ACCOUNT_ID },
      dependencies: wrong.deps,
    }),
    /slug does not match/,
  );
  assert.deepEqual(wrong.events, []);
});

test("R2 inventory supports the current cursor schema and total-count-only terminal page", async () => {
  const urls = [];
  const rows = await listR2Buckets({
    accountId: TEST_ACCOUNT_ID,
    token: "test",
    fetchImpl: async (url) => {
      urls.push(url);
      const cursor = new URL(url).searchParams.get("cursor");
      return Response.json({
        success: true,
        result: { buckets: [{ name: cursor ? "bucket-two" : "bucket-one" }] },
        result_info: {
          total_count: 2,
          ...(!cursor ? { cursor: "next-cursor" } : {}),
        },
      });
    },
  });
  assert.equal(rows.length, 2);
  assert.equal(new URL(urls[1]).searchParams.get("cursor"), "next-cursor");
});
