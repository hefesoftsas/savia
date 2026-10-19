import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishPlan, validatePluginPlan } from "./publish-preview-plugins.mjs";

const plan = {
  kind: "plugin",
  plugins: [
    {
      directory: "packages/plugin-example",
      id: "example.plugin",
      version: "2.0.0",
      previousVersion: "1.0.0",
    },
  ],
};

const artifact = {
  ...plan.plugins[0],
  manifest: {
    format: "savia.extension",
    formatVersion: 1,
    id: "example.plugin",
    version: "2.0.0",
    apiVersion: 1,
  },
  storeJson: { format: "savia.store", formatVersion: 1 },
  sha256: "a".repeat(64),
  path: "/tmp/example.zip",
};

function checkpoint() {
  return {
    version: 1,
    plugins: [
      {
        id: "example.plugin",
        version: "2.0.0",
        previousVersion: "1.0.0",
        tenants: [
          { tenant: "tenant:1", status: "update" },
          { tenant: "tenant:2", status: "skip" },
        ],
      },
    ],
  };
}

async function listen(handler) {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    try {
      const result = await handler({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body,
      });
      response.writeHead(result.status ?? 200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(result.payload ?? {}));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test("plugin plan rejects paths or identity/version data outside the approved shape", () => {
  assert.throws(() =>
    validatePluginPlan({
      ...plan,
      plugins: [{ ...plan.plugins[0], directory: "../secrets" }],
    }),
  );
  assert.throws(() =>
    validatePluginPlan({
      ...plan,
      plugins: [{ ...plan.plugins[0], id: "../plugin" }],
    }),
  );
  assert.throws(() =>
    validatePluginPlan({
      ...plan,
      plugins: [{ ...plan.plugins[0], version: "latest" }],
    }),
  );
});

test("preflight checkpoint is durable before installs and idempotent tenants are skipped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "preview-plugin-publish-"));
  const recovery = join(directory, "recovery.json");
  const packaged = { ...artifact, path: join(directory, "plugin.zip") };
  await writeFile(packaged.path, "zip fixture");
  const routes = [];
  const server = await listen(async ({ method, url, headers }) => {
    assert.equal(headers.authorization, "Bearer private-session");
    routes.push(`${method} ${url}`);
    if (url === "/preflight") {
      assert.equal(
        await readFile(recovery, "utf8").then(
          () => true,
          () => false,
        ),
        false,
      );
      return { payload: { checkpoint: checkpoint() } };
    }
    if (url === "/publish") {
      const metadata = await readFile(recovery, "utf8");
      assert.equal(JSON.parse(metadata).plugins[0].id, "example.plugin");
      return { payload: { updated: true } };
    }
    throw new Error(`unexpected route ${url}`);
  });
  try {
    const result = await publishPlan(
      plan,
      [packaged],
      recovery,
      server.baseUrl,
      "private-session",
    );
    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 1);
    assert.deepEqual(routes, ["POST /preflight", "POST /publish"]);
    assert.equal((await stat(recovery)).mode & 0o777, 0o600);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("partial publish failure invokes guarded rollback with the durable checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "preview-plugin-rollback-"));
  const recovery = join(directory, "recovery.json");
  const packaged = { ...artifact, path: join(directory, "plugin.zip") };
  await writeFile(packaged.path, "zip fixture");
  const routes = [];
  const server = await listen(async ({ method, url, body }) => {
    routes.push(`${method} ${url}`);
    if (url === "/preflight") return { payload: { checkpoint: checkpoint() } };
    if (url === "/publish")
      return { status: 409, payload: { error: "concurrent version change" } };
    if (url === "/rollback") {
      assert.equal(JSON.parse(body).checkpoint.plugins[0].version, "2.0.0");
      assert.equal(JSON.parse(await readFile(recovery, "utf8")).version, 1);
      return { payload: { restored: [] } };
    }
    throw new Error(`unexpected route ${url}`);
  });
  try {
    await assert.rejects(
      publishPlan(
        plan,
        [packaged],
        recovery,
        server.baseUrl,
        "private-session",
      ),
      /HTTP 409/,
    );
    assert.deepEqual(routes, [
      "POST /preflight",
      "POST /publish",
      "POST /rollback",
    ]);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("checkpoint write failure blocks every upload", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "preview-plugin-checkpoint-fail-"),
  );
  const routes = [];
  const server = await listen(async ({ method, url }) => {
    routes.push(`${method} ${url}`);
    if (url === "/preflight") return { payload: { checkpoint: checkpoint() } };
    return { payload: {} };
  });
  try {
    await assert.rejects(
      publishPlan(
        plan,
        [artifact],
        join(directory, "missing", "recovery.json"),
        server.baseUrl,
        "private-session",
      ),
      /ENOENT/,
    );
    assert.deepEqual(routes, ["POST /preflight"]);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("post-publication health failure invokes rollback", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "preview-plugin-health-fail-"),
  );
  const recovery = join(directory, "recovery.json");
  const packaged = { ...artifact, path: join(directory, "plugin.zip") };
  await writeFile(packaged.path, "zip fixture");
  const routes = [];
  const server = await listen(async ({ method, url }) => {
    routes.push(`${method} ${url}`);
    if (url === "/preflight") return { payload: { checkpoint: checkpoint() } };
    if (url === "/publish") return { payload: { updated: true } };
    if (url === "/rollback") return { payload: { restored: ["tenant:1"] } };
    throw new Error(`unexpected route ${url}`);
  });
  try {
    await assert.rejects(
      publishPlan(
        plan,
        [packaged],
        recovery,
        server.baseUrl,
        "private-session",
        {
          verify: async () => {
            throw new Error("health check failed");
          },
        },
      ),
      /health check failed/,
    );
    assert.deepEqual(routes, [
      "POST /preflight",
      "POST /publish",
      "POST /rollback",
    ]);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("surfaces rollback failures as an aggregate without claiming completion", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "preview-plugin-rollback-fails-"),
  );
  const recovery = join(directory, "recovery.json");
  const packaged = { ...artifact, path: join(directory, "plugin.zip") };
  await writeFile(packaged.path, "zip fixture");
  const server = await listen(async ({ url }) => {
    if (url === "/preflight") return { payload: { checkpoint: checkpoint() } };
    if (url === "/publish")
      return { status: 409, payload: { error: "publish failed" } };
    if (url === "/rollback")
      return {
        status: 500,
        payload: { error: "rollback could not restore tenant:1" },
      };
    throw new Error(`unexpected route ${url}`);
  });
  try {
    await assert.rejects(
      publishPlan(
        plan,
        [packaged],
        recovery,
        server.baseUrl,
        "private-session",
      ),
      (error) =>
        error instanceof AggregateError &&
        /rollback could not restore tenant:1/.test(error.message),
    );
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
