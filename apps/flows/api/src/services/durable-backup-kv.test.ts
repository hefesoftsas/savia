import { describe, expect, it } from "vitest";
import { decodeKvValue, encodeKvValue, restoreKvPage } from "./durable-backup";

describe("Durable Object KV backup values", () => {
  it("preserves nested scalars and typed values through the JSON page representation", () => {
    const original = {
      count: 4,
      enabled: true,
      missing: undefined,
      created: new Date("2026-10-12T00:00:00.000Z"),
      bytes: new Uint8Array([1, 2, 255]),
      map: new Map([["key", 3n]]),
      set: new Set(["a", "b"]),
    };
    const restored = decodeKvValue(
      JSON.parse(JSON.stringify(encodeKvValue(original))),
    ) as typeof original;
    expect(restored.count).toBe(4);
    expect(restored.enabled).toBe(true);
    expect(restored.missing).toBeUndefined();
    expect(restored.created).toEqual(original.created);
    expect(restored.bytes).toBeInstanceOf(Uint8Array);
    expect([...new Uint8Array(restored.bytes)]).toEqual([1, 2, 255]);
    expect(restored.map.get("key")).toBe(3n);
    expect([...restored.set]).toEqual(["a", "b"]);
  });

  it("rolls back a failed KV page and permits an ordered retry", async () => {
    let values = new Map<string, unknown>();
    let failOnce = true;
    const makeTransaction = (working: Map<string, unknown>) => ({
      get: async <T>(key: string) => working.get(key) as T | undefined,
      list: async () => new Map(working),
      put: async (key: string, value: unknown) => {
        if (key === "second" && failOnce) {
          failOnce = false;
          throw new Error("injected put failure");
        }
        working.set(key, value);
      },
    });
    const storage = {
      transaction: async <T>(
        callback: (
          transaction: ReturnType<typeof makeTransaction>,
        ) => Promise<T>,
      ) => {
        const working = new Map(values);
        const result = await callback(makeTransaction(working));
        values = working;
        return result;
      },
    } as unknown as DurableObjectStorage;
    const page = {
      version: 1 as const,
      entries: [
        { key: "first", value: encodeKvValue({ count: 1 }) },
        { key: "second", value: encodeKvValue({ count: 2 }) },
      ],
      next: null,
    };
    const checkpoint = {
      snapshotId: "retry-smoke",
      page: 0,
      sha256: "a".repeat(64),
    };

    await expect(
      restoreKvPage(storage, page, true, checkpoint),
    ).rejects.toThrow("injected put failure");
    expect(values.size).toBe(0);

    await restoreKvPage(storage, page, true, checkpoint);
    expect(values.get("first")).toEqual({ count: 1 });
    expect(values.get("second")).toEqual({ count: 2 });
    expect(values.get("__savia_backup_restore")).toEqual({
      "retry-smoke:0": { page: 0, sha256: "a".repeat(64) },
    });

    await restoreKvPage(storage, page, true, checkpoint);
    expect(values.get("second")).toEqual({ count: 2 });
  });
});
