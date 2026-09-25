import { describe, expect, it, beforeEach } from "vitest";
import {
  clearStudioQueryCache,
  getStudioQueryClient,
  getStudioQueryOwner,
  isStudioBootstrapped,
  markStudioBootstrapFailed,
  markStudioBootstrapped,
  pruneStudioQueryCache,
  setStudioQueryOwner,
} from "./studio-query-cache";

beforeEach(() => {
  clearStudioQueryCache();
});

describe("studio-query-cache", () => {
  it("reuses the client for the same session and domain", () => {
    const first = getStudioQueryClient("crm", "env|user-1");
    const second = getStudioQueryClient("crm", "env|user-1");
    expect(second).toBe(first);
  });

  it("isolates domains", () => {
    const crm = getStudioQueryClient("crm", "env|user-1");
    const ops = getStudioQueryClient("ops", "env|user-1");
    expect(ops).not.toBe(crm);
  });

  it("rotates the client when the session owner changes", () => {
    const first = getStudioQueryClient("crm", "env|user-1");
    const second = getStudioQueryClient("crm", "env|user-2");
    expect(second).not.toBe(first);
  });

  it("tracks bootstrap once per domain and retries after failure", () => {
    expect(isStudioBootstrapped("crm", "env|user-1")).toBe(false);
    getStudioQueryClient("crm", "env|user-1");
    markStudioBootstrapped("crm", "env|user-1");
    expect(isStudioBootstrapped("crm", "env|user-1")).toBe(true);
    markStudioBootstrapFailed("crm", "env|user-1");
    expect(isStudioBootstrapped("crm", "env|user-1")).toBe(false);
  });

  it("clears on owner rotation and prunes deleted domains", () => {
    setStudioQueryOwner("env|user-1");
    const client = getStudioQueryClient("crm", "env|user-1");
    client.setQueryData(["x"], { ok: true });
    expect(client.getQueryData(["x"])).toEqual({ ok: true });
    setStudioQueryOwner("env|user-2");
    expect(getStudioQueryOwner()).toBe("env|user-2");
    const fresh = getStudioQueryClient("crm", "env|user-2");
    expect(fresh.getQueryData(["x"])).toBeUndefined();

    getStudioQueryClient("gone", "env|user-2");
    pruneStudioQueryCache(new Set(["crm"]));
    // "gone" fue eliminado: una nueva entrada no conserva el bootstrap.
    expect(isStudioBootstrapped("gone", "env|user-2")).toBe(false);
  });
});
