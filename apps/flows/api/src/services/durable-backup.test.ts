import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../context";
import {
  assertPausedMaintenance,
  exportSqlPage,
  restoreSqlPage,
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
