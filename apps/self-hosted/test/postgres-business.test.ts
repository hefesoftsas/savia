import type { PostgresDatabase } from "../src/postgres/database";
import { createExtensionRegistry } from "../../../packages/studio-shared/src/extension-package";
import { registerDialect } from "@savia/db/dialect";
import { postgresDialect } from "@savia/db/postgres-dialect";
import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { createStudioApp } from "@savia/studio-server";
import { makeConfig } from "../../../packages/studio-shared/src/metadata";
import { openSqliteDatabase } from "../src/sqlite";
import { migratePostgres } from "../src/postgres/migrations";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";
import { maintainRecordHistory } from "@savia/studio-server/record-history-storage";

async function businessContract(db: D1Database) {
  const app = createStudioApp("business", { principalId: "tester" });
  const json = async (path: string, method = "GET", input?: unknown) => {
    const response = await app.request(
      "http://localhost/api" + path,
      {
        method,
        headers: { "content-type": "application/json" },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      },
      { DB: db } as any,
    );
    const result: any = await response.json();
    expect(response.status, JSON.stringify(result)).toBeLessThan(300);
    return result;
  };
  await json("/bootstrap", "POST");
  await json("/objects", "POST", {
    name: "items",
    label: "Items",
    config: {
      ...makeConfig({
        name: { type: "Textbox", label: "Name", required: true },
        amount: { type: "Number", label: "Amount" },
        stage: { type: "Textbox", label: "Stage" },
      }),
    },
  });
  await json("/record-history-settings/items", "PUT", {
    enabled: true,
    fields: ["name", "amount"],
    retentionDays: 90,
    expectedVersion: 1,
  });
  const first = (
    await json("/records/items", "POST", {
      name: "Alpha",
      amount: 2,
      stage: "open",
    })
  ).data;
  await json("/records/items", "POST", {
    name: "Beta",
    amount: 10,
    stage: "open",
  });
  const rows = await json("/records/items?sort=amount&order=ASC");
  expect(rows.data.map((row: any) => row.amount)).toEqual([2, 10]);
  expect(rows.total).toBe(2);
  const summary = await json(
    "/records/items/summary?group=stage&amountField=amount",
  );
  expect(summary.data).toEqual([{ value: "open", count: 2, amount: 12 }]);
  expect(
    (await json("/records/items/summary?group=amount&amountField=amount")).data
      .map((row: any) => row.value)
      .sort((a: number, b: number) => a - b),
  ).toEqual([2, 10]);
  const updated = await json(`/records/items/${first.id}`, "PATCH", {
    amount: 3,
    _version: first._version,
  });
  expect(updated.data.amount).toBe(3);
  const history = await json(`/record-history/items/${first.id}`);
  expect(history.data.length).toBeGreaterThan(0);
  const usage = await json("/record-history-settings/items/usage");
  expect(usage.data.logicalBytes).toBeGreaterThan(0);
  expect(usage.data.expiredEvents).toBe(0);
  const mutation = {
    mutationId: "create-synced",
    action: "create",
    id: "synced",
    data: { name: "Synced", amount: 4 },
  };
  const receipt = await json("/local-sync/push/items", "POST", mutation);
  expect(await json("/local-sync/push/items", "POST", mutation)).toEqual(
    receipt,
  );
  expect(
    (await json("/local-sync/pull/items")).documents.length,
  ).toBeGreaterThan(0);
  await json(`/records/items/${first.id}?version=2`, "DELETE");
  expect((await json("/records/items")).total).toBe(2);
  await maintainRecordHistory(db);
  return {
    summary: summary.data,
    remaining: (await json("/records/items")).data
      .map((row: any) => row.name)
      .sort(),
  };
}

(postgresTestUrl ? describe : describe.skip)(
  "native PostgreSQL CRM business parity",
  () => {
    it("runs the same bootstrap, schema, record, aggregate, history and deletion contract as SQLite", async () => {
      const sqlite = openSqliteDatabase(":memory:");
      try {
        const directory = resolve("../../packages/studio-server/migrations");
        for (const file of readdirSync(directory)
          .filter((file) => file.endsWith(".sql"))
          .sort())
          await sqlite.exec(readFileSync(resolve(directory, file), "utf8"));
        const expected = await businessContract(
          sqlite as unknown as D1Database,
        );
        await withPostgresFixture(async (db, connectionString) => {
          registerDialect(db, postgresDialect);
          await migratePostgres({
            connectionString,
            schema: "savia_core",
            directory: resolve("../../packages/db/postgres"),
            seed: false,
          });
          expect(await businessContract(db as unknown as D1Database)).toEqual(
            expected,
          );
        });
      } finally {
        sqlite.close();
      }
    }, 180_000);
  },
);

// Stop both transactions after their guarded snapshot has been validated, before
// either mutation starts. This deterministically exercises metadata write skew.
function guardedBarrier(db: PostgresDatabase, match: (sql: string) => boolean) {
  const execute = db.execute.bind(db);
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi
    .spyOn(db, "execute")
    .mockImplementation(async (statement, client) => {
      const result = await execute(statement, client);
      if (
        client &&
        statement.sql.startsWith("INSERT INTO crm_write_guards") &&
        match(statement.sql)
      ) {
        arrivals++;
        if (arrivals === 2) release();
        await ready;
      }
      return result;
    });
  return { restore: () => spy.mockRestore(), arrivals: () => arrivals };
}

(postgresTestUrl ? describe : describe.skip)(
  "native PostgreSQL metadata concurrency",
  () => {
    async function fixture(run: (db: PostgresDatabase) => Promise<void>) {
      await withPostgresFixture(async (db, connectionString) => {
        registerDialect(db, postgresDialect);
        await migratePostgres({
          connectionString,
          schema: "savia_core",
          directory: resolve("../../packages/db/postgres"),
          seed: false,
        });
        await run(db);
      });
    }
    function requests(
      db: PostgresDatabase,
      options: Parameters<typeof createStudioApp>[1] = {},
    ) {
      const app = createStudioApp("concurrency", {
        principalId: "tester",
        ...options,
      });
      return (path: string, method: string, body?: unknown) =>
        app.request(
          "http://localhost/api" + path,
          {
            method,
            headers: { "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          },
          { DB: db } as any,
        );
    }
    it("allows only one settings update for a shared expected schema version", async () => {
      await fixture(async (db) => {
        const request = requests(db);
        expect(
          (
            await request("/objects", "POST", {
              name: "items",
              label: "Items",
              config: makeConfig({ name: { type: "Textbox", label: "Name" } }),
            })
          ).status,
        ).toBe(201);
        const barrier = guardedBarrier(db, (sql) =>
          sql.includes("SELECT version=? FROM crm_objects"),
        );
        try {
          const responses = await Promise.all(
            [30, 90].map((retentionDays) =>
              request("/record-history-settings/items", "PUT", {
                enabled: true,
                fields: ["name"],
                retentionDays,
                expectedVersion: 1,
              }),
            ),
          );
          expect(barrier.arrivals()).toBe(2);
          expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
          expect(
            await db
              .prepare(
                "SELECT version FROM crm_objects WHERE tenant_id=? AND name=?",
              )
              .bind("concurrency", "items")
              .first("version"),
          ).toBe(2);
          expect(
            await db
              .prepare("SELECT count(*) AS n FROM crm_write_guards")
              .first("n"),
          ).toBe(0);
        } finally {
          barrier.restore();
        }
      });
    }, 180_000);
    it("cannot enable a dependent while concurrently disabling its requirement", async () => {
      await fixture(async (db) => {
        const extensionRegistry = createExtensionRegistry(
          ["base", "dependent"].map((name) => ({
            manifest: {
              format: "savia.extension",
              formatVersion: 1,
              id: `example.${name}`,
              version: "1.0.0",
              label: name,
              description: "Concurrency contract",
              requires: name === "dependent" ? ["example.base"] : [],
              apiVersion: 1,
            },
          })),
        );
        const request = requests(db, { extensionRegistry });
        for (const name of ["base", "dependent"])
          expect(
            (await request(`/extensions/example.${name}/install`, "POST"))
              .status,
          ).toBeLessThan(300);
        expect(
          (
            await request("/extensions/example.dependent", "PATCH", {
              enabled: false,
            })
          ).status,
        ).toBe(200);
        const barrier = guardedBarrier(
          db,
          (sql) =>
            sql.includes("SELECT enabled=1 FROM crm_extension_installations") ||
            sql.includes("SELECT count(*)=0 FROM crm_solution_installations"),
        );
        try {
          const responses = await Promise.all([
            request("/extensions/example.base", "PATCH", { enabled: false }),
            request("/extensions/example.dependent", "PATCH", {
              enabled: true,
            }),
          ]);
          expect(barrier.arrivals()).toBe(2);
          expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
          const rows = await db
            .prepare(
              "SELECT id,enabled FROM crm_extension_installations WHERE tenant_id=? ORDER BY id",
            )
            .bind("concurrency")
            .all<{ id: string; enabled: number }>();
          expect(rows.results[1].enabled <= rows.results[0].enabled).toBe(true);
          expect(
            await db
              .prepare("SELECT count(*) AS n FROM crm_write_guards")
              .first("n"),
          ).toBe(0);
        } finally {
          barrier.restore();
        }
      });
    }, 180_000);
  },
);
