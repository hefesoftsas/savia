import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { PluginApi, PluginCollection } from "../src/index";
import { useRecord } from "../src/react";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("plugin React hooks", () => {
  it("clears old data and ignores an older response after collection changes", async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const staleRequest = deferred<{ id: string }>();
    const newRequest = deferred<{ id: string }>();
    let oldReads = 0;
    const oldCollection = {
      get: () =>
        ++oldReads === 1
          ? Promise.resolve({ id: "old" })
          : staleRequest.promise,
    } as unknown as PluginCollection<{ id: string }>;
    const newCollection = {
      get: () => newRequest.promise,
    } as unknown as PluginCollection<{ id: string }>;
    const savia = {
      collections: {
        collection: (name: string) =>
          name === "old" ? oldCollection : newCollection,
      },
    } as unknown as PluginApi;
    let current: ReturnType<typeof useRecord<{ id: string }>> | undefined;
    function Probe({ collectionName }: { collectionName: string }) {
      current = useRecord(savia, collectionName, "selected");
      return null;
    }
    const element = document.createElement("div");
    const root = createRoot(element);

    await act(async () => {
      root.render(createElement(Probe, { collectionName: "old" }));
    });
    expect(current?.data).toEqual({ id: "old" });
    await act(async () => {
      void current?.refresh();
    });

    await act(async () => {
      root.render(createElement(Probe, { collectionName: "new" }));
    });
    expect(current?.data).toBeNull();
    expect(current?.loading).toBe(true);
    await act(async () => {
      staleRequest.resolve({ id: "stale" });
      await staleRequest.promise;
    });
    expect(current?.data).toBeNull();
    await act(async () => {
      newRequest.resolve({ id: "new" });
      await newRequest.promise;
    });
    expect(current?.data).toEqual({ id: "new" });

    await act(async () => root.unmount());
  });
});
