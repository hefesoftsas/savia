import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Persister } from "@tanstack/react-query-persist-client";
import { getOfflineDb, type QueryCacheRow } from "./db";

/**
 * Minimal key-value table surface. Dexie's Table satisfies it, and unit
 * tests can stub it with a Map (Dexie's extended promises are intentionally
 * not part of this contract).
 */
export interface QueryCacheTable {
  get(key: string): Promise<QueryCacheRow | undefined>;
  put(row: QueryCacheRow): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

export interface StringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * AsyncStorage adapter over the Dexie query-cache table. Accepts an
 * injectable table so unit tests can use an in-memory stub instead of
 * IndexedDB (unavailable in jsdom).
 */
export function createDexieStorage(table?: QueryCacheTable): StringStorage {
  const store = table ?? getOfflineDb().queryCache;
  return {
    getItem: async (key: string) => (await store.get(key))?.value ?? null,
    setItem: async (key: string, value: string) => {
      await store.put({ key, value, updatedAt: Date.now() });
    },
    removeItem: async (key: string) => {
      await store.delete(key);
    },
  };
}

function createMemoryStorage(): StringStorage {
  const entries = new Map<string, string>();
  return {
    getItem: async (key: string) => entries.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: async (key: string) => {
      entries.delete(key);
    },
  };
}

/**
 * Persister for the TanStack Query cache. Uses Dexie/IndexedDB in browsers
 * and falls back to memory where IndexedDB is unavailable (tests, SSR), so
 * mounting the provider never crashes outside a real browser.
 */
export function createOfflinePersister(table?: QueryCacheTable): Persister {
  if (table) {
    return createAsyncStoragePersister({
      key: "savia-query-cache",
      storage: createDexieStorage(table),
    });
  }
  const storage =
    typeof indexedDB === "undefined"
      ? createMemoryStorage()
      : createDexieStorage();
  return createAsyncStoragePersister({
    key: "savia-query-cache",
    storage,
  });
}
