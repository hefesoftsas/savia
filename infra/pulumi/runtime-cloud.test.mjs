import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeCloudClient } from "./runtime-cloud.mjs";

test("cloud snapshots verify native identity and exclude binding values", async () => {
  const accountId = "a".repeat(32),
    cloudId = "b".repeat(32);
  const inputs = { accountId, workers: [{ name: "savia-preview", cloudId }] };
  const responses = {
    [`/workers/workers/${cloudId}`]: { id: cloudId, name: "savia-preview" },
    "/workers/scripts/savia-preview/deployments": {
      deployments: [{ versions: [{ version_id: "v1", percentage: 100 }] }],
    },
    "/workers/scripts/savia-preview/settings": {
      bindings: [
        { name: "SECRET", type: "secret_text", text: "DO_NOT_SERIALIZE" },
      ],
    },
    "/workers/scripts/savia-preview/schedules": {
      schedules: [{ cron: "* * * * *" }],
    },
    "/workers/durable_objects/namespaces": [],
    "/workers/domains": [],
    "/workflows": [],
    "/queues": [],
  };
  const fetcher = async (url, opts) => {
    assert.equal(opts.headers.authorization, "Bearer runtime-credential");
    const path = new URL(url).pathname.split(accountId)[1];
    assert.equal(path in responses, true, `Unexpected API path ${path}`);
    return Response.json({
      success: true,
      result: responses[path],
      result_info: { page: 1, total_pages: 1 },
    });
  };
  const client = createRuntimeCloudClient(inputs, {
    env: {
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: "runtime-credential",
    },
    fetcher,
  });
  const snapshot = await client.readSnapshot();
  assert.equal(snapshot.workerVersions[0].versionId, "v1");
  assert.equal(JSON.stringify(snapshot).includes("DO_NOT_SERIALIZE"), false);
  assert.equal(snapshot.attachments[0].kind, "cron");
  responses[`/workers/workers/${cloudId}`].name = "alien";
  await assert.rejects(client.readSnapshot(), /identity/);
  assert.throws(
    () =>
      createRuntimeCloudClient(inputs, {
        env: {
          CLOUDFLARE_ACCOUNT_ID: "c".repeat(32),
          CLOUDFLARE_API_TOKEN: "credential",
        },
      }),
    /account/,
  );
});

test("cloud pagination reads every page and never prints API error bodies", async () => {
  const accountId = "a".repeat(32);
  const client = createRuntimeCloudClient(
    { accountId, workers: [] },
    {
      env: {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: "credential",
      },
      fetcher: async (url) => {
        const page = Number(new URL(url).searchParams.get("page"));
        return Response.json({
          success: true,
          result: [{ id: page }],
          result_info: { page, total_pages: 2 },
        });
      },
    },
  );
  assert.deepEqual(await client.list("/queues"), [{ id: 1 }, { id: 2 }]);
  const failed = createRuntimeCloudClient(
    { accountId, workers: [] },
    {
      env: { CLOUDFLARE_API_TOKEN: "credential" },
      fetcher: async () =>
        Response.json(
          { success: false, errors: [{ message: "SECRET_CANARY" }] },
          { status: 403 },
        ),
    },
  );
  await assert.rejects(
    failed.api("/queues"),
    (e) => e.message.includes("403") && !e.message.includes("SECRET_CANARY"),
  );
});

test("an empty collection with zero API pages is a valid empty inventory", async () => {
  const client = createRuntimeCloudClient(
    { accountId: "a".repeat(32), workers: [] },
    {
      env: { CLOUDFLARE_API_TOKEN: "credential" },
      fetcher: async () =>
        Response.json({
          success: true,
          result: [],
          result_info: { page: 1, total_pages: 0 },
        }),
    },
  );
  assert.deepEqual(await client.list("/queues"), []);
});

test("reference audit finds outside callers through cross-script Durable Object bindings", async () => {
  const accountId = "a".repeat(32),
    namespaceId = "d".repeat(32);
  const client = createRuntimeCloudClient(
    { accountId, workers: [] },
    {
      env: { CLOUDFLARE_API_TOKEN: "credential" },
      fetcher: async (url) => {
        const path = new URL(url).pathname.split(accountId)[1];
        const rows = {
          "/workers/workers": [
            { id: "b".repeat(32), name: "savia-agencies-preview" },
            { id: "c".repeat(32), name: "other-product" },
          ],
          "/workers/scripts/savia-agencies-preview/settings": { bindings: [] },
          "/workers/scripts/other-product/settings": {
            bindings: [
              {
                type: "durable_object_namespace",
                namespace_id: namespaceId,
                name: "STORE",
              },
              {
                type: "service",
                service: "savia-agencies-preview",
                name: "API",
              },
              { type: "secret_text", text: "SECRET_CANARY", name: "SECRET" },
            ],
          },
        };
        assert.ok(path in rows);
        return Response.json({
          success: true,
          result: rows[path],
          result_info: { page: 1, total_pages: 1 },
        });
      },
    },
  );
  const references = await client.inspectReferences({
    resources: [
      { kind: "worker", name: "savia-agencies-preview" },
      {
        kind: "durableObject",
        cloudId: namespaceId,
        parentWorker: "savia-agencies-preview",
      },
    ],
  });
  assert.equal(references.length, 2);
  assert.equal(references[0].caller, "other-product");
  assert.equal(JSON.stringify(references).includes("SECRET_CANARY"), false);
});
