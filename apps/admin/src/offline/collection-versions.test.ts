import { describe, expect, it } from "vitest";
import type { CollectionVersionRow } from "./db";
import {
  getCollectionVersion,
  isCoveredByVersion,
  setCollectionVersion,
  type VersionTable,
} from "./collection-versions";

function stubTable(): VersionTable & { rows: Map<string, CollectionVersionRow> } {
  const rows = new Map<string, CollectionVersionRow>();
  return {
    rows,
    get: async (key: string) => rows.get(key),
    put: async (row: CollectionVersionRow) => {
      rows.set(row.key, row);
    },
  };
}

describe("collection versions", () => {
  it("stores monotonic versions per collection", async () => {
    const table = stubTable();
    expect(await getCollectionVersion("tenant:101:quotes", table)).toBeUndefined();

    await setCollectionVersion("tenant:101:quotes", 4, table);
    expect(await getCollectionVersion("tenant:101:quotes", table)).toBe(4);

    // Never moves backwards.
    await setCollectionVersion("tenant:101:quotes", 2, table);
    expect(await getCollectionVersion("tenant:101:quotes", table)).toBe(4);

    // Other collections are independent.
    expect(await getCollectionVersion("tenant:101:clients", table)).toBeUndefined();
  });

  it("decides whether an event is already covered", () => {
    expect(isCoveredByVersion(4, 3)).toBe(true);
    expect(isCoveredByVersion(4, 4)).toBe(true);
    expect(isCoveredByVersion(4, 5)).toBe(false);
    expect(isCoveredByVersion(undefined, 5)).toBe(false);
    expect(isCoveredByVersion(4, undefined)).toBe(false);
  });

  it("treats missing storage as unknown, never throwing", async () => {
    const broken: VersionTable = {
      get: async () => {
        throw new Error("no indexeddb");
      },
      put: async () => {
        throw new Error("no indexeddb");
      },
    };
    expect(await getCollectionVersion("k", broken)).toBeUndefined();
    await expect(setCollectionVersion("k", 1, broken)).resolves.toBeUndefined();
  });
});
