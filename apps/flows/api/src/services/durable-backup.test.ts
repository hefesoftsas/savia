import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../context";
import {
  assertPausedMaintenance,
  exportWorkflowBackupPage,
  exportSqlPage,
  restoreWorkflowBackupPage,
  restoreSqlPage,
  type WorkflowBackupCursor,
  type WorkflowBackupPage,
  type SqlBackupPage,
} from "./durable-backup";
const bindings = env as Bindings;
const fresh = () =>
  bindings.MAILBOX.get(
    bindings.MAILBOX.idFromName(`backup-${crypto.randomUUID()}`),
  );

describe("Durable Object backup", () => {
  it("requires both paused execution and maintenance", () => {
    for (const policy of [
      {},
      { SAVIA_FLOWS_EXECUTION_ENABLED: "false" },
      {
        SAVIA_FLOWS_EXECUTION_ENABLED: "true",
        SAVIA_FLOWS_MAINTENANCE: "true",
      },
    ])
      expect(() => assertPausedMaintenance(policy)).toThrow("paused");
    expect(() =>
      assertPausedMaintenance({
        SAVIA_FLOWS_EXECUTION_ENABLED: "false",
        SAVIA_FLOWS_MAINTENANCE: "true",
      }),
    ).not.toThrow();
  });

  it("round trips paginated rows, blobs, indexes and triggers in real SQLite", async () => {
    const pages = await runInDurableObject(fresh(), (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec(
        "CREATE TABLE records (id INTEGER PRIMARY KEY, label TEXT, data BLOB, score REAL)",
      );
      sql.exec("CREATE TABLE audit (id INTEGER)");
      sql.exec("CREATE INDEX records_label ON records(label)");
      sql.exec(
        "CREATE TRIGGER records_audit AFTER INSERT ON records BEGIN INSERT INTO audit VALUES (new.id); END",
      );
      for (let id = 0; id < 300; id++)
        sql.exec(
          "INSERT INTO records VALUES (?,?,?,?)",
          id,
          `O'Reilly ${id}`,
          new Uint8Array([id % 256, 0, 255]).buffer,
          id / 3,
        );
      const result: SqlBackupPage[] = [];
      let page = exportSqlPage(sql);
      result.push(page);
      while (page.next) {
        page = exportSqlPage(sql, page.next);
        result.push(page);
      }
      return result;
    });
    expect(pages.length).toBeGreaterThan(4);
    await runInDurableObject(fresh(), (_instance, state) => {
      for (let i = 0; i < pages.length; i++)
        restoreSqlPage(
          state.storage,
          {
            ...pages[i],
            ...(i === pages.length - 1 ? { schema: pages[0].schema } : {}),
          },
          i === 0,
          i === pages.length - 1,
        );
      expect(
        state.storage.sql.exec("SELECT count(*) AS n FROM records").one().n,
      ).toBe(300);
      expect(
        state.storage.sql.exec("SELECT count(*) AS n FROM audit").one().n,
      ).toBe(300);
      const row = state.storage.sql
        .exec("SELECT label,hex(data) AS data,score FROM records WHERE id=5")
        .one();
      expect(row.label).toBe("O'Reilly 5");
      expect(row.data).toBe("0500FF");
      expect(row.score).toBe(5 / 3);
      state.storage.sql.exec(
        "INSERT INTO records VALUES (301,'new',NULL,NULL)",
      );
      expect(
        state.storage.sql.exec("SELECT count(*) AS n FROM audit").one().n,
      ).toBe(301);
      expect(() =>
        restoreSqlPage(state.storage, pages[0], true, false),
      ).toThrow("empty");
    });
  });

  it("round trips WorkflowAgent SQLite and typed KV pages in a real DO", async () => {
    const workflowAgent = bindings.WORKFLOW_AGENT.get(
      bindings.WORKFLOW_AGENT.idFromName(
        `backup-workflow-${crypto.randomUUID()}`,
      ),
    );
    const pages = await runInDurableObject(
      workflowAgent,
      async (_instance, state) => {
        state.storage.sql.exec(
          "CREATE TABLE gen_runs (id TEXT PRIMARY KEY, payload TEXT)",
        );
        state.storage.sql.exec(
          "INSERT INTO gen_runs VALUES (?, ?)",
          "run-1",
          "persisted generation state",
        );
        await state.storage.put("execbuf:run-1", {
          startedAt: 123,
          result: new Uint8Array([0, 7, 255]),
        });
        await state.storage.put("form:token-1:schema", { fields: ["name"] });
        await state.storage.put(
          "fform:token-1:config",
          new Map([["enabled", true]]),
        );
        for (let index = 0; index < 135; index++)
          await state.storage.put(
            `form:bulk:${index.toString().padStart(3, "0")}`,
            {
              index,
            },
          );
        // The prior WorkflowAgent SQL-only exporter omitted these durable keys.
        expect(JSON.stringify(exportSqlPage(state.storage.sql))).not.toContain(
          "execbuf:run-1",
        );
        const result: WorkflowBackupPage[] = [];
        let cursor: WorkflowBackupCursor | undefined;
        for (;;) {
          const page = await exportWorkflowBackupPage(state.storage, cursor);
          result.push(page);
          if (!page.next) break;
          cursor = page.next;
        }
        return result;
      },
    );
    const sqlPages = pages.filter((page) => page.storage === "sql");
    const kvPages = pages.filter((page) => page.storage === "kv");
    expect(sqlPages.length).toBeGreaterThan(1);
    expect(kvPages.length).toBeGreaterThan(1);
    expect(
      kvPages.every(
        (page) => page.storage === "kv" && page.data.entries.length <= 128,
      ),
    ).toBe(true);
    expect(
      kvPages.some(
        (page) =>
          page.storage === "kv" &&
          page.data.entries.some((entry) => entry.key === "__ps_name"),
      ),
    ).toBe(false);
    expect(pages.at(-1)?.storage).toBe("kv");
    expect(
      pages.slice(0, sqlPages.length).every((page) => page.storage === "sql"),
    ).toBe(true);
    const finalSql = sqlPages.at(-1)!;
    expect(finalSql.segmentLast).toBe(true);
    expect(finalSql.next).toEqual({ storage: "kv", page: 0 });
    expect(kvPages[0].segmentFirst).toBe(true);
    expect(pages.at(-1)?.segmentLast).toBe(true);
    expect(kvPages.map((page) => page.segmentPage)).toEqual([0, 1]);

    const target = bindings.WORKFLOW_AGENT.get(
      bindings.WORKFLOW_AGENT.idFromName(
        `restore-workflow-${crypto.randomUUID()}`,
      ),
    );
    await runInDurableObject(target, async (_instance, state) => {
      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        if (page.storage === "sql" && page.segmentLast) {
          const firstSqlPage = pages.find(
            (candidate) => candidate.storage === "sql",
          )!;
          page.data.schema = firstSqlPage.data.schema;
          page.data.sqliteSequence = firstSqlPage.data.sqliteSequence;
        }
        restoreWorkflowBackupPage(state.storage, page, {
          snapshotId: "workflow-snapshot",
          page: index,
          sha256: (index ? "b" : "a").repeat(64),
        });
      }
      expect(
        state.storage.sql
          .exec("SELECT payload FROM gen_runs WHERE id=?", "run-1")
          .one().payload,
      ).toBe("persisted generation state");
      expect(await state.storage.get("execbuf:run-1")).toEqual({
        startedAt: 123,
        result: new Uint8Array([0, 7, 255]),
      });
      expect(await state.storage.get("form:token-1:schema")).toEqual({
        fields: ["name"],
      });
      expect(await state.storage.get("fform:token-1:config")).toEqual(
        new Map([["enabled", true]]),
      );
      expect(() =>
        restoreWorkflowBackupPage(state.storage, pages[0], {
          snapshotId: "workflow-snapshot",
          page: 0,
          sha256: "a".repeat(64),
        }),
      ).not.toThrow();
    });
  });

  it("keeps mixed restore ordered and idempotent across the SQLite to KV transition", async () => {
    const source = await runInDurableObject(
      fresh(),
      async (_instance, state) => {
        state.storage.sql.exec("CREATE TABLE records (id INTEGER PRIMARY KEY)");
        state.storage.sql.exec("INSERT INTO records VALUES (1)");
        await state.storage.put("form:one", { ok: true });
        const sql = await exportWorkflowBackupPage(state.storage);
        const kv = await exportWorkflowBackupPage(state.storage, sql.next!);
        return [sql, kv] as const;
      },
    );
    const target = fresh();
    const checkpoint = (page: number, hash: string) => ({
      snapshotId: "ordered-workflow-snapshot",
      page,
      sha256: hash.repeat(64),
    });
    await runInDurableObject(target, (_instance, state) => {
      expect(() =>
        restoreWorkflowBackupPage(state.storage, source[1], checkpoint(1, "b")),
      ).toThrow("order");
      restoreWorkflowBackupPage(state.storage, source[0], checkpoint(0, "a"));
      expect(() =>
        restoreWorkflowBackupPage(state.storage, source[0], checkpoint(0, "a")),
      ).not.toThrow();
      restoreWorkflowBackupPage(state.storage, source[1], checkpoint(1, "b"));
      expect(() =>
        restoreWorkflowBackupPage(state.storage, source[0], checkpoint(2, "c")),
      ).toThrow("KV");
    });
  });

  it("does not change foreign-key mode when replaying completed first SQL pages", () => {
    const checkpoint = {
      snapshotId: "completed-snapshot",
      page: 0,
      sha256: "c".repeat(64),
    };
    const statements: string[] = [];
    const sql = {
      exec(statement: string) {
        statements.push(statement);
        return {
          toArray: () =>
            statement.includes("sqlite_master")
              ? [{ present: 1 }]
              : [{ sha256: checkpoint.sha256 }],
        };
      },
    };
    const storage = {
      sql,
      transactionSync: (operation: () => unknown) => operation(),
      kv: { list: () => [] },
    } as unknown as Parameters<typeof restoreSqlPage>[0];
    const sqlPage: SqlBackupPage = {
      version: 1,
      rows: [],
      next: { table: 0, offset: 1 },
    };
    restoreSqlPage(storage, sqlPage, true, false, checkpoint);
    expect(statements).not.toContain("PRAGMA foreign_keys = OFF");

    statements.length = 0;
    const workflowPage: WorkflowBackupPage = {
      version: 1,
      storage: "sql",
      segmentPage: 0,
      segmentFirst: true,
      segmentLast: false,
      data: sqlPage,
      next: {
        storage: "sql",
        page: 1,
        cursor: sqlPage.next!,
      },
    };
    restoreWorkflowBackupPage(storage, workflowPage, checkpoint);
    expect(statements).not.toContain("PRAGMA foreign_keys = OFF");
  });

  it("includes application names that only resemble SQLite or Cloudflare tables", async () => {
    await runInDurableObject(fresh(), (_instance, state) => {
      state.storage.sql.exec("CREATE TABLE sqlitexdata (id INTEGER)");
      state.storage.sql.exec("CREATE TABLE XcfYapp (id INTEGER)");
      const page = exportSqlPage(state.storage.sql);
      expect(page.schema?.map(({ name }) => name)).toEqual(
        expect.arrayContaining(["sqlitexdata", "XcfYapp"]),
      );
    });
  });

  it("resumes interrupted page restores and rejects changed or out-of-order replays", async () => {
    const sourcePages = await runInDurableObject(
      fresh(),
      (_instance, state) => {
        state.storage.sql.exec("CREATE TABLE rows (id INTEGER PRIMARY KEY)");
        for (let id = 0; id < 260; id++)
          state.storage.sql.exec("INSERT INTO rows VALUES (?)", id);
        const result: SqlBackupPage[] = [];
        let page = exportSqlPage(state.storage.sql);
        result.push(page);
        while (page.next) {
          page = exportSqlPage(state.storage.sql, page.next);
          result.push(page);
        }
        return result;
      },
    );
    const target = fresh();
    const marker = (page: number) => ({
      snapshotId: "snapshot-1",
      page,
      sha256: "a".repeat(64),
    });
    await runInDurableObject(target, (_instance, state) => {
      restoreSqlPage(state.storage, sourcePages[0], true, false, marker(0));
      expect(() =>
        restoreSqlPage(state.storage, sourcePages[2], false, false, marker(2)),
      ).toThrow("order");
      expect(() =>
        restoreSqlPage(state.storage, sourcePages[0], true, false, {
          ...marker(0),
          sha256: "b".repeat(64),
        }),
      ).toThrow("checksum");
    });
    // Simulate a fresh client restarting after losing the response to page zero.
    await runInDurableObject(target, (_instance, state) => {
      for (let i = 0; i < sourcePages.length; i++)
        restoreSqlPage(
          state.storage,
          {
            ...sourcePages[i],
            ...(i === sourcePages.length - 1
              ? { schema: sourcePages[0].schema }
              : {}),
          },
          i === 0,
          i === sourcePages.length - 1,
          marker(i),
        );
      expect(
        state.storage.sql.exec("SELECT count(*) AS n FROM rows").one().n,
      ).toBe(260);
      const exported = exportSqlPage(state.storage.sql);
      expect(
        exported.schema?.some(
          (entry) => entry.name === "__savia_backup_restore",
        ),
      ).toBe(false);
    });
  });

  it("refuses oversized rows and invalid cursors instead of truncating", async () => {
    await runInDurableObject(fresh(), (_instance, state) => {
      state.storage.sql.exec("CREATE TABLE records (data TEXT)");
      state.storage.sql.exec(
        "INSERT INTO records VALUES (?)",
        "a".repeat(600000),
      );
      expect(() => exportSqlPage(state.storage.sql)).toThrow("page limit");
      expect(() =>
        exportSqlPage(state.storage.sql, { table: -1, offset: 0 }),
      ).toThrow("cursor");
    });
  });

  it("bounds schema pages by encoded bytes for non-ASCII SQL", async () => {
    await runInDurableObject(fresh(), (_instance, state) => {
      for (let id = 0; id < 18; id++)
        state.storage.sql.exec(
          `CREATE TABLE records_${id} (data TEXT /* ${"\u00e9".repeat(15000)} */)`,
        );
      expect(() => exportSqlPage(state.storage.sql)).toThrow("page limit");
    });
  });
});
