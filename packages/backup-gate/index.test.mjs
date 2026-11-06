import test from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
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

test("status optionally inspects outstanding permits without removing or expiring them", async () => {
  const { coordinator, storage } = makeCoordinator();
  const permit = crypto.randomUUID();
  await send(coordinator, "/enter", { permit });
  const before = await storage.get("backup-gate:v1");
  const plain = await send(coordinator, "/status", { owner: "inspection" });
  assert.equal(Object.hasOwn(plain.body, "permits"), false);
  const inspected = await send(coordinator, "/status", {
    owner: "inspection",
    includePermits: true,
  });
  assert.deepEqual(inspected.body.permits, [
    {
      permit,
      createdAt: before.permits[permit].createdAt,
    },
  ]);
  assert.equal(inspected.body.active, 1);
  assert.equal(inspected.body.drained, false);
  assert.deepEqual(await storage.get("backup-gate:v1"), before);
  await send(coordinator, "/acquire", { owner: "backup", ttlMs: 30_000 });
  assert.equal(
    (
      await send(coordinator, "/status", {
        owner: "inspection",
        includePermits: true,
      })
    ).status,
    409,
  );
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
  assert.equal(namespaceCalls, 0);
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
  assert.equal(namespaceCalls, 20);
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

test("plain SELECT statements bypass backup gate RPC for D1 read methods", async () => {
  const calls = [];
  const statement = {
    bind(...args) {
      calls.push(`bind:${args.join(",")}`);
      return this;
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
      return { value: 1 };
    },
    async run() {
      calls.push("run");
      return { success: true };
    },
  };
  let gateRequests = 0;
  const guarded = guardStorageEnvironment({
    BACKUP_GATE: {
      idFromName: (name) => name,
      get: () => ({
        async fetch(request) {
          gateRequests += 1;
          const body = await request.json();
          return new URL(request.url).pathname === "/enter"
            ? Response.json({ permit: body.permit })
            : Response.json({ ok: true });
        },
      }),
    },
    DB: {
      prepare() {
        return statement;
      },
      async batch() {},
      async exec() {},
    },
  });

  assert.deepEqual(
    await guarded.DB.prepare("  SELECT value FROM records WHERE id = ?  ")
      .bind(1)
      .all(),
    { results: [] },
  );
  assert.deepEqual(
    await guarded.DB.prepare("\nselect count(*) FROM records;\n").raw(),
    [],
  );
  assert.deepEqual(
    await guarded.DB.prepare("SELECT value FROM records WHERE id = ?;")
      .bind(2)
      .first(),
    { value: 1 },
  );
  assert.deepEqual(await guarded.DB.prepare("SELECT 1").run(), {
    success: true,
  });
  assert.equal(gateRequests, 0);
  assert.deepEqual(calls, ["bind:1", "all", "raw", "bind:2", "first", "run"]);
});

test("unsafe SQL prefixes, embedded semicolons, and multi-statements remain guarded", async () => {
  const gatePaths = [];
  const executed = [];
  const guarded = guardStorageEnvironment({
    BACKUP_GATE: {
      idFromName: (name) => name,
      get: () => ({
        async fetch(request) {
          const path = new URL(request.url).pathname;
          gatePaths.push(path);
          const body = await request.json();
          return path === "/enter"
            ? Response.json({ permit: body.permit })
            : Response.json({ ok: true });
        },
      }),
    },
    DB: {
      prepare(sql) {
        return {
          async first() {
            executed.push(sql);
            return null;
          },
        };
      },
      async batch() {},
      async exec() {},
    },
  });
  const unsafeQueries = [
    "WITH selected AS (SELECT 1) SELECT * FROM selected",
    'PRAGMA table_info("records")',
    "-- comment before query\nSELECT * FROM records",
    "/* comment before query */ SELECT * FROM records",
    "SELECT 1; DELETE FROM records",
    "SELECT ';' AS value",
    "SELECT 1 -- ; another statement\n",
    "SELECT 1;;",
  ];

  for (const query of unsafeQueries) await guarded.DB.prepare(query).first();

  assert.deepEqual(executed, unsafeQueries);
  assert.equal(gatePaths.filter((path) => path === "/enter").length, 8);
  assert.equal(gatePaths.filter((path) => path === "/leave").length, 8);
});

test("UPDATE RETURNING stays guarded when read methods execute it", async () => {
  const gatePaths = [];
  let databaseCalls = 0;
  const guarded = guardStorageEnvironment({
    BACKUP_GATE: {
      idFromName: (name) => name,
      get: () => ({
        async fetch(request) {
          const path = new URL(request.url).pathname;
          gatePaths.push(path);
          const body = await request.json();
          return path === "/enter"
            ? Response.json({ permit: body.permit })
            : Response.json({ ok: true });
        },
      }),
    },
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            databaseCalls += 1;
            return { id: "updated" };
          },
        };
      },
      async batch() {},
      async exec() {},
    },
  });

  assert.deepEqual(
    await guarded.DB.prepare("UPDATE records SET value = ? RETURNING id")
      .bind("new")
      .first(),
    { id: "updated" },
  );
  assert.equal(databaseCalls, 1);
  assert.deepEqual(gatePaths, ["/enter", "/leave"]);
});

test("SELECT classification survives bind and withSession without stale statement reuse", async () => {
  const gatePaths = [];
  const sharedStatement = {
    bind() {
      return this;
    },
    async first() {
      return { ok: true };
    },
  };
  const db = {
    prepare() {
      return sharedStatement;
    },
    withSession() {
      return this;
    },
    async batch() {},
    async exec() {},
  };
  const guarded = guardStorageEnvironment({
    BACKUP_GATE: {
      idFromName: (name) => name,
      get: () => ({
        async fetch(request) {
          const path = new URL(request.url).pathname;
          gatePaths.push(path);
          const body = await request.json();
          return path === "/enter"
            ? Response.json({ permit: body.permit })
            : Response.json({ ok: true });
        },
      }),
    },
    DB: db,
  });

  await guarded.DB.withSession().prepare("SELECT 1").bind().first();
  assert.deepEqual(gatePaths, []);
  await guarded.DB.withSession()
    .prepare("UPDATE records SET value = 1 RETURNING id")
    .bind()
    .first();
  assert.deepEqual(gatePaths, ["/enter", "/leave"]);
});

test("successful leave responses are discarded without changing the guarded write result", async () => {
  let leaveBodyCancelled = false;
  const coordinator = {
    async fetch(request) {
      if (new URL(request.url).pathname === "/enter")
        return Response.json({ permit: (await request.json()).permit });
      return new Response(
        new ReadableStream({
          cancel() {
            leaveBodyCancelled = true;
            throw new Error("response cleanup failed");
          },
        }),
      );
    },
  };
  const db = {
    prepare() {
      return {
        async run() {
          return { success: true, meta: { changes: 1 } };
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

  assert.deepEqual(await guarded.DB.prepare("UPDATE records").run(), {
    success: true,
    meta: { changes: 1 },
  });
  assert.equal(leaveBodyCancelled, true);
});

test("failed gate response bodies are discarded before retrying", async () => {
  let failedBodyCancelled = false;
  let enters = 0;
  const coordinator = {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/enter") {
        enters += 1;
        if (enters === 1)
          return new Response(
            new ReadableStream({
              cancel() {
                failedBodyCancelled = true;
                throw new Error("failed response cleanup failed");
              },
            }),
            { status: 500 },
          );
        assert.equal(failedBodyCancelled, true);
        return Response.json({ permit: (await request.json()).permit });
      }
      return Response.json({ ok: true });
    },
  };
  const db = {
    prepare() {
      return {
        async run() {
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

  await guarded.DB.prepare("UPDATE records").run();

  assert.equal(enters, 2);
  assert.equal(failedBodyCancelled, true);
});

test("sequential writes release successful leave response slots", async () => {
  let outstandingLeaveBodies = 0;
  let writes = 0;
  const coordinator = {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/enter") {
        if (outstandingLeaveBodies >= 6)
          return Response.json(
            { error: "response slots exhausted" },
            { status: 503 },
          );
        return Response.json({ permit: (await request.json()).permit });
      }
      outstandingLeaveBodies += 1;
      return new Response(
        new ReadableStream({
          cancel() {
            outstandingLeaveBodies -= 1;
          },
        }),
      );
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
  const guarded = guardStorageEnvironment({
    BACKUP_GATE: { idFromName: (name) => name, get: () => coordinator },
    DB: db,
  });

  for (let index = 0; index < 8; index += 1)
    await guarded.DB.prepare("UPDATE records").run();

  assert.equal(writes, 8);
  assert.equal(outstandingLeaveBodies, 0);
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

test("transport exceptions retry with fresh stubs without replacing cached wrappers", async () => {
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
  assert.equal(stubRequests, 3);
  assert.equal(writes, 1);
});

test("concurrent requests use request-local stubs for writes and retries on a held D1 proxy", async () => {
  const requestContext = new AsyncLocalStorage();
  const observed = [];
  let namespaceCalls = 0;
  let recovered = false;
  const namespace = {
    idFromName: (name) => name,
    get: () => {
      namespaceCalls += 1;
      const stubOwner = requestContext.getStore();
      assert.ok(stubOwner, "stub acquisition must run within a request");
      return {
        async fetch(request) {
          const requestOwner = requestContext.getStore();
          const path = new URL(request.url).pathname;
          observed.push({ stubOwner, requestOwner, path });
          if (stubOwner !== requestOwner) {
            throw new Error("I/O on behalf of a different request");
          }
          const body = await request.json();
          if (stubOwner === "request-a" && path === "/enter" && !recovered) {
            recovered = true;
            throw new Error("simulated lost enter acknowledgement");
          }
          return path === "/enter"
            ? Response.json({ permit: body.permit })
            : Response.json({ ok: true });
        },
      };
    },
  };
  const statement = {
    async run() {
      return { success: true };
    },
  };
  const database = {
    prepare() {
      return statement;
    },
    async batch() {},
    async exec() {},
  };
  const guarded = requestContext.run("request-a", () =>
    guardStorageEnvironment({ BACKUP_GATE: namespace, DB: database }),
  );
  const heldProxy = guarded.DB;

  const first = requestContext.run("request-a", () =>
    heldProxy.prepare("UPDATE records").run(),
  );
  const second = requestContext.run("request-b", () =>
    heldProxy.prepare("UPDATE records").run(),
  );
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(firstResult, { success: true });
  assert.deepEqual(secondResult, { success: true });
  assert.equal(recovered, true);
  assert.ok(namespaceCalls >= 5);
  assert.ok(observed.length >= 5);
  assert.ok(
    observed.every(({ stubOwner, requestOwner }) => stubOwner === requestOwner),
  );
  assert.deepEqual(
    observed.map(({ path }) => path).filter((path) => path === "/enter").length,
    3,
  );
  assert.deepEqual(
    observed.map(({ path }) => path).filter((path) => path === "/leave").length,
    2,
  );
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
