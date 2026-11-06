import assert from "node:assert/strict";
import test from "node:test";

import worker from "./worker.mjs";

function d1() {
  let writes = 0;
  return {
    get writes() {
      return writes;
    },
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              return { results: [] };
            },
            async first() {
              return null;
            },
            async run() {
              writes += 1;
              return { meta: { changes: 0 } };
            },
          };
        },
        async all() {
          return { results: [] };
        },
        async first() {
          return null;
        },
        async run() {
          writes += 1;
          return { meta: { changes: 0 } };
        },
        sql,
      };
    },
    async batch(statements) {
      writes += statements.length;
      return statements.map(() => ({ meta: { changes: 0 } }));
    },
    async exec() {
      writes += 1;
    },
  };
}

function namespace({ closed = false } = {}) {
  return {
    idFromName(name) {
      assert.equal(name, "production-backup-v1");
      return name;
    },
    get() {
      return {
        async fetch(request) {
          const { pathname } = new URL(request.url);
          if (pathname === "/enter" && closed) {
            return Response.json(
              { error: "backup in progress" },
              { status: 503 },
            );
          }
          if (pathname === "/enter") {
            const body = await request.json();
            return Response.json({ permit: body.permit });
          }
          if (pathname === "/leave") return Response.json({ ok: true });
          return Response.json({ error: "not found" }, { status: 404 });
        },
      };
    },
  };
}

function environment({ closed = false } = {}) {
  const databases = {
    AGENCY_PRODUCTION: d1(),
    AGENCY_PREVIEW: d1(),
    AGENCY_BRANCH: d1(),
  };
  return {
    ...databases,
    PRODUCTION_BACKUP_GATE: namespace({ closed }),
    PREVIEW_BACKUP_GATE: namespace({ closed }),
    databases,
  };
}

test("closed production backup gate rejects cleanup before any D1 write", async () => {
  const env = environment({ closed: true });
  const pending = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    worker.scheduled(null, env, {
      waitUntil(promise) {
        pending.push(promise);
      },
    });
    assert.equal(pending.length, 1);
    await assert.rejects(pending[0], /backup gate enter failed/);
  } finally {
    console.error = originalError;
  }
  assert.equal(
    Object.values(env.databases).reduce(
      (sum, database) => sum + database.writes,
      0,
    ),
    0,
  );
});

test("scheduled cleanup fails closed if either backup gate is missing", () => {
  const env = environment();
  delete env.PREVIEW_BACKUP_GATE;
  assert.throws(
    () => worker.scheduled(null, env, { waitUntil() {} }),
    /Missing required bindings: PREVIEW_BACKUP_GATE/,
  );
  assert.equal(
    Object.values(env.databases).reduce(
      (sum, database) => sum + database.writes,
      0,
    ),
    0,
  );
});
