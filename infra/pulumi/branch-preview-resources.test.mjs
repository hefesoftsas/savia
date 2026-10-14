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
      const page = Number(new URL(url).searchParams.get("page"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: {
            buckets: [{ name: page === 1 ? "bucket-one" : "bucket-two" }],
          },
          result_info: { page, per_page: 1, total_pages: 2 },
        }),
      };
    },
  });
  assert.deepEqual(rows, [{ name: "bucket-one" }, { name: "bucket-two" }]);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /page=1/);
  assert.match(calls[1].url, /page=2/);
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

test("checks Cloudflare inventory before creating and adopting a remote branch stack", async () => {
  const calls = [];
  const events = [];
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
  const env = {
    PULUMI_BACKEND_URL:
      "s3://state?endpoint=account.r2.cloudflarestorage.com&region=auto",
    PULUMI_CONFIG_PASSPHRASE: "passphrase-not-logged",
    AWS_ACCESS_KEY_ID: "access-key-not-logged",
    AWS_SECRET_ACCESS_KEY: "secret-key-not-logged",
    CLOUDFLARE_ACCOUNT_ID: TEST_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: "token-not-logged",
  };
  const run = async (command, args) => {
    calls.push([command, args]);
    events.push({ type: "command", command, args });
    if (args.includes("d1") && args.includes("list")) {
      return {
        stdout: JSON.stringify({
          result: [
            { name: names.databases.auth, uuid: "auth-id" },
            { name: names.databases.domain, uuid: "domain-id" },
          ],
        }),
      };
    }
    if (args[0] === "stack" && args[1] === "select") {
      throw Object.assign(new Error("no stack named branch-feature-login"), {
        stderr: "no stack named branch-feature-login",
      });
    }
    if (args[0] === "stack" && args[1] === "output") {
      return { stdout: JSON.stringify(outputs) };
    }
    if (args[0] === "preview") {
      return { stdout: JSON.stringify({ changeSummary: { import: 3 } }) };
    }
    return { stdout: "" };
  };

  const result = await ensureBranchInfrastructure({
    slug: "feature-login",
    env,
    run,
    fetchImpl: async () => {
      events.push({ type: "r2-list" });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { buckets: [{ name: names.bucket }] },
          result_info: { page: 1, per_page: 1000, total_pages: 1 },
        }),
      };
    },
  });
  assert.equal(result.stack, "branch-feature-login");
  assert.deepEqual(result.outputs, outputs);
  const initIndex = calls.findIndex(
    ([, args]) => args[0] === "stack" && args[1] === "init",
  );
  const initEventIndex = events.findIndex(
    (event) =>
      event.type === "command" &&
      event.args[0] === "stack" &&
      event.args[1] === "init",
  );
  const r2InventoryIndex = events.findIndex(
    (event) => event.type === "r2-list",
  );
  assert.ok(initIndex >= 0);
  assert.ok(r2InventoryIndex >= 0);
  assert.ok(initEventIndex > r2InventoryIndex);
  const d1InventoryIndex = calls.findIndex(
    ([, args]) => args.includes("d1") && args.includes("list"),
  );
  assert.ok(d1InventoryIndex >= 0 && d1InventoryIndex < initIndex);
  const configCalls = calls.filter(
    ([, args]) => args[0] === "config" && args[1] === "set",
  );
  assert.ok(
    configCalls.some(
      ([, args]) =>
        args[2] === "importAuthD1Id" &&
        args[3] === `${TEST_ACCOUNT_ID}/auth-id`,
    ),
  );
  assert.ok(
    configCalls.some(
      ([, args]) =>
        args[2] === "importBucketId" &&
        args[3] === `${TEST_ACCOUNT_ID}/${names.bucket}/default`,
    ),
  );
  assert.ok(
    calls.some(
      ([, args]) => args[0] === "preview" && args.includes("--save-plan"),
    ),
  );
  assert.ok(
    calls.some(([, args]) => args[0] === "up" && args.includes("--plan")),
  );
  assert.ok(
    calls.every(
      ([, args]) =>
        !args.some((arg) =>
          /passphrase-not-logged|access-key-not-logged|token-not-logged/.test(
            arg,
          ),
        ),
    ),
  );
});

test("refuses an existing branch stack whose outputs name another branch before updating it", async () => {
  const calls = [];
  const names = previewNames("feature-login");
  const env = {
    PULUMI_BACKEND_URL:
      "s3://state?endpoint=account.r2.cloudflarestorage.com&region=auto",
    PULUMI_CONFIG_PASSPHRASE: "passphrase",
    AWS_ACCESS_KEY_ID: "access-key",
    AWS_SECRET_ACCESS_KEY: "secret-key",
    CLOUDFLARE_ACCOUNT_ID: TEST_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: "token",
  };
  const run = async (command, args) => {
    calls.push([command, args]);
    if (args.includes("d1") && args.includes("list")) {
      return { stdout: JSON.stringify({ result: [] }) };
    }
    if (args[0] === "stack" && args[1] === "output") {
      return {
        stdout: JSON.stringify({
          branchSlug: "other-branch",
          cloudflareAccountId: TEST_ACCOUNT_ID,
          authDatabaseName: names.databases.auth,
          domainDatabaseName: names.databases.domain,
          documentsBucketName: names.bucket,
          authD1Id: "auth-id",
          domainD1Id: "domain-id",
        }),
      };
    }
    return { stdout: "" };
  };

  await assert.rejects(
    ensureBranchInfrastructure({
      slug: "feature-login",
      env,
      run,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { buckets: [] },
          result_info: { page: 1, per_page: 1000, total_pages: 1 },
        }),
      }),
    }),
    /branch slug does not match/,
  );
  assert.equal(
    calls.some(([, args]) => args[0] === "up" || args[0] === "config"),
    false,
  );
});

test("destroy selection never initializes a missing branch stack", async () => {
  const calls = [];
  const env = {
    PULUMI_BACKEND_URL:
      "s3://state?endpoint=account.r2.cloudflarestorage.com&region=auto",
    PULUMI_CONFIG_PASSPHRASE: "passphrase",
    AWS_ACCESS_KEY_ID: "access-key",
    AWS_SECRET_ACCESS_KEY: "secret-key",
    CLOUDFLARE_ACCOUNT_ID: TEST_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: "token",
  };
  const run = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "stack" && args[1] === "select") {
      throw Object.assign(new Error("no stack named branch-feature-login"), {
        stderr: "no stack named branch-feature-login",
      });
    }
    return { stdout: "" };
  };
  await assert.rejects(
    selectBranchInfrastructure({ slug: "feature-login", env, run }),
    /no stack named/,
  );
  assert.equal(
    calls.some(([, args]) => args[0] === "stack" && args[1] === "init"),
    false,
  );
});

test("refuses a destructive saved plan before the Pulumi up command", async () => {
  const calls = [];
  const names = previewNames("feature-login");
  const env = {
    PULUMI_BACKEND_URL:
      "s3://state?endpoint=account.r2.cloudflarestorage.com&region=auto",
    PULUMI_CONFIG_PASSPHRASE: "passphrase",
    AWS_ACCESS_KEY_ID: "access-key",
    AWS_SECRET_ACCESS_KEY: "secret-key",
    CLOUDFLARE_ACCOUNT_ID: TEST_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: "token",
  };
  const run = async (command, args) => {
    calls.push([command, args]);
    if (args.includes("d1") && args.includes("list")) {
      return { stdout: JSON.stringify({ result: [] }) };
    }
    if (args[0] === "stack" && args[1] === "select") {
      throw Object.assign(new Error("no stack named branch-feature-login"), {
        stderr: "no stack named branch-feature-login",
      });
    }
    if (args[0] === "preview") {
      return { stdout: JSON.stringify({ changeSummary: { delete: 1 } }) };
    }
    if (args[0] === "stack" && args[1] === "output") {
      return {
        stdout: JSON.stringify({
          branchSlug: "feature-login",
          cloudflareAccountId: TEST_ACCOUNT_ID,
          authDatabaseName: names.databases.auth,
          domainDatabaseName: names.databases.domain,
          documentsBucketName: names.bucket,
          authD1Id: "auth-id",
          domainD1Id: "domain-id",
        }),
      };
    }
    return { stdout: "" };
  };

  await assert.rejects(
    ensureBranchInfrastructure({
      slug: "feature-login",
      env,
      run,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { buckets: [] },
          result_info: { page: 1, per_page: 1000, total_pages: 1 },
        }),
      }),
    }),
    /Refusing destructive infrastructure plan: delete/,
  );
  assert.equal(
    calls.some(([, args]) => args[0] === "up"),
    false,
  );
});

test("allows an existing outputless branch stack only when its exported state has no managed resources", async () => {
  const calls = [];
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
  const env = {
    PULUMI_BACKEND_URL:
      "s3://state?endpoint=account.r2.cloudflarestorage.com&region=auto",
    PULUMI_CONFIG_PASSPHRASE: "passphrase",
    AWS_ACCESS_KEY_ID: "access-key",
    AWS_SECRET_ACCESS_KEY: "secret-key",
    CLOUDFLARE_ACCOUNT_ID: TEST_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: "token",
  };
  const run = async (command, args) => {
    calls.push([command, args]);
    if (args.includes("d1") && args.includes("list")) {
      return { stdout: JSON.stringify({ result: [] }) };
    }
    if (args[0] === "stack" && args[1] === "output") {
      return {
        stdout:
          calls.filter(([, callArgs]) => callArgs[1] === "output").length > 1
            ? JSON.stringify(outputs)
            : "{}",
      };
    }
    if (args[0] === "stack" && args[1] === "export") {
      return {
        stdout: JSON.stringify({
          deployment: {
            resources: [
              { type: "pulumi:pulumi:Stack" },
              { type: "pulumi:providers:cloudflare" },
            ],
          },
        }),
      };
    }
    if (args[0] === "preview") {
      return { stdout: JSON.stringify({ changeSummary: { create: 3 } }) };
    }
    return { stdout: "" };
  };

  const result = await ensureBranchInfrastructure({
    slug: "feature-login",
    env,
    run,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: { buckets: [] },
        result_info: { page: 1, per_page: 1000, total_pages: 1 },
      }),
    }),
  });
  assert.deepEqual(result.outputs, outputs);
  assert.ok(calls.some(([, args]) => args[0] === "up"));
});
