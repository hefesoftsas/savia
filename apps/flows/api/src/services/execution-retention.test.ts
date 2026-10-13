import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Bindings } from "../context";
import { maintainLocalExecutionHistory } from "./execution-retention";

const bindings = env as Bindings;
const localEnv = {
  DB: bindings.DB,
  SAVIA_FLOWS_LOCAL_ONLY: "true",
} as const;

async function insertExecution(
  id: string,
  status: string,
  updatedAt: number,
): Promise<void> {
  await bindings.DB.prepare(
    `INSERT INTO savia_local_executions
      (id, organization_id, workflow_id, status, started_at, created_at, updated_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`,
  )
    .bind(
      id,
      `org-${id}`,
      `workflow-${id}`,
      status,
      updatedAt,
      updatedAt,
      updatedAt,
    )
    .run();
}

async function rowCount(): Promise<number> {
  const row = await bindings.DB.prepare(
    "SELECT COUNT(*) AS count FROM savia_local_executions",
  ).first<{ count: number }>();
  return row?.count ?? 0;
}

describe("local execution history retention", () => {
  beforeEach(async () => {
    await bindings.DB.prepare(
      `CREATE TABLE IF NOT EXISTS savia_local_executions (
        id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (organization_id, id)
      )`,
    ).run();
    await bindings.DB.prepare(
      `CREATE INDEX IF NOT EXISTS savia_local_executions_retention_idx
       ON savia_local_executions (status, updated_at, organization_id, id)`,
    ).run();
    await bindings.DB.prepare(
      `CREATE TABLE IF NOT EXISTS savia_flows_execution_retention (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
        claimed_day TEXT,
        lease_until INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT,
        last_completed_day TEXT
      )`,
    ).run();
    await bindings.DB.prepare(
      "DROP TRIGGER IF EXISTS block_retention_delete",
    ).run();
    await bindings.DB.prepare("DELETE FROM savia_local_executions").run();
    await bindings.DB.prepare(
      "DELETE FROM savia_flows_execution_retention",
    ).run();
  });

  it("removes one bounded daily page of old terminal rows and preserves active or recent history", async () => {
    const now = Date.UTC(2026, 9, 13, 12);
    const old = now - 31 * 24 * 60 * 60 * 1000;
    const terminal = ["completed", "error", "cancelled", "exhausted"];
    for (const status of terminal) {
      for (let i = 0; i < 4; i++)
        await insertExecution(`${status}-${i}`, status, old + i);
    }
    await insertExecution("recent", "completed", now - 2 * 24 * 60 * 60 * 1000);
    for (const status of ["idle", "submitted", "executing", "paused"]) {
      await insertExecution(`active-${status}`, status, old);
    }

    const first = await maintainLocalExecutionHistory(localEnv, {
      now,
      dailyDeleteLimit: 5,
    });
    expect(first).toMatchObject({
      skipped: false,
      deleted: 5,
      day: "2026-10-13",
    });
    expect(await rowCount()).toBe(16);

    const second = await maintainLocalExecutionHistory(localEnv, {
      now: now + 60_000,
      dailyDeleteLimit: 5,
    });
    expect(second).toEqual({ skipped: "already-claimed" });
    expect(await rowCount()).toBe(16);

    const nextDay = await maintainLocalExecutionHistory(localEnv, {
      now: now + 24 * 60 * 60 * 1000,
      dailyDeleteLimit: 500,
    });
    expect(nextDay).toMatchObject({ skipped: false, deleted: 11 });
    expect(await rowCount()).toBe(5);
  });

  it("leaves a failed pass leased for five minutes, then retries it", async () => {
    const now = Date.UTC(2026, 9, 13, 12);
    await insertExecution(
      "old-completed",
      "completed",
      now - 31 * 24 * 60 * 60 * 1000,
    );
    await bindings.DB.prepare(
      `CREATE TRIGGER block_retention_delete
       BEFORE DELETE ON savia_local_executions
       BEGIN SELECT RAISE(ABORT, 'retention blocked'); END`,
    ).run();

    await expect(
      maintainLocalExecutionHistory(localEnv, { now }),
    ).rejects.toThrow();
    expect(
      await maintainLocalExecutionHistory(localEnv, {
        now: now + 4 * 60 * 1000,
      }),
    ).toEqual({ skipped: "already-claimed" });
    await bindings.DB.prepare("DROP TRIGGER block_retention_delete").run();

    const retry = await maintainLocalExecutionHistory(localEnv, {
      now: now + 6 * 60 * 1000,
    });
    expect(retry).toMatchObject({ skipped: false, deleted: 1 });
    expect(await rowCount()).toBe(0);
  });

  it("does nothing outside local-only mode or during maintenance", async () => {
    const now = Date.UTC(2026, 9, 13, 12);
    await insertExecution(
      "old-completed",
      "completed",
      now - 31 * 24 * 60 * 60 * 1000,
    );

    expect(
      await maintainLocalExecutionHistory(
        { ...localEnv, SAVIA_FLOWS_LOCAL_ONLY: "false" },
        { now },
      ),
    ).toEqual({ skipped: "not-local" });
    expect(
      await maintainLocalExecutionHistory(
        { ...localEnv, SAVIA_FLOWS_MAINTENANCE: "true" },
        { now },
      ),
    ).toEqual({ skipped: "maintenance" });
    expect(await rowCount()).toBe(1);
  });
});
