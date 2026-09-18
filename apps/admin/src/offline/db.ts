import Dexie, { type Table } from "dexie";

export interface QueryCacheRow {
  key: string;
  value: string;
  updatedAt: number;
}

export type OutboxStatus = "pending" | "failed";

export interface OutboxOp {
  id?: number;
  /** Eligible resource, e.g. "user-preferences". Never identity. */
  resource: string;
  /** Stable action key, e.g. "save-appearance". */
  action: string;
  payload: unknown;
  queuedAt: number;
  status: OutboxStatus;
  error?: string;
}

/**
 * Single IndexedDB database for offline support. Version 2 adds the
 * mutation outbox next to the query cache.
 */
export class SaviaOfflineDb extends Dexie {
  queryCache!: Table<QueryCacheRow, string>;
  outbox!: Table<OutboxOp, number>;

  constructor() {
    super("savia-offline");
    this.version(1).stores({ queryCache: "key, updatedAt" });
    this.version(2).stores({ outbox: "++id, status, queuedAt" });
  }
}

let sharedDb: SaviaOfflineDb | undefined;

export function getOfflineDb(): SaviaOfflineDb {
  sharedDb ??= new SaviaOfflineDb();
  return sharedDb;
}
