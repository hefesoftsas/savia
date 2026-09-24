import { dialectFor, inheritDialect } from "@savia/db/dialect";
import { inheritAccessPolicy } from "./access-authorization";

export type RecordHistoryActor = {
  kind: "user" | "workflow" | "public-form" | "system";
  id: string | null;
  causeId?: string;
};

const historySources = new WeakMap<D1Database, D1Database>();

/** Context exists only within the mutation transaction, never between requests. */
export function historyDatabase(
  db: D1Database,
  tenant: string,
  actor: RecordHistoryActor,
): D1Database {
  const source = db;
  db = historySources.get(db) ?? db;
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const knownStatements = new WeakSet<D1PreparedStatement>();
  const recordWrites = new WeakSet<D1PreparedStatement>();
  const batch = async <T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> => {
    const raw = statements.map(
      (statement) => originals.get(statement) ?? statement,
    );
    // Queries and unrelated settings writes need no history context or extra D1 writes.
    // Unknown statements remain conservative because checkpoints can come from another wrapper.
    if (
      statements.every(
        (statement) =>
          knownStatements.has(statement) && !recordWrites.has(statement),
      )
    )
      return db.batch<T>(raw);
    const result = await db.batch<T>([
      db
        .prepare(
          "INSERT INTO studio_record_history_context(tenant_id,actor_kind,actor_id,cause_id) VALUES (?,?,?,?)",
        )
        .bind(tenant, actor.kind, actor.id, actor.causeId ?? null),
      ...raw,
      db
        .prepare("DELETE FROM studio_record_history_context WHERE tenant_id=?")
        .bind(tenant),
    ]);
    return result.slice(1, -1);
  };
  const wrap = (
    statement: D1PreparedStatement,
    writes: boolean,
  ): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, key) {
        if (key === "bind")
          return (...args: unknown[]) => wrap(target.bind(...args), writes);
        if (writes && (key === "run" || key === "all"))
          return async () => (await batch([target]))[0];
        if (writes && key === "first")
          return async (column?: string) => {
            const row = (await batch<Record<string, unknown>>([target]))[0]
              .results[0];
            return column ? (row?.[column] ?? null) : (row ?? null);
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    originals.set(proxy, statement);
    knownStatements.add(proxy);
    knownStatements.add(statement);
    if (writes) {
      recordWrites.add(proxy);
      recordWrites.add(statement);
    }
    return proxy;
  };
  const wrapped = new Proxy(db, {
    get(target, key) {
      if (key === "batch") return batch;
      if (key === "prepare")
        return (sql: string) =>
          wrap(
            target.prepare(sql),
            !/^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*(?:SELECT|EXPLAIN)\b/i.test(
              sql,
            ) && /\bstudio_records\b/i.test(sql),
          );
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  inheritDialect(source, wrapped);
  const result = inheritAccessPolicy(source, wrapped);
  historySources.set(result, db);
  return result;
}

/** Bounded indexed cleanup; readers must also filter expires_at immediately. */
export async function purgeExpiredRecordHistory(db: D1Database, limit = 500) {
  const bounded = Math.min(
    500,
    Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : 500)),
  );
  return db
    .prepare(
      `DELETE FROM studio_record_history WHERE (tenant_id,object_name,record_id,version) IN (SELECT tenant_id,object_name,record_id,version FROM studio_record_history WHERE expires_at<=${dialectFor(db).utcNow()} ORDER BY expires_at LIMIT ?)`,
    )
    .bind(bounded)
    .run();
}

/** One indexed probe after cleanup exposes lag without counting the entire backlog. */
export async function maintainRecordHistory(db: D1Database, limit = 500) {
  const result = await purgeExpiredRecordHistory(db, limit);
  const row = await db
    .prepare(
      `SELECT expires_at FROM studio_record_history WHERE expires_at<=${dialectFor(db).utcNow()} ORDER BY expires_at LIMIT 1`,
    )
    .first<{ expires_at: string }>();
  return {
    deleted: result.meta.changes,
    oldestExpiredAt: row?.expires_at ?? null,
    lagSeconds: row
      ? Math.max(
          0,
          Math.floor((Date.now() - Date.parse(row.expires_at)) / 1000),
        )
      : 0,
  };
}
