import { registerDialect } from "@savia/db/dialect";
import { postgresDialect } from "@savia/db/postgres-dialect";
import {
  getMaintainedGroupCount,
  getMaintainedSummary,
  summaryConfigurationStatements,
} from "@savia/studio-server/record-summaries";
import {
  getRecordCountStatement,
  getRecordCounts,
} from "@savia/studio-server/record-read-state";
import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import {
  configureObjectPerformance,
  createObject,
} from "../../../packages/studio-server/src/schema";
import { makeConfig } from "../../../packages/studio-shared/src/metadata";
import { migratePostgres } from "../src/postgres/migrations";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";

(postgresTestUrl ? describe : describe.skip)(
  "native PostgreSQL record read summaries",
  () => {
    it("maintains exact counts and configured numeric/text/null summaries through record lifecycle changes", async () => {
      await withPostgresFixture(async (db, connectionString) => {
        registerDialect(db, postgresDialect);
        await migratePostgres({
          connectionString,
          schema: "savia_core",
          directory: resolve("../../packages/db/postgres"),
          seed: false,
        });

        await db
          .prepare(
            "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
          )
          .bind(
            "tenant",
            "items",
            "Items",
            JSON.stringify({
              performance: {
                summaries: [{ group: "stage", amountField: "amount" }],
              },
            }),
          )
          .run();
        await db
          .prepare(
            "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES(?,?,?,?)",
          )
          .bind(
            "tenant",
            "other",
            "Other",
            JSON.stringify({ performance: { summaries: [] } }),
          )
          .run();
        await db.batch(
          summaryConfigurationStatements(db, "tenant", "items", [
            { group: "stage", amountField: "amount" },
          ]),
        );

        await expect(
          db.batch([
            db.prepare(
              `INSERT INTO studio_records(id,tenant_id,object_name,data)
                 VALUES('rollback','tenant','items','{"stage":"rollback","amount":1}')`,
            ),
            db.prepare("SELECT missing_column FROM studio_records"),
          ]),
        ).rejects.toThrow();
        expect(await getRecordCounts(db, "tenant", "items")).toEqual({
          activeCount: 0,
          trashCount: 0,
          revision: 0,
        });

        const records = [
          ["a", "tenant", "items", { stage: "open", amount: 2 }, null],
          ["b", "tenant", "items", { stage: "open", amount: 10 }, null],
          ["c", "tenant", "items", { stage: true, amount: true }, null],
          ["d", "tenant", "items", { stage: 1, amount: 2 }, null],
          [
            "e",
            "tenant",
            "items",
            { stage: null, amount: "bad" },
            "2026-09-29T00:00:00.000Z",
          ],
          ["f", "tenant", "items", { amount: 4 }, null],
          ["g", "tenant", "items", { stage: [1, 2], amount: 5 }, null],
          ["h", "tenant", "items", { stage: { x: 1 }, amount: 6 }, null],
          ["i", "tenant", "items", { stage: 1e-7, amount: 1 }, null],
          ["j", "tenant", "other", { stage: "other", amount: 8 }, null],
        ].map(([id, tenant, object_name, data, deleted_at]) => ({
          id,
          tenant_id: tenant,
          object_name,
          data: JSON.stringify(data),
          deleted_at,
        }));
        await db
          .prepare(
            `INSERT INTO studio_records(id,tenant_id,object_name,data,deleted_at)
             SELECT id,tenant_id,object_name,data,deleted_at
             FROM jsonb_to_recordset(?::jsonb) AS input(
               id text,tenant_id text,object_name text,data text,deleted_at text
             )`,
          )
          .bind(JSON.stringify(records))
          .run();

        expect(await getRecordCounts(db, "tenant", "items")).toEqual({
          activeCount: 8,
          trashCount: 1,
          revision: 9,
        });
        expect(await getRecordCounts(db, "tenant", "other")).toEqual({
          activeCount: 1,
          trashCount: 0,
          revision: 1,
        });

        await db.prepare("SELECT studio_rebuild_record_read_state()").run();

        expect(await getRecordCounts(db, "tenant", "items")).toEqual({
          activeCount: 8,
          trashCount: 1,
          revision: 0,
        });
        expect(
          (
            await getRecordCountStatement(db, "tenant", "items").first<{
              count: number;
            }>()
          )?.count,
        ).toBe(8);
        const summary = await getMaintainedSummary(
          db,
          "tenant",
          "items",
          "stage",
          "amount",
        );
        expect(summary).toEqual([
          { value: 1, count: 2, amount: 3 },
          { value: "open", count: 2, amount: 12 },
          { value: null, count: 1, amount: 4 },
          { value: 1e-7, count: 1, amount: 1 },
          { value: "[1,2]", count: 1, amount: 5 },
          { value: '{"x":1}', count: 1, amount: 6 },
        ]);
        expect(
          await getMaintainedGroupCount(db, "tenant", "items", "stage", true),
        ).toBe(2);
        expect(
          await getMaintainedGroupCount(db, "tenant", "items", "stage", 1),
        ).toBe(2);
        expect(
          await getMaintainedGroupCount(db, "tenant", "items", "stage", 1e-7),
        ).toBe(1);
        expect(
          await getMaintainedGroupCount(db, "tenant", "items", "stage", null),
        ).toBe(1);
        expect(
          await getMaintainedGroupCount(db, "tenant", "items", "amount", 2),
        ).toBe(2);
        expect(
          await getMaintainedGroupCount(
            db,
            "tenant",
            "items",
            "notConfigured",
            null,
          ),
        ).toBe(8);

        await db
          .prepare(
            "UPDATE studio_records SET data=? WHERE tenant_id=? AND id=?",
          )
          .bind(JSON.stringify({ stage: "closed", amount: 3 }), "tenant", "a")
          .run();
        await db
          .prepare(
            "UPDATE studio_records SET deleted_at='2026-09-29T00:00:00.000Z' WHERE tenant_id=? AND id=?",
          )
          .bind("tenant", "b")
          .run();
        expect(await getRecordCounts(db, "tenant", "items")).toEqual({
          activeCount: 7,
          trashCount: 2,
          revision: 2,
        });
        await db
          .prepare(
            "UPDATE studio_records SET deleted_at=NULL WHERE tenant_id=? AND id=?",
          )
          .bind("tenant", "b")
          .run();
        await db
          .prepare(
            "UPDATE studio_records SET object_name='other' WHERE tenant_id=? AND id=?",
          )
          .bind("tenant", "d")
          .run();
        expect(await getRecordCounts(db, "tenant", "items")).toEqual({
          activeCount: 7,
          trashCount: 1,
          revision: 4,
        });
        expect(await getRecordCounts(db, "tenant", "other")).toEqual({
          activeCount: 2,
          trashCount: 0,
          revision: 1,
        });
        await db
          .prepare("DELETE FROM studio_records WHERE tenant_id=? AND id=?")
          .bind("tenant", "c")
          .run();
        expect(await getRecordCounts(db, "tenant", "items")).toEqual({
          activeCount: 6,
          trashCount: 1,
          revision: 5,
        });
        expect(
          await getMaintainedSummary(db, "tenant", "items", "stage", "amount"),
        ).toContainEqual({ value: "closed", count: 1, amount: 3 });
      });
    }, 180_000);

    it("takes the records lock before the summary backfill snapshot", async () => {
      await withPostgresFixture(async (db, connectionString) => {
        registerDialect(db, postgresDialect);
        await migratePostgres({
          connectionString,
          schema: "savia_core",
          directory: resolve("../../packages/db/postgres"),
          seed: false,
        });
        await createObject(db, "summary-race", {
          name: "items",
          label: "Items",
          config: makeConfig({
            stage: { type: "Textbox", label: "Stage" },
            amount: { type: "Number", label: "Amount" },
          }),
        });

        const writer = await db.pool.connect();
        const execute = db.execute.bind(db);
        let signalLockAttempt!: () => void;
        const lockAttempted = new Promise<void>((resolveLock) => {
          signalLockAttempt = resolveLock;
        });
        let settled = false;
        const spy = vi
          .spyOn(db, "execute")
          .mockImplementation(async (statement, client) => {
            if (
              statement.sql ===
              "LOCK TABLE studio_records IN SHARE ROW EXCLUSIVE MODE"
            )
              signalLockAttempt();
            return execute(statement, client);
          });
        try {
          await writer.query("BEGIN");
          await writer.query(
            "INSERT INTO savia_core.studio_records(tenant_id,object_name,id,data) VALUES('summary-race','items','pending','{\"stage\":\"open\",\"amount\":7}')",
          );
          const configured = configureObjectPerformance(
            db,
            "summary-race",
            "items",
            {
              version: 1,
              performance: {
                indexes: [],
                summaries: [{ group: "stage", amountField: "amount" }],
              },
            },
          ).then((result) => {
            settled = true;
            return result;
          });
          await lockAttempted;
          expect(settled).toBe(false);
          await writer.query("COMMIT");
          await expect(configured).resolves.toMatchObject({
            config: {
              performance: {
                summaries: [{ group: "stage", amountField: "amount" }],
              },
            },
          });
          expect(
            await getMaintainedSummary(
              db,
              "summary-race",
              "items",
              "stage",
              "amount",
            ),
          ).toEqual([{ value: "open", count: 1, amount: 7 }]);
        } finally {
          spy.mockRestore();
          await writer.query("ROLLBACK").catch(() => {});
          writer.release();
        }
      });
    }, 180_000);
  },
);
