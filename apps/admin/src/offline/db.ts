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

export interface CollectionVersionRow {
  /** `${tenantKey}:${collection}`, e.g. `tenant:101:quotes`. */
  key: string;
  version: number;
  updatedAt: number;
}

/**
 * Single IndexedDB database for offline support. Version 3 adds the
 * per-collection version map used by delta sync.
 */
export class SaviaOfflineDb extends Dexie {
  queryCache!: Table<QueryCacheRow, string>;
  outbox!: Table<OutboxOp, number>;
  collectionVersions!: Table<CollectionVersionRow, string>;

  constructor() {
    super("savia-offline");
    this.version(1).stores({ queryCache: "key, updatedAt" });
    this.version(2).stores({ outbox: "++id, status, queuedAt" });
    this.version(3).stores({ collectionVersions: "key" });
  }
}

let sharedDb: SaviaOfflineDb | undefined;

export function getOfflineDb(): SaviaOfflineDb {
  sharedDb ??= new SaviaOfflineDb();
  return sharedDb;
}
