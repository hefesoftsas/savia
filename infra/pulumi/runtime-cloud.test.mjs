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
    "/workers/scripts/savia-preview/versions/v1": {
      resources: {
        bindings: [
          { name: "SECRET", type: "secret_text", text: "DO_NOT_SERIALIZE" },
          { type: "service", service: "savia-auth-preview" },
          {
            type: "durable_object_namespace",
            script_name: "savia-request-preview",
          },
          { type: "durable_object_namespace", script_name: "savia-preview" },
        ],
      },
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
  const snapshot = await client.readSnapshot({ includeDependencies: true });
  assert.equal(snapshot.workerVersions[0].versionId, "v1");
  assert.deepEqual(snapshot.secretWorkerNames, ["savia-preview"]);
  assert.deepEqual(snapshot.workerDependencies, [
    {
      name: "savia-preview",
      dependencies: ["savia-auth-preview", "savia-request-preview"],
    },
  ]);
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

test("secret Worker names remain input-ordered when snapshot chains finish out of order", async () => {
  const accountId = "a".repeat(32),
    workers = Array.from({ length: 4 }, (_, index) => ({
      name: `savia-secret-${index}`,
      cloudId: String(index + 1).repeat(32),
    })),
    finishOrder = [];
  const client = createRuntimeCloudClient(
    { accountId, environment: "preview", workers },
    {
      env: { CLOUDFLARE_API_TOKEN: "credential" },
      fetcher: async (url) => {
        const parsed = new URL(url),
          path = parsed.pathname.split(accountId)[1] ?? parsed.pathname,
          worker = workers.find(
            (row) => path.includes(row.cloudId) || path.includes(row.name),
          );
        if (worker && /^\/workers\/(workers|scripts)\//.test(path)) {
          const index = workers.indexOf(worker);
          await new Promise((resolve) =>
            setTimeout(resolve, (workers.length - index) * 5),
          );
        }
        let result = [];
        if (
          path === "/workers/durable_objects/namespaces" ||
          path === "/workers/domains" ||
          path === "/workflows" ||
          path === "/queues"
        )
          result = [];
        else if (path.startsWith("/workers/workers/"))
          result = {
            id: worker.cloudId,
            name: worker.name,
            deployed_on: "now",
          };
        else if (path.endsWith("/deployments"))
          result = {
            deployments: [
              {
                versions: [{ version_id: `v-${worker.name}`, percentage: 100 }],
              },
            ],
          };
        else if (path.includes("/versions/"))
          result = {
            resources: {
              bindings: [
                { type: "secret_text", name: "PRIVATE", text: "SECRET_CANARY" },
              ],
            },
          };
        else if (path.endsWith("/schedules")) {
          finishOrder.push(worker.name);
          result = { schedules: [] };
        } else if (parsed.pathname.includes("/zones/"))
          result = parsed.pathname.endsWith("/workers/routes")
            ? []
            : { account: { id: accountId }, name: "hefesoft.com" };
        else assert.fail(`Unexpected API path ${path}`);
        return Response.json({
          success: true,
          result,
          result_info: { page: 1, total_pages: 1 },
        });
      },
    },
  );

  const snapshot = await client.readSnapshot();
  assert.deepEqual(finishOrder, workers.map((row) => row.name).reverse());
  assert.deepEqual(
    snapshot.secretWorkerNames,
    workers.map((row) => row.name),
  );
  assert.equal(JSON.stringify(snapshot).includes("SECRET_CANARY"), false);
});

test("Preview snapshot worker chains are bounded and preserve input ordering", async () => {
  const accountId = "a".repeat(32),
    workers = Array.from({ length: 7 }, (_, index) => ({
      name: `savia-worker-${index}`,
      cloudId: String(index + 1).repeat(32),
    }));
  let activeWorkerCalls = 0,
    maximumWorkerCalls = 0;
  const client = createRuntimeCloudClient(
    { accountId, environment: "preview", workers },
    {
      env: { CLOUDFLARE_API_TOKEN: "credential" },
      fetcher: async (url) => {
        const parsed = new URL(url),
          path = parsed.pathname.split(accountId)[1] ?? parsed.pathname;
        const workerCall = /^\/workers\/(workers|scripts)\//.test(path);
        if (workerCall) {
          activeWorkerCalls++;
          maximumWorkerCalls = Math.max(maximumWorkerCalls, activeWorkerCalls);
          await new Promise((resolve) => setTimeout(resolve, 3));
          activeWorkerCalls--;
        }
        let result = [];
        const identity = workers.find(
          (worker) =>
            path.includes(worker.cloudId) || path.includes(worker.name),
        );
        if (path === "/workers/durable_objects/namespaces") result = [];
        else if (
          path === "/workers/domains" ||
          path === "/workflows" ||
          path === "/queues"
        )
          result = [];
        else if (path.startsWith("/workers/workers/"))
          result = {
            id: identity.cloudId,
            name: identity.name,
            deployed_on: "now",
          };
        else if (path.endsWith("/deployments"))
          result = {
            deployments: [
              {
                versions: [
                  { version_id: `v-${identity.name}`, percentage: 100 },
                ],
              },
            ],
          };
        else if (path.includes("/versions/"))
          result = { resources: { bindings: [] } };
        else if (path.endsWith("/schedules"))
          result = { schedules: [{ cron: identity.name }] };
        else if (parsed.pathname.includes("/zones/"))
          result = parsed.pathname.endsWith("/workers/routes")
            ? []
            : { account: { id: accountId }, name: "hefesoft.com" };
        else assert.fail(`Unexpected API path ${path}`);
        return Response.json({
          success: true,
          result,
          result_info: { page: 1, total_pages: 1 },
        });
      },
    },
  );

  const snapshot = await client.readSnapshot();
  assert.ok(maximumWorkerCalls > 1);
  assert.ok(maximumWorkerCalls <= 4);
  assert.deepEqual(
    snapshot.workerVersions.map((row) => row.name),
    workers.map((row) => row.name),
  );
  assert.deepEqual(
    snapshot.attachments.map((row) => row.name),
    workers.map((row) => row.name),
  );
});

test("Preview snapshot stops launching workers after a failure and settles in-flight chains", async () => {
  const accountId = "a".repeat(32),
    workers = [
      { name: "savia-first", cloudId: "1".repeat(32) },
      { name: "savia-fails", cloudId: "2".repeat(32) },
      { name: "savia-not-started", cloudId: "3".repeat(32) },
    ];
  const calls = [],
    settled = new Set();
  const client = createRuntimeCloudClient(
    { accountId, environment: "preview", workers },
    {
      readConcurrency: 2,
      env: { CLOUDFLARE_API_TOKEN: "credential" },
      fetcher: async (url) => {
        const path = new URL(url).pathname.split(accountId)[1];
        calls.push(path);
        if (path === `/workers/workers/${workers[0].cloudId}`) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          settled.add(workers[0].name);
          return Response.json({
            success: true,
            result: {
              id: workers[0].cloudId,
              name: workers[0].name,
              deployed_on: "now",
            },
          });
        }
        if (path === `/workers/workers/${workers[1].cloudId}`) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          settled.add(workers[1].name);
          return Response.json({
            success: true,
            result: {
              id: workers[1].cloudId,
              name: "wrong-identity",
              deployed_on: "now",
            },
          });
        }
        let result = [];
        if (
          path === "/workers/durable_objects/namespaces" ||
          path === "/workers/domains" ||
          path === "/workflows" ||
          path === "/queues"
        )
          result = [];
        else if (path === `/workers/scripts/${workers[0].name}/deployments`)
          result = {
            deployments: [
              { versions: [{ version_id: "v-first", percentage: 100 }] },
            ],
          };
        else if (
          path === `/workers/scripts/${workers[0].name}/versions/v-first`
        )
          result = { resources: { bindings: [] } };
        else if (path === `/workers/scripts/${workers[0].name}/schedules`)
          result = { schedules: [] };
        else if (path.startsWith("/workers/scripts/"))
          result = {
            schedules: [],
            deployments: [],
            resources: { bindings: [] },
          };
        else if (new URL(url).pathname.startsWith("/zones/"))
          result = new URL(url).pathname.endsWith("/workers/routes")
            ? []
            : { account: { id: accountId }, name: "hefesoft.com" };
        else assert.fail(`Unexpected API path ${path}`);
        return Response.json({
          success: true,
          result,
          result_info: { page: 1, total_pages: 1 },
        });
      },
    },
  );

  await assert.rejects(client.readSnapshot(), /identity/);
  assert.deepEqual(
    [...settled].sort(),
    [workers[0].name, workers[1].name].sort(),
  );
  assert.equal(calls.includes(`/workers/workers/${workers[2].cloudId}`), false);
  assert.equal(
    calls.includes(`/workers/scripts/${workers[0].name}/deployments`),
    false,
  );
});

test("runtime snapshot concurrency is validated and defaults to serial outside Preview", async () => {
  const accountId = "a".repeat(32),
    workers = [
      { name: "savia-first", cloudId: "1".repeat(32) },
      { name: "savia-second", cloudId: "2".repeat(32) },
    ];
  let active = 0,
    maximum = 0;
  const client = createRuntimeCloudClient(
    { accountId, environment: "production", workers },
    {
      env: { CLOUDFLARE_API_TOKEN: "credential" },
      fetcher: async (url) => {
        const parsed = new URL(url),
          path = parsed.pathname.split(accountId)[1] ?? parsed.pathname;
        let result = [];
        if (/^\/workers\/(workers|scripts)\//.test(path)) {
          active++;
          maximum = Math.max(maximum, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active--;
        }
        if (
          path === "/workers/durable_objects/namespaces" ||
          path === "/workers/domains" ||
          path === "/workflows" ||
          path === "/queues"
        )
          result = [];
        else if (path.startsWith("/workers/workers/")) {
          const worker = workers.find(
            (row) => row.cloudId === path.split("/").at(-1),
          );
          result = {
            id: worker.cloudId,
            name: worker.name,
            deployed_on: "now",
          };
        } else if (path.endsWith("/deployments")) {
          const name = path.split("/")[3];
          result = {
            deployments: [
              { versions: [{ version_id: `v-${name}`, percentage: 100 }] },
            ],
          };
        } else if (path.includes("/versions/"))
          result = { resources: { bindings: [] } };
        else if (path.endsWith("/schedules")) result = { schedules: [] };
        else if (parsed.pathname.includes("/zones/"))
          result = parsed.pathname.endsWith("/workers/routes")
            ? []
            : { account: { id: accountId }, name: "hefesoft.com" };
        else assert.fail(`Unexpected API path ${path}`);
        return Response.json({
          success: true,
          result,
          result_info: { page: 1, total_pages: 1 },
        });
      },
    },
  );
  await client.readSnapshot();
  assert.equal(maximum, 1);
  assert.equal(
    Object.hasOwn(await client.readSnapshot(), "workerDependencies"),
    false,
  );
  assert.throws(
    () =>
      createRuntimeCloudClient(
        { accountId, workers },
        { readConcurrency: 5, env: { CLOUDFLARE_API_TOKEN: "credential" } },
      ),
    /concurrency/,
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

test("rate limiting honors Retry-After without retrying authentication failures", async () => {
  const sleeps = [];
  let attempts = 0;
  const options = {
    env: { CLOUDFLARE_API_TOKEN: "credential" },
    sleep: async (ms) => sleeps.push(ms),
    fetcher: async () => {
      attempts++;
      return attempts === 1
        ? Response.json(
            { success: false },
            { status: 429, headers: { "retry-after": "2" } },
          )
        : Response.json({ success: true, result: [] });
    },
  };
  const client = createRuntimeCloudClient(
    { accountId: "a".repeat(32), workers: [] },
    options,
  );
  assert.deepEqual(await client.api("/queues"), []);
  assert.deepEqual(sleeps, [2000]);
  let unauthorized = 0;
  const failed = createRuntimeCloudClient(
    { accountId: "a".repeat(32), workers: [] },
    {
      ...options,
      fetcher: async () => {
        unauthorized++;
        return Response.json({ success: false }, { status: 401 });
      },
    },
  );
  await assert.rejects(failed.api("/queues"), /401/);
  assert.equal(unauthorized, 1);
});

test("GET retries transient Cloudflare server errors after canceling the response body", async () => {
  const accountId = "a".repeat(32);
  for (const status of [500, 502, 503, 504]) {
    const events = [];
    let attempts = 0;
    const client = createRuntimeCloudClient(
      { accountId, workers: [] },
      {
        env: { CLOUDFLARE_API_TOKEN: "credential" },
        sleep: async (milliseconds) => events.push(`sleep:${milliseconds}`),
        fetcher: async (_url, options) => {
          attempts += 1;
          assert.equal(options.method, "GET");
          if (attempts === 1) {
            let closeTimer;
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      JSON.stringify({ success: false }),
                    ),
                  );
                  closeTimer = setTimeout(() => controller.close(), 1);
                },
                cancel() {
                  clearTimeout(closeTimer);
                  events.push("cancel");
                },
              }),
              { status },
            );
          }
          return Response.json({ success: true, result: ["recovered"] });
        },
      },
    );

    assert.deepEqual(await client.api("/queues"), ["recovered"]);
    assert.equal(attempts, 2);
    assert.deepEqual(events, ["cancel", "sleep:1000"]);
  }
});

test("GET server-error retries stop after the existing bounded attempts", async () => {
  const accountId = "a".repeat(32);
  let attempts = 0;
  let canceledBodies = 0;
  const sleeps = [];
  const client = createRuntimeCloudClient(
    { accountId, workers: [] },
    {
      env: { CLOUDFLARE_API_TOKEN: "credential" },
      sleep: async (milliseconds) => sleeps.push(milliseconds),
      fetcher: async () => {
        attempts += 1;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({
                    errors: [{ message: "PRIVATE_SERVER_DETAIL" }],
                  }),
                ),
              );
            },
            cancel() {
              canceledBodies += 1;
            },
          }),
          { status: 500 },
        );
      },
    },
  );

  await assert.rejects(client.api("/queues"), (error) => {
    assert.match(error.message, /GET \/queues failed \(500\)/);
    assert.equal(error.message.includes("PRIVATE_SERVER_DETAIL"), false);
    return true;
  });
  assert.equal(attempts, 4);
  assert.equal(canceledBodies, 4);
  assert.deepEqual(sleeps, [1000, 2000, 4000]);
});

test("mutating requests do not retry Cloudflare server errors", async () => {
  const accountId = "a".repeat(32);
  let attempts = 0;
  const sleeps = [];
  const client = createRuntimeCloudClient(
    { accountId, workers: [] },
    {
      env: { CLOUDFLARE_API_TOKEN: "credential" },
      sleep: async (milliseconds) => sleeps.push(milliseconds),
      fetcher: async (_url, options) => {
        attempts += 1;
        assert.equal(options.method, "POST");
        return Response.json({ success: false }, { status: 502 });
      },
    },
  );

  await assert.rejects(
    client.api("/queues", { method: "POST", body: {} }),
    /502/,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(sleeps, []);
});

test("network errors are returned without retry", async () => {
  const accountId = "a".repeat(32);
  let attempts = 0;
  const client = createRuntimeCloudClient(
    { accountId, workers: [] },
    {
      env: { CLOUDFLARE_API_TOKEN: "credential" },
      sleep: async () => assert.fail("network errors must not be retried"),
      fetcher: async () => {
        attempts += 1;
        throw new Error("network failure");
      },
    },
  );

  await assert.rejects(client.api("/queues"), /network failure/);
  assert.equal(attempts, 1);
});

test("route mutations verify zone custody before sending a write", async () => {
  const accountId = "a".repeat(32),
    zoneId = "c".repeat(32),
    calls = [];
  let owner = "d".repeat(32);
  const client = createRuntimeCloudClient(
    { accountId, workers: [] },
    {
      env: { CLOUDFLARE_API_TOKEN: "canary", CLOUDFLARE_ZONE_ID: zoneId },
      fetcher: async (url, options) => {
        calls.push({ url, method: options.method });
        return Response.json({
          success: true,
          result:
            new URL(url).pathname === `/client/v4/zones/${zoneId}`
              ? { account: { id: owner }, name: "hefesoft.com" }
              : [],
        });
      },
    },
  );
  await assert.rejects(
    client.zoneApi("/workers/routes/owned", { method: "DELETE" }),
    /account mismatch/,
  );
  assert.equal(
    calls.some((row) => row.method === "DELETE"),
    false,
  );
  owner = accountId;
  await client.zoneApi("/workers/routes/owned", { method: "DELETE" });
  assert.equal(
    calls.at(-1).url,
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes/owned`,
  );
});

test("explicit metadata inventory can observe an undeployed identity without querying nonexistent script settings", async () => {
  const accountId = "a".repeat(32),
    cloudId = "b".repeat(32),
    calls = [];
  const client = createRuntimeCloudClient(
    {
      accountId,
      environment: "inventory",
      workers: [{ name: "savia-preview", cloudId }],
    },
    {
      env: { CLOUDFLARE_API_TOKEN: "test" },
      fetcher: async (url) => {
        const path = new URL(url).pathname.split(accountId)[1];
        calls.push(path);
        if (path === `/workers/workers/${cloudId}`)
          return Response.json({
            success: true,
            result: { id: cloudId, name: "savia-preview", deployed_on: null },
          });
        if (path.startsWith("/workers/scripts/"))
          throw new Error("queried undeployed script");
        return Response.json({ success: true, result: [] });
      },
    },
  );
  const snapshot = await client.readSnapshot({
    allowUndeployed: true,
    includeDependencies: true,
  });
  assert.equal(snapshot.workerVersions[0].versionId, null);
  assert.deepEqual(snapshot.undeployedWorkerNames, ["savia-preview"]);
  assert.deepEqual(snapshot.workerDependencies, [
    { name: "savia-preview", dependencies: [] },
  ]);
  assert.equal(
    calls.some((path) => path.startsWith("/workers/scripts/")),
    false,
  );
});

test("a persisted Flows pause is observed without changing data or exposing control rows", async () => {
  const accountId = "a".repeat(32),
    cloudId = "b".repeat(32),
    name = "savia-flows-preview",
    databaseId = "11111111-1111-4111-8111-111111111111";
  const flags = [
    { type: "plain_text", name: "SAVIA_FLOWS_EXECUTION_ENABLED", text: "true" },
    { type: "plain_text", name: "SAVIA_FLOWS_MAINTENANCE", text: "false" },
    { type: "d1", name: "DB", database_id: databaseId },
  ];
  const client = createRuntimeCloudClient(
    { accountId, workers: [{ name, cloudId }] },
    {
      env: { CLOUDFLARE_API_TOKEN: "test" },
      fetcher: async (url, options) => {
        const path = new URL(url).pathname.split(accountId)[1];
        let result = [];
        if (path === `/workers/workers/${cloudId}`)
          result = { id: cloudId, name };
        else if (path.endsWith("/deployments"))
          result = {
            deployments: [
              { versions: [{ version_id: "v1", percentage: 100 }] },
            ],
          };
        else if (path.endsWith("/versions/v1"))
          result = { resources: { bindings: flags } };
        else if (path.endsWith("/schedules")) result = { schedules: [] };
        else if (path === `/d1/database/${databaseId}/query`) {
          const { sql } = JSON.parse(options.body);
          assert.match(sql, /^SELECT /);
          result = [
            {
              success: true,
              results: sql.includes("sqlite_schema")
                ? [{ name: "savia_flows_execution_control" }]
                : [{ paused: 1, generation: 100 }],
            },
          ];
        }
        return Response.json({ success: true, result });
      },
    },
  );
  const snapshot = await client.readSnapshot();
  assert.deepEqual(snapshot.maintenanceWorkerNames, [name]);
  assert.equal(
    JSON.stringify(snapshot).includes("savia_flows_execution_control"),
    false,
  );
  flags.push({
    type: "plain_text",
    name: "SAVIA_FLOWS_POLICY_GENERATION",
    text: "101",
  });
  assert.deepEqual(
    (await client.readSnapshot()).maintenanceWorkerNames,
    [],
    "a newer final generation supersedes the backup pause on admission",
  );
  flags[0].text = "false";
  assert.deepEqual((await client.readSnapshot()).maintenanceWorkerNames, []);
});

test("runtime maintenance comes from the deployed version, not newer script settings", async () => {
  const accountId = "a".repeat(32),
    cloudId = "b".repeat(32),
    name = "savia-preview";
  const client = createRuntimeCloudClient(
    { accountId, workers: [{ name, cloudId }] },
    {
      env: { CLOUDFLARE_API_TOKEN: "test" },
      fetcher: async (url) => {
        const path = new URL(url).pathname.split(accountId)[1];
        let result = [];
        if (path === `/workers/workers/${cloudId}`)
          result = { id: cloudId, name };
        else if (path.endsWith("/deployments"))
          result = {
            deployments: [
              { versions: [{ version_id: "serving-v1", percentage: 100 }] },
            ],
          };
        else if (path.endsWith("/versions/serving-v1"))
          result = {
            resources: {
              bindings: [
                {
                  type: "plain_text",
                  name: "SAVIA_MAINTENANCE",
                  text: "true",
                },
              ],
            },
          };
        else if (path.endsWith("/settings"))
          result = {
            bindings: [
              {
                type: "plain_text",
                name: "SAVIA_MAINTENANCE",
                text: "false",
              },
            ],
          };
        else if (path.endsWith("/schedules")) result = { schedules: [] };
        return Response.json({ success: true, result });
      },
    },
  );

  assert.deepEqual((await client.readSnapshot()).maintenanceWorkerNames, [
    name,
  ]);
});

test("the Flows pause latch uses the policy generation bound to serving traffic", async () => {
  const accountId = "a".repeat(32),
    cloudId = "b".repeat(32),
    name = "savia-flows-preview",
    databaseId = "11111111-1111-4111-8111-111111111111";
  const servingBindings = [
    { type: "plain_text", name: "SAVIA_FLOWS_EXECUTION_ENABLED", text: "true" },
    { type: "plain_text", name: "SAVIA_FLOWS_MAINTENANCE", text: "false" },
    { type: "plain_text", name: "SAVIA_FLOWS_POLICY_GENERATION", text: "100" },
    { type: "d1", name: "DB", database_id: databaseId },
  ];
  const latestBindings = servingBindings.map((binding) =>
    binding.name === "SAVIA_FLOWS_POLICY_GENERATION"
      ? { ...binding, text: "101" }
      : binding,
  );
  const client = createRuntimeCloudClient(
    { accountId, workers: [{ name, cloudId }] },
    {
      env: { CLOUDFLARE_API_TOKEN: "test" },
      fetcher: async (url, options) => {
        const path = new URL(url).pathname.split(accountId)[1];
        let result = [];
        if (path === `/workers/workers/${cloudId}`)
          result = { id: cloudId, name };
        else if (path.endsWith("/deployments"))
          result = {
            deployments: [
              { versions: [{ version_id: "serving-v1", percentage: 100 }] },
            ],
          };
        else if (path.endsWith("/versions/serving-v1"))
          result = { resources: { bindings: servingBindings } };
        else if (path.endsWith("/settings"))
          result = { bindings: latestBindings };
        else if (path.endsWith("/schedules")) result = { schedules: [] };
        else if (path === `/d1/database/${databaseId}/query`) {
          const { sql } = JSON.parse(options.body);
          result = [
            {
              success: true,
              results: sql.includes("sqlite_schema")
                ? [{ name: "savia_flows_execution_control" }]
                : [{ paused: 1, generation: 100 }],
            },
          ];
        }
        return Response.json({ success: true, result });
      },
    },
  );

  assert.deepEqual(
    (await client.readSnapshot()).maintenanceWorkerNames,
    [name],
    "the newer uploaded generation cannot supersede the serving version's pause",
  );
  servingBindings.find(
    (binding) => binding.name === "SAVIA_FLOWS_POLICY_GENERATION",
  ).text = "101";
  assert.deepEqual(
    (await client.readSnapshot()).maintenanceWorkerNames,
    [],
    "a newer generation on the serving version supersedes the persisted pause",
  );
});

test("runtime snapshots continue to reject traffic-split deployments", async () => {
  const accountId = "a".repeat(32),
    cloudId = "b".repeat(32),
    name = "savia-preview";
  const client = createRuntimeCloudClient(
    { accountId, workers: [{ name, cloudId }] },
    {
      env: { CLOUDFLARE_API_TOKEN: "test" },
      fetcher: async (url) => {
        const path = new URL(url).pathname.split(accountId)[1];
        let result = [];
        if (path === `/workers/workers/${cloudId}`)
          result = { id: cloudId, name };
        else if (path.endsWith("/deployments"))
          result = {
            deployments: [
              {
                versions: [
                  { version_id: "serving-v1", percentage: 80 },
                  { version_id: "serving-v2", percentage: 20 },
                ],
              },
            ],
          };
        return Response.json({ success: true, result });
      },
    },
  );

  await assert.rejects(client.readSnapshot(), /one fully deployed version/);
});
