import { QueryClient, dehydrate, hydrate } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { QueryCacheRow } from "./db";
import { shouldPersistQueryKey } from "./persisted-keys";
import {
  PII_COLLECTION_MAX_AGE_MS,
  createDexieStorage,
  createOfflinePersister,
} from "./query-persister";

function stubTable() {
  const rows = new Map<string, QueryCacheRow>();
  return {
    rows,
    get: async (key: string) => rows.get(key),
    put: async (row: QueryCacheRow) => {
      rows.set(row.key, row);
    },
    delete: async (key: string) => {
      rows.delete(key);
    },
  };
}

describe("createDexieStorage", () => {
  it("round-trips entries through the table", async () => {
    const table = stubTable();
    const storage = createDexieStorage(table);

    expect(await storage.getItem("missing")).toBeNull();
    await storage.setItem("k", "v");
    expect(await storage.getItem("k")).toBe("v");
    expect(table.rows.get("k")?.updatedAt).toEqual(expect.any(Number));
    await storage.removeItem("k");
    expect(await storage.getItem("k")).toBeNull();
  });
});

describe("createOfflinePersister", () => {
  it("restores allowlisted queries and drops the rest", async () => {
    const persister = createOfflinePersister(stubTable());
    const source = new QueryClient();
    source.setQueryData(["users", "getList", {}], {
      data: [{ id: "p-1" }],
      total: 1,
    });
    source.setQueryData(["me"], { id: "p-1" });

    const dehydrated = dehydrate(source, {
      shouldDehydrateQuery: (query) => shouldPersistQueryKey(query.queryKey),
    });
    await persister.persistClient({
      clientState: dehydrated,
      timestamp: Date.now(),
      buster: "",
    });

    const restored = await persister.restoreClient();
    expect(restored).toBeDefined();
    const target = new QueryClient();
    hydrate(target, restored!.clientState);

    expect(target.getQueryData(["users", "getList", {}])).toEqual({
      data: [{ id: "p-1" }],
      total: 1,
    });
    expect(target.getQueryData(["me"])).toBeUndefined();
  });

  it("expires opted-in customer lists at restore time", async () => {
    const table = stubTable();
    const persister = createOfflinePersister(table);
    const oldEntry = (key: unknown, ageMs: number) => ({
      queryKey: key,
      queryHash: JSON.stringify(key),
      state: {
        data: { data: [] },
        dataUpdatedAt: Date.now() - ageMs,
      },
    });
    await persister.persistClient({
      clientState: {
        queries: [
          oldEntry(
            ["pipeline", "cotizaciones", {}],
            PII_COLLECTION_MAX_AGE_MS + 1000,
          ),
          oldEntry(["pipeline", "cotizaciones", {}], 1000),
          oldEntry(["users", "getList", {}], PII_COLLECTION_MAX_AGE_MS + 1000),
        ],
        mutations: [],
      },
      timestamp: Date.now(),
      buster: "",
    } as never);

    const restored = await persister.restoreClient();
    expect(restored).toBeDefined();
    const keys = restored!.clientState.queries.map((query) => query.queryKey);
    // Stale customer data is dropped; the fresh customer entry and the old
    // admin list (global maxAge) survive.
    expect(keys).toHaveLength(2);
    expect(keys).toContainEqual(["users", "getList", {}]);
    expect(keys).toContainEqual(["pipeline", "cotizaciones", {}]);
    const kept = restored!.clientState.queries.find(
      (query) =>
        Array.isArray(query.queryKey) && query.queryKey[0] === "pipeline",
    );
    expect(Date.now() - (kept?.state.dataUpdatedAt ?? 0)).toBeLessThan(
      PII_COLLECTION_MAX_AGE_MS,
    );
  });
});
