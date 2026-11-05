import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migratePostgres } from "../src/postgres/migrations.js";
import { withPostgresFixture } from "./postgres-fixture.js";

const migrationPath = fileURLToPath(
  new URL(
    "../../../packages/db/postgres/0062_realtime_event_outbox.sql",
    import.meta.url,
  ),
);

describe.skipIf(!process.env.SAVIA_TEST_POSTGRES_URL)(
  "PostgreSQL realtime outbox",
  () => {
    it("captures mutations transactionally with the owning principal", async () => {
      await withPostgresFixture(async (db, connectionString) => {
        const directory = await mkdtemp(join(tmpdir(), "savia-pg-outbox-"));
        try {
          await db.batch([
            db.prepare(
              `CREATE TABLE assistant_threads (
                 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL,
                 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                 messages TEXT NOT NULL, revision BIGINT NOT NULL
               )`,
            ),
            db.prepare(
              "CREATE TABLE request_page_runs (id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, status TEXT NOT NULL, page_name TEXT NOT NULL)",
            ),
          ]);
          await writeFile(
            join(directory, "0062_realtime_event_outbox.sql"),
            await readFile(migrationPath, "utf8"),
          );
          await migratePostgres({
            connectionString,
            schema: "savia_core",
            directory,
            seed: false,
          });
          const timestamp = "2026-10-30T00:00:00.000Z";

          const insertThread = (id: string) =>
            db
              .prepare(
                `INSERT INTO assistant_threads
               (id, user_id, title, created_at, updated_at, messages, revision)
               VALUES (?, 'outbox-owner-a', 'Test', ?, ?, '[]', 1)`,
              )
              .bind(id, timestamp, timestamp);
          const rollbackThread = "outbox-rolled-back-thread";
          await expect(
            db.batch([
              insertThread(rollbackThread),
              db.prepare("SELECT missing_outbox_column"),
            ]),
          ).rejects.toThrow();
          expect(
            await db
              .prepare(
                "SELECT count(*) AS count FROM realtime_event_outbox WHERE resource_id = ?",
              )
              .bind(rollbackThread)
              .first("count"),
          ).toBe(0);

          const threadId = "outbox-thread";
          await insertThread(threadId).run();
          await db
            .prepare(
              "UPDATE assistant_threads SET revision = 2, updated_at = ? WHERE id = ?",
            )
            .bind(timestamp, threadId)
            .run();
          await db
            .prepare("DELETE FROM assistant_threads WHERE id = ?")
            .bind(threadId)
            .run();

          await db
            .prepare(
              `INSERT INTO request_page_runs (id, principal_id, page_name, status)
             VALUES ('outbox-run', 'outbox-owner-b', 'request-page', 'running')`,
            )
            .run();
          await db
            .prepare(
              "UPDATE request_page_runs SET status = 'complete' WHERE id = 'outbox-run'",
            )
            .run();

          const events = (
            await db
              .prepare(
                `SELECT principal_id, topic, type, collection, resource_id
               FROM realtime_event_outbox ORDER BY event_id`,
              )
              .all()
          ).results;
          expect(events).toEqual([
            {
              principal_id: "outbox-owner-a",
              topic: "assistant-threads",
              type: "created",
              collection: "threads",
              resource_id: threadId,
            },
            {
              principal_id: "outbox-owner-a",
              topic: "assistant-threads",
              type: "updated",
              collection: "threads",
              resource_id: threadId,
            },
            {
              principal_id: "outbox-owner-a",
              topic: "assistant-threads",
              type: "deleted",
              collection: "threads",
              resource_id: threadId,
            },
            {
              principal_id: "outbox-owner-b",
              topic: "request-pages",
              type: "updated",
              collection: "request-page",
              resource_id: "outbox-run",
            },
          ]);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
    }, 120_000);
  },
);
