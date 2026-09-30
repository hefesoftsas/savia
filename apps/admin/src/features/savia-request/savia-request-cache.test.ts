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
    writeSaviaRequestSnapshot("tenant:1", {
      flows: [],
      folders: ["A"],
      flow: null,
      stepIndex: 0,
      error: null,
      updatedAt: 1,
    });
    expect(readSaviaRequestSnapshot("tenant:1")?.folders).toEqual(["A"]);
    expect(readSaviaRequestSnapshot("tenant:2")).toBeUndefined();
    expect(readSaviaRequestSnapshot(undefined)?.folders).toBeUndefined();
  });

  it("clears one scope or everything on session changes", () => {
    writeSaviaRequestSnapshot("tenant:1", {
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
    clearSaviaRequestSnapshot("tenant:1");
    expect(readSaviaRequestSnapshot("tenant:1")).toBeUndefined();
    expect(readSaviaRequestSnapshot(undefined)?.folders).toEqual(["P"]);
    clearAllSaviaRequestSnapshots();
    expect(readSaviaRequestSnapshot(undefined)).toBeUndefined();
  });
});
