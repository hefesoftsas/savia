import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllSaviaRequestSnapshots,
  clearSaviaRequestSnapshot,
  readSaviaRequestSnapshot,
  writeSaviaRequestSnapshot,
} from "./savia-request-cache";

beforeEach(() => {
  clearAllSaviaRequestSnapshots();
});

describe("savia-request-cache", () => {
  it("preserves snapshots per scope without mixing tenants", () => {
    writeSaviaRequestSnapshot("agency:1", {
      flows: [],
      folders: ["A"],
      flow: null,
      stepIndex: 0,
      error: null,
      updatedAt: 1,
    });
    expect(readSaviaRequestSnapshot("agency:1")?.folders).toEqual(["A"]);
    expect(readSaviaRequestSnapshot("agency:2")).toBeUndefined();
    expect(readSaviaRequestSnapshot(undefined)?.folders).toBeUndefined();
  });

  it("clears one scope or everything on session changes", () => {
    writeSaviaRequestSnapshot("agency:1", {
      flows: [],
      folders: ["A"],
      flow: null,
      stepIndex: 2,
      error: null,
      updatedAt: 1,
    });
    writeSaviaRequestSnapshot(undefined, {
      flows: [],
      folders: ["P"],
      flow: null,
      stepIndex: 0,
      error: null,
      updatedAt: 1,
    });
    clearSaviaRequestSnapshot("agency:1");
    expect(readSaviaRequestSnapshot("agency:1")).toBeUndefined();
    expect(readSaviaRequestSnapshot(undefined)?.folders).toEqual(["P"]);
    clearAllSaviaRequestSnapshots();
    expect(readSaviaRequestSnapshot(undefined)).toBeUndefined();
  });
});
