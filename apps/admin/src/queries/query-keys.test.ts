import { hashKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { readKey, type ReadScope } from "./query-keys";

const principal: ReadScope = {
  sessionGeneration: 4,
  kind: "principal",
  id: "user-7",
};

describe("readKey", () => {
  it("separates resources and authenticated scopes", () => {
    const key = readKey(principal, "account");

    expect(key).toEqual([
      "savia-read",
      4,
      "principal",
      "user-7",
      "account",
      {},
    ]);
    expect(
      readKey({ ...principal, sessionGeneration: 5 }, "account"),
    ).not.toEqual(key);
    expect(readKey({ ...principal, id: "user-8" }, "account")).not.toEqual(key);
    expect(readKey(principal, "permissions")).not.toEqual(key);
  });

  it("uses TanStack's stable parameter hashing for equivalent parameter objects", () => {
    const first = readKey(principal, "records", {
      page: 2,
      filter: { q: "x" },
    });
    const reordered = readKey(principal, "records", {
      filter: { q: "x" },
      page: 2,
    });

    expect(hashKey(first)).toBe(hashKey(reordered));
  });

  it("keeps public route scopes opaque and distinct", () => {
    const first = readKey(
      { sessionGeneration: 0, kind: "public", id: "route-scope-a" },
      "shared-record",
    );
    const second = readKey(
      { sessionGeneration: 0, kind: "public", id: "route-scope-b" },
      "shared-record",
    );

    expect(first).not.toEqual(second);
    expect(JSON.stringify(first)).not.toContain("share-token");
  });
});
