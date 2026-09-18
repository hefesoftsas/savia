import Dexie, { type Table } from "dexie";

export interface QueryCacheRow {
  key: string;
  value: string;
  updatedAt: number;
}

/**
 * Single IndexedDB database for offline support. Version 1 only holds the
 * persisted TanStack Query cache; future versions can add an outbox table
 * for queued mutations without a second database.
 */
export class SaviaOfflineDb extends Dexie {
  queryCache!: Table<QueryCacheRow, string>;

  constructor() {
    super("savia-offline");
    this.version(1).stores({ queryCache: "key, updatedAt" });
  }
}

let sharedDb: SaviaOfflineDb | undefined;

export function getOfflineDb(): SaviaOfflineDb {
  sharedDb ??= new SaviaOfflineDb();
  return sharedDb;
}
