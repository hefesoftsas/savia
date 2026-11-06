import { registerDialect } from "@savia/db/dialect";
import { postgresDialect } from "@savia/db/postgres-dialect";
import { historyDatabase } from "../../../packages/studio-server/src/record-history-storage";
import { createStudioApp } from "@savia/studio-server";
import { makeConfig } from "../../../packages/studio-shared/src/metadata";
import { resolve } from "node:path";
import { migratePostgres } from "../src/postgres/migrations";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";
import { describe, expect, it } from "vitest";

(postgresTestUrl ? describe : describe.skip)(
  "PostgreSQL screen deletion",
  () => {
    it("rejects stale scopes, rolls back failures and deletes only reviewed dependents", async () => {
      await withPostgresFixture(async (db, connectionString) => {
        registerDialect(db, postgresDialect);
        await migratePostgres({
          connectionString,
          schema: "savia_core",
          directory: resolve("../../packages/db/postgres"),
          seed: false,
        });
        const history = historyDatabase(db, "cascade-pg", {
          kind: "system",
          id: null,
        });
        const lockResults = await history.batch([
          history.prepare(
            "LOCK TABLE studio_records IN SHARE ROW EXCLUSIVE MODE",
          ),
          db.prepare("SELECT 7 AS marker"),
        ]);
        expect(lockResults).toHaveLength(2);
        expect(lockResults[1].results).toEqual([{ marker: 7 }]);
        const app = createStudioApp("cascade-pg");
        const request = async (path: string, method = "GET", data?: unknown) =>
          app.request(
            `http://localhost/api${path}`,
            {
              method,
              headers: {
                "content-type": "application/json",
                "X-Tenant-Id": "cascade-pg",
              },
              ...(data === undefined ? {} : { body: JSON.stringify(data) }),
            },
            { DB: db },
          );
        for (const [name, parent] of [
          ["parent", null],
          ["root", "parent"],
          ["child", "root"],
          ["leaf", "child"],
        ]) {
          const config = makeConfig({
            name: { type: "Textbox", label: "Name" },
            ...(parent
              ? {
                  parent: {
                    type: "Dropdown" as const,
                    label: "Parent",
                    config: { relation: parent },
                  },
                }
              : {}),
          });
          const response = await request("/objects", "POST", {
            name,
            label: name,
            config: {
              ...config,
              ...(name === "root"
                ? {
                    performance: {
                      indexes: [{ fields: ["name"], order: "ASC" }],
                      summaries: [{ group: "name" }],
                    },
                  }
                : {}),
            },
          });
          expect(response.status, await response.clone().text()).toBe(201);
        }
        const preview = async () => {
          const response = await request("/objects/root/deletion-preview");
          expect(response.status, await response.clone().text()).toBe(200);
          return ((await response.json()) as any).data;
        };
        const original = await preview();
        expect(
          original.screens.map((screen: any) => screen.name).sort(),
        ).toEqual(["child", "leaf", "root"]);
        expect(
          (
            await request("/records/root", "POST", {
              name: "Retained on rollback",
            })
          ).status,
        ).toBe(201);
        expect(
          (
            await request("/objects/root", "DELETE", {
              deleteRecords: true,
              deleteRelated: true,
              deletionToken: original.token,
            })
          ).status,
        ).toBe(409);
        const current = await preview();
        expect(current.totalRecords).toBe(1);
        await db.exec(
          "CREATE FUNCTION reject_cascade() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced rollback'; END $$",
        );
        await db.exec(
          "CREATE TRIGGER reject_cascade BEFORE DELETE ON studio_objects FOR EACH ROW EXECUTE FUNCTION reject_cascade()",
        );
        const failed = await request("/objects/root", "DELETE", {
          deleteRecords: true,
          deleteRelated: true,
          deletionToken: current.token,
        });
        expect(failed.status).toBeGreaterThanOrEqual(400);
        expect((await preview()).totalRecords).toBe(1);
        expect(
          (
            await db
              .prepare("SELECT count(*) AS count FROM studio_objects")
              .first<any>()
          )?.count,
        ).toBe(4);
        await db.exec("DROP TRIGGER reject_cascade ON studio_objects");
        await db.exec("DROP FUNCTION reject_cascade()");
        const removed = await request("/objects/root", "DELETE", {
          deleteRecords: true,
          deleteRelated: true,
          deletionToken: current.token,
        });
        expect(removed.status, await removed.clone().text()).toBe(200);
        const result = (await removed.json()) as any;
        expect(result.data.deletedObjects.sort()).toEqual([
          "child",
          "leaf",
          "root",
        ]);
        expect(result.data.deletedRecords).toBe(1);
        expect(
          (
            await db
              .prepare(
                "SELECT count(*) AS count FROM pg_indexes WHERE schemaname='savia_core' AND indexname LIKE 'studio_perf_%'",
              )
              .first<any>()
          )?.count,
        ).toBe(0);
        for (const table of [
          "studio_record_counts",
          "studio_record_history",
          "studio_record_summary_definitions",
          "studio_record_summary_groups",
        ]) {
          expect(
            (
              await db
                .prepare(
                  `SELECT count(*) AS count FROM ${table} WHERE tenant_id=? AND object_name IN ('root','child','leaf')`,
                )
                .bind("cascade-pg")
                .first<any>()
            )?.count,
            table,
          ).toBe(0);
        }
        expect(
          (
            await db
              .prepare("SELECT count(*) AS count FROM studio_write_guards")
              .first<any>()
          )?.count,
        ).toBe(0);

        expect(
          (await db.prepare("SELECT name FROM studio_objects").all<any>())
            .results,
        ).toEqual([{ name: "parent" }]);
        expect(
          (
            await db
              .prepare("SELECT count(*) AS count FROM studio_records")
              .first<any>()
          )?.count,
        ).toBe(0);
      });
    }, 60_000);
  },
);
