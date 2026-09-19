import requestApp from "../../savia-request/src/server/index";
import { openPostgresDatabase } from "../src/postgres/database";
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { registerDialect } from "@savia/db/dialect";
import { postgresDialect } from "@savia/db/postgres-dialect";
import { makeConfig } from "../../../packages/crm-shared/src/metadata";
import { createObject } from "@savia/crm-server/schema";
import {
  createRecord,
  deleteRecord,
  getRecord,
} from "@savia/crm-server/services";
import { WorkflowRepository } from "@savia/crm-server/workflows/repository";
import { processWorkflows } from "@savia/crm-server/workflows/runtime";
import { migratePostgres } from "../src/postgres/migrations";
import { postgresTestUrl, withPostgresFixture } from "./postgres-fixture";

async function nativeFixture(run: (db: D1Database) => Promise<void>) {
  await withPostgresFixture(async (db, connectionString) => {
    registerDialect(db, postgresDialect);
    await migratePostgres({
      connectionString,
      schema: "savia_core",
      directory: resolve("../../packages/db/postgres"),
      seed: false,
    });
    await run(db as unknown as D1Database);
  });
}

(postgresTestUrl ? describe : describe.skip)(
  "native PostgreSQL workflow and relation release contracts",
  () => {
    it("persists published workflow versions, typed queries, jobs and idempotent executions", async () => {
      await nativeFixture(async (db) => {
        const tenant = "workflow-native",
          owner = "owner-native";
        await createObject(db, tenant, {
          name: "requests",
          label: "Requests",
          config: makeConfig({
            name: { type: "Textbox", label: "Name" },
            amount: { type: "Number", label: "Amount" },
            active: { type: "Toggle", label: "Active" },
          }),
        });
        const numeric = await createRecord(db, tenant, "requests", {
          name: "Numeric",
          amount: 2,
          active: true,
        });
        await createRecord(db, tenant, "requests", {
          name: "Other",
          amount: 10,
          active: false,
        });
        // Imported legacy payloads can contain mixed scalar types: SQL query matching
        // must retain JSON numeric-vs-text semantics instead of comparing text casts.
        await db
          .prepare(
            "INSERT INTO crm_records(id,tenant_id,object_name,data) VALUES (?,?,?,?)",
          )
          .bind(
            "legacy-text",
            tenant,
            "requests",
            JSON.stringify({ name: "Text", amount: "2", active: "1" }),
          )
          .run();
        const repo = new WorkflowRepository(db, tenant);
        const draft = await repo.create(
          {
            name: "Typed query",
            definition: {
              trigger: { type: "manual", collection: "requests" },
              nodes: [
                {
                  id: "numbers",
                  type: "query",
                  collection: "requests",
                  field: "amount",
                  value: 2,
                  limit: 20,
                  next: "flags",
                },
                {
                  id: "flags",
                  type: "query",
                  collection: "requests",
                  field: "active",
                  value: true,
                  limit: 20,
                  next: "create",
                },
                {
                  id: "create",
                  type: "create",
                  collection: "requests",
                  values: { name: "Workflow output", amount: 3, active: false },
                },
              ],
            },
          },
          owner,
        );
        await repo.publish(draft.id, draft.revision, owner);
        const execution = await repo.start(draft.id, {}, owner, "same-request");
        expect((await repo.start(draft.id, {}, owner, "same-request")).id).toBe(
          execution.id,
        );
        await processWorkflows(db, async () => true);
        // Read from a new repository instance to verify durable storage boundaries.
        const persisted = await new WorkflowRepository(db, tenant).execution(
          execution.id,
        );
        expect(persisted.status, JSON.stringify(persisted)).toBe("completed");
        expect(persisted.jobs.map((job) => job.node_id)).toEqual([
          "numbers",
          "flags",
          "create",
        ]);
        for (const job of persisted.jobs.slice(0, 2))
          expect(job.output).toMatchObject({
            count: 1,
            records: [{ id: numeric.id }],
          });
        const output = persisted.jobs[2].output as { id: string };
        expect(
          await getRecord(db, tenant, "requests", output.id),
        ).toMatchObject({ name: "Workflow output", created_by: owner });
        await processWorkflows(db, async () => true);
        expect((await repo.execution(execution.id)).jobs).toHaveLength(3);
        expect(
          await db
            .prepare(
              "SELECT count(*) AS n FROM crm_records WHERE tenant_id=? AND object_name=?",
            )
            .bind(tenant, "requests")
            .first("n"),
        ).toBe(4);
      });
    }, 180_000);

    it("clears scalar and array relations once, rebuilding unique values and preserving surviving links", async () => {
      await nativeFixture(async (db) => {
        const tenant = "relations-native";
        await createObject(db, tenant, {
          name: "targets",
          label: "Targets",
          config: makeConfig({ name: { type: "Textbox", label: "Name" } }),
        });
        await createObject(db, tenant, {
          name: "sources",
          label: "Sources",
          config: makeConfig({
            name: { type: "Textbox", label: "Name", config: { unique: true } },
            primary: {
              type: "Dropdown",
              label: "Primary",
              config: { relation: "targets", onDelete: "clear", unique: true },
            },
            many: {
              type: "Dropdown",
              label: "Many",
              config: {
                relation: "targets",
                onDelete: "clear",
                multiple: true,
              },
            },
          }),
        });
        const removed = await createRecord(db, tenant, "targets", {
          name: "Removed",
        });
        const kept = await createRecord(db, tenant, "targets", {
          name: "Kept",
        });
        const source = await createRecord(db, tenant, "sources", {
          name: "Source",
          primary: removed.id,
          many: [removed.id, kept.id],
        });
        await deleteRecord(db, tenant, "targets", removed.id, { version: 1 });
        expect(await getRecord(db, tenant, "sources", source.id)).toMatchObject(
          { primary: null, many: [kept.id], _version: 2 },
        );
        expect(
          (
            await db
              .prepare(
                "SELECT field_name,value FROM crm_unique_values WHERE record_id=?",
              )
              .bind(source.id)
              .all()
          ).results,
        ).toEqual([{ field_name: "name", value: "source" }]);
        expect(
          await db
            .prepare(
              "SELECT count(*) AS n FROM crm_audit WHERE record_id=? AND action='relation.cleared'",
            )
            .bind(source.id)
            .first("n"),
        ).toBe(1);
        expect(
          await db
            .prepare("SELECT count(*) AS n FROM crm_write_guards")
            .first("n"),
        ).toBe(0);
        expect(await getRecord(db, tenant, "targets", kept.id)).toMatchObject({
          name: "Kept",
          _version: 1,
        });
      });
    }, 180_000);
  },
);

(postgresTestUrl ? describe : describe.skip)(
  "native PostgreSQL request HTTP contracts",
  () => {
    it("lists and soft-deletes requests without resurrection on later seeding", async () => {
      await withPostgresFixture(async (_core, connectionString) => {
        await migratePostgres({
          connectionString,
          schema: "savia_request",
          directory: resolve("../savia-request/postgres"),
          seed: false,
        });
        const db = openPostgresDatabase({
          connectionString,
          schema: "savia_request",
          maxConnections: 2,
        });
        registerDialect(db, postgresDialect);
        try {
          const request = (path: string, method = "GET") =>
            requestApp.request(
              "http://savia-request.internal/api" + path,
              { method, headers: { "content-type": "application/json" } },
              {
                DB: db as unknown as D1Database,
                ENCRYPTION_KEY: "native-contract-key",
              },
            );
          const first = await request("/flows");
          expect(first.status).toBe(200);
          const before = (await first.json()) as { id: string; name: string }[];
          expect(before.length).toBeGreaterThan(1);
          const target = before[0];
          expect((await request(`/flows/${target.id}`)).status).toBe(200);
          expect((await request(`/flows/${target.id}`, "DELETE")).status).toBe(
            200,
          );
          const afterResponse = await request("/flows");
          expect(afterResponse.status).toBe(200);
          const after = (await afterResponse.json()) as { id: string }[];
          expect(after).toHaveLength(before.length - 1);
          expect(after.some((row) => row.id === target.id)).toBe(false);
          const definition = await db
            .prepare("SELECT definition FROM flows WHERE id=?")
            .bind(target.id)
            .first<string>("definition");
          expect(JSON.parse(definition!)).toMatchObject({
            id: target.id,
            name: target.name,
            deleted: true,
          });
          expect((await request(`/flows/${target.id}`)).status).toBe(404);
          expect((await request(`/flows/${target.id}`, "DELETE")).status).toBe(
            404,
          );
        } finally {
          await db.close();
        }
      });
    }, 180_000);
  },
);
