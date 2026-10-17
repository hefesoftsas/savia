import test from "node:test";
import assert from "node:assert/strict";
import { BackupCoordinator, guardStorageEnvironment } from "./index.mjs";

class MemoryStorage {
  values = new Map();
  async get(key) {
    return structuredClone(this.values.get(key));
  }
  async put(key, value) {
    this.values.set(key, structuredClone(value));
  }
}

function makeCoordinator(storage = new MemoryStorage()) {
  const state = { storage };
  return { coordinator: new BackupCoordinator(state, {}), storage };
}

async function send(coordinator, path, body) {
  if (path === "/enter" && body === undefined)
    body = { permit: crypto.randomUUID() };
  const response = await coordinator.fetch(
    new Request(`https://gate.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  );
  return { status: response.status, body: await response.json() };
}

test("lease closes gate, rejects foreign owner, and permits renew/release by owner", async () => {
  const { coordinator } = makeCoordinator();
  const first = await send(coordinator, "/acquire", {
    owner: "snapshot-a",
    ttlMs: 30_000,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.owner, "snapshot-a");
  assert.equal(
    (
      await send(coordinator, "/acquire", {
        owner: "snapshot-b",
        ttlMs: 30_000,
      })
    ).status,
    409,
  );
  assert.equal(
    (await send(coordinator, "/renew", { owner: "snapshot-b", ttlMs: 30_000 }))
      .status,
    409,
  );
  assert.equal(
    (await send(coordinator, "/status", { owner: "snapshot-b" })).status,
    409,
  );
  assert.equal(
    (await send(coordinator, "/renew", { owner: "snapshot-a", ttlMs: 30_000 }))
      .status,
    200,
  );
  assert.equal(
    (await send(coordinator, "/release", { owner: "snapshot-a" })).status,
    200,
  );
  const status = await send(coordinator, "/status", { owner: "snapshot-a" });
  assert.equal(status.body.owner, null);
  assert.equal(status.body.expiresAt, null);
  assert.equal(Object.hasOwn(status.body, "lease"), false);
});

test("acquire drains existing writers and blocks new writers until release", async () => {
  const { coordinator } = makeCoordinator();
  const entered = await send(coordinator, "/enter");
  assert.equal(entered.status, 200);
  const acquired = await send(coordinator, "/acquire", {
    owner: "backup",
    ttlMs: 30_000,
  });
  assert.equal(acquired.body.drained, false);
  assert.equal(acquired.body.active, 1);
  assert.equal(acquired.body.owner, "backup");
  assert.equal(Object.hasOwn(acquired.body, "lease"), false);
  assert.equal((await send(coordinator, "/enter")).status, 503);
  assert.equal(
    (await send(coordinator, "/leave", { permit: entered.body.permit })).status,
    200,
  );
  assert.equal(
    (await send(coordinator, "/status", { owner: "backup" })).body.drained,
    true,
  );
  assert.equal(
    (await send(coordinator, "/release", { owner: "backup" })).status,
    200,
  );
});

test("enter is idempotent for an existing client permit even after the gate closes", async () => {
  const { coordinator } = makeCoordinator();
  const permit = crypto.randomUUID();
  const first = await send(coordinator, "/enter", { permit });
  assert.equal(first.status, 200);
  assert.equal(
    (await send(coordinator, "/acquire", { owner: "backup", ttlMs: 30_000 }))
      .status,
    200,
  );
  const retry = await send(coordinator, "/enter", { permit });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.permit, permit);
  assert.equal(
    (await send(coordinator, "/enter", { permit: crypto.randomUUID() })).status,
    503,
  );
  assert.equal(
    (await send(coordinator, "/status", { owner: "backup" })).body.active,
    1,
  );
});

test("leave is idempotent for a valid UUID whose permit is already absent", async () => {
  const { coordinator } = makeCoordinator();
  const response = await send(coordinator, "/leave", {
    permit: crypto.randomUUID(),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.active, 0);
});

test("active permits and lease survive coordinator restart", async () => {
  const storage = new MemoryStorage();
  const first = makeCoordinator(storage).coordinator;
  const enter = await send(first, "/enter");
  await send(first, "/acquire", { owner: "backup", ttlMs: 30_000 });
  const restarted = makeCoordinator(storage).coordinator;
  assert.equal(
    (await send(restarted, "/status", { owner: "backup" })).body.active,
    1,
  );
  assert.equal((await send(restarted, "/enter")).status, 503);
  assert.equal(
    (await send(restarted, "/leave", { permit: enter.body.permit })).status,
    200,
  );
});

test("corrupt persisted coordinator state fails closed without resetting permits", async () => {
  const storage = new MemoryStorage();
  await storage.put("backup-gate:v1", { version: 2, lease: null, permits: {} });
  const { coordinator } = makeCoordinator(storage);
  assert.equal((await send(coordinator, "/enter")).status, 500);
  assert.deepEqual(await storage.get("backup-gate:v1"), {
    version: 2,
    lease: null,
    permits: {},
  });
});

test("expired lease opens gate while active permits remain until leave", async () => {
  const storage = new MemoryStorage();
  const { coordinator } = makeCoordinator(storage);
  const permit = await send(coordinator, "/enter");
  await send(coordinator, "/acquire", { owner: "backup", ttlMs: 30_000 });
  const saved = await storage.get("backup-gate:v1");
  saved.lease.expiresAt = Date.now() - 1;
  await storage.put("backup-gate:v1", saved);
  const status = await send(coordinator, "/status", { owner: "backup" });
  assert.equal(status.body.owner, null);
  assert.equal(status.body.expiresAt, null);
  const next = await send(coordinator, "/enter");
  assert.equal(next.status, 200);
  assert.equal(
    (await send(coordinator, "/status", { owner: "backup" })).body.active,
    2,
  );
  await send(coordinator, "/leave", { permit: permit.body.permit });
  await send(coordinator, "/leave", { permit: next.body.permit });
});

test("concurrent enter/acquire is serialized without losing a permit", async () => {
  const { coordinator } = makeCoordinator();
  const [enter, acquire] = await Promise.all([
    send(coordinator, "/enter"),
    send(coordinator, "/acquire", { owner: "backup", ttlMs: 30_000 }),
  ]);
  assert.equal(enter.status, 200);
  assert.equal(acquire.status, 200);
  assert.equal(acquire.body.active, 1);
  assert.equal(
    (await send(coordinator, "/status", { owner: "backup" })).body.active,
    1,
  );
});

test("release cancels a backup immediately while retaining active permits", async () => {
  const { coordinator } = makeCoordinator();
  const permit = await send(coordinator, "/enter");
  await send(coordinator, "/acquire", { owner: "backup", ttlMs: 30_000 });
  const released = await send(coordinator, "/release", { owner: "backup" });
  assert.equal(released.status, 200);
  assert.equal(released.body.active, 1);
  assert.equal(released.body.drained, false);
  const next = await send(coordinator, "/enter");
  assert.equal(next.status, 200);
  assert.equal(
    (await send(coordinator, "/status", { owner: "backup" })).body.active,
    2,
  );
  await send(coordinator, "/leave", { permit: permit.body.permit });
  await send(coordinator, "/leave", { permit: next.body.permit });
});

test("guardStorageEnvironment wraps D1 and R2 writes while preserving methods and results", async () => {
  const calls = [];
  const coordinator = {
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/enter") {
        calls.push("enter");
        return Response.json({ permit: (await request.json()).permit });
      }
      calls.push(`leave:${(await request.json()).permit}`);
      return Response.json({ ok: true });
    },
  };
  const statement = {
    bind(...args) {
      calls.push(`bind:${args.join(",")}`);
      return this;
    },
    async run() {
      calls.push("run");
      return { success: true };
    },
    async all() {
      calls.push("all");
      return { results: [] };
    },
    async raw() {
      calls.push("raw");
      return [];
    },
    async first() {
      calls.push("first");
      return null;
    },
  };
  const db = {
    prepare(sql) {
      calls.push(`prepare:${sql}`);
      return statement;
    },
    async batch(stmts) {
      calls.push(`batch:${stmts.length}`);
      return [];
    },
    async exec(sql) {
      calls.push(`exec:${sql}`);
      return { count: 1 };
    },
    withSession() {
      calls.push("withSession");
      return this;
    },
  };
  const bucket = {
    async get(key) {
      calls.push(`get:${key}`);
      return null;
    },
    async put(key) {
      calls.push(`put:${key}`);
      return { key };
    },
    async list() {
      calls.push("list");
      return { objects: [] };
    },
    async delete(key) {
      calls.push(`delete:${key}`);
    },
    createMultipartUpload(key) {
      calls.push(`createMultipart:${key}`);
      return {
        async uploadPart() {
          calls.push("uploadPart");
        },
        async complete() {
          calls.push("complete");
        },
        async abort() {
          calls.push("abort");
        },
      };
    },
  };
  let namespaceCalls = 0;
  const namespace = {
    idFromName: (name) => name,
    get: () => {
      namespaceCalls += 1;
      return { fetch: (...args) => coordinator.fetch(...args) };
    },
  };
  const guarded = guardStorageEnvironment({
    SAVIA_BACKUP_GATE_REQUIRED: "true",
    BACKUP_GATE: namespace,
    DB: db,
    FILES: bucket,
  });
  const guardedAgain = guardStorageEnvironment({
    BACKUP_GATE: namespace,
    DB: db,
    FILES: bucket,
  });
  assert.equal(guardedAgain.DB, guarded.DB);
  assert.equal(namespaceCalls, 1);
  assert.deepEqual(await guarded.DB.prepare("UPDATE t").bind(1).run(), {
    success: true,
  });
  assert.deepEqual(await guarded.DB.batch([statement]), []);
  assert.deepEqual(await guarded.DB.exec("DELETE FROM t"), { count: 1 });
  assert.deepEqual(await guarded.DB.withSession().prepare("x").first(), null);
  assert.deepEqual(await guarded.FILES.put("x", "body"), { key: "x" });
  await guarded.FILES.delete("x");
  const multipart = await guarded.FILES.createMultipartUpload("x");
  await multipart.uploadPart(1, "part");
  await multipart.complete([]);
  await multipart.abort();
  assert.equal(calls.filter((call) => call === "enter").length, 10);
  assert.equal(calls.filter((call) => call.startsWith("leave:")).length, 10);
  assert.equal(calls.includes("get:x"), false);
  assert.equal(calls.includes("list"), false);
});

test("failed storage operations still release their permit", async () => {
  const calls = [];
  const coordinator = {
    fetch: async (request) => {
      if (new URL(request.url).pathname === "/enter") {
        calls.push("enter");
        return Response.json({ permit: (await request.json()).permit });
      }
      calls.push(`leave:${(await request.json()).permit}`);
      return Response.json({ ok: true });
    },
  };
  const error = new Error("D1 failed");
  const db = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          throw error;
        },
      };
    },
    async batch() {},
    async exec() {},
  };
  const guarded = guardStorageEnvironment({
    BACKUP_GATE: { idFromName: (name) => name, get: () => coordinator },
    DB: db,
  });
  await assert.rejects(guarded.DB.prepare("UPDATE t").run(), error);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], "enter");
  assert.match(calls[1], /^leave:[0-9a-f-]{36}$/i);
});

test("lost enter and leave acknowledgements retry the same permit without orphaning it", async () => {
  const storage = new MemoryStorage();
  const coordinator = makeCoordinator(storage).coordinator;
  let enters = 0;
  let leaves = 0;
  let writes = 0;
  const stub = {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const response = await coordinator.fetch(request);
      if (path === "/enter" && ++enters === 1)
        throw new Error("enter response was lost");
      if (path === "/leave" && ++leaves === 1)
        throw new Error("leave response was lost");
      return response;
    },
  };
  const namespace = { idFromName: (name) => name, get: () => stub };
  const db = {
    prepare() {
      return {
        async run() {
          writes += 1;
          return { success: true };
        },
      };
    },
    async batch() {},
    async exec() {},
  };
  const guarded = guardStorageEnvironment({ BACKUP_GATE: namespace, DB: db });
  assert.deepEqual(await guarded.DB.prepare("UPDATE t").run(), {
    success: true,
  });
  assert.equal(enters, 2);
  assert.equal(leaves, 2);
  assert.equal(writes, 1);
  assert.deepEqual((await storage.get("backup-gate:v1")).permits, {});
});

test("transport exceptions refresh the Durable Object stub without replacing cached wrappers", async () => {
  const coordinator = makeCoordinator().coordinator;
  let stubRequests = 0;
  let writes = 0;
  const namespace = {
    idFromName: (name) => name,
    get: () => {
      stubRequests += 1;
      if (stubRequests === 1) {
        return {
          fetch: async () => {
            throw new Error("stale stub");
          },
        };
      }
      return { fetch: (request) => coordinator.fetch(request) };
    },
  };
  const db = {
    prepare() {
      return {
        async run() {
          writes += 1;
          return { success: true };
        },
      };
    },
    async batch() {},
    async exec() {},
  };
  const guarded = guardStorageEnvironment({ BACKUP_GATE: namespace, DB: db });
  const guardedAgain = guardStorageEnvironment({
    BACKUP_GATE: namespace,
    DB: db,
  });
  assert.equal(guardedAgain.DB, guarded.DB);
  assert.deepEqual(await guarded.DB.prepare("UPDATE t").run(), {
    success: true,
  });
  assert.equal(stubRequests, 2);
  assert.equal(writes, 1);
});

test("gate leave failures propagate after the storage operation settles", async () => {
  let writes = 0;
  const coordinator = {
    fetch: async (request) =>
      new URL(request.url).pathname === "/enter"
        ? Response.json({ permit: (await request.json()).permit })
        : Response.json({ error: "leave failed" }, { status: 500 }),
  };
  const db = {
    prepare() {
      return {
        async run() {
          writes += 1;
          return { success: true };
        },
      };
    },
    async batch() {},
    async exec() {},
  };
  const guarded = guardStorageEnvironment({
    BACKUP_GATE: { idFromName: (name) => name, get: () => coordinator },
    DB: db,
  });
  await assert.rejects(
    guarded.DB.prepare("UPDATE t").run(),
    /backup gate leave failed/,
  );
  assert.equal(writes, 1);
});

test("a denied permit prevents the storage mutation from being invoked", async () => {
  let writes = 0;
  const coordinator = {
    fetch: async (request) =>
      new URL(request.url).pathname === "/enter"
        ? Response.json({ error: "backup in progress" }, { status: 503 })
        : Response.json({ ok: true }),
  };
  const db = {
    prepare() {
      return {
        async run() {
          writes += 1;
          return { success: true };
        },
      };
    },
    async batch() {},
    async exec() {},
  };
  const guarded = guardStorageEnvironment({
    BACKUP_GATE: { idFromName: (name) => name, get: () => coordinator },
    DB: db,
  });
  await assert.rejects(
    guarded.DB.prepare("UPDATE t").run(),
    /backup gate enter failed/,
  );
  assert.equal(writes, 0);
});

test("required mode fails closed without namespace and optional mode passes through", () => {
  assert.throws(
    () => guardStorageEnvironment({ SAVIA_BACKUP_GATE_REQUIRED: "true" }),
    /BACKUP_GATE/,
  );
  const env = { DB: { prepare() {} } };
  assert.equal(guardStorageEnvironment(env), env);
});
