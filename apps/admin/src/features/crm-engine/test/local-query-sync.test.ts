import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { reconcileLocalQueries } from "../local-query-sync";
it("clears cached records and open detail after collection access is revoked", async () => {
  const client = new QueryClient();
  client.setQueryData(["accounts", "getList"], { data: [{ id: "private" }] });
  client.setQueryData(["open-record", "accounts", "private"], {
    data: { id: "private" },
  });
  client.setQueryData(["/api/objects"], { data: [{ name: "accounts" }] });
  await reconcileLocalQueries(client, new Set(["accounts"]), new Set());
  expect(client.getQueryData(["accounts", "getList"])).toBeUndefined();
  expect(
    client.getQueryData(["open-record", "accounts", "private"]),
  ).toBeUndefined();
  expect(client.getQueryData(["/api/objects"])).toBeUndefined();
});
it("invalidates local list and open-record queries without refetching unrelated remote collections", async () => {
  const client = new QueryClient();
  for (const key of [
    ["accounts", "getList"],
    ["open-record", "accounts", "id"],
    ["external", "getList"],
  ])
    client.setQueryData(key, {});
  await reconcileLocalQueries(
    client,
    new Set(["accounts"]),
    new Set(["accounts"]),
  );
  expect(client.getQueryState(["accounts", "getList"])?.isInvalidated).toBe(
    true,
  );
  expect(
    client.getQueryState(["open-record", "accounts", "id"])?.isInvalidated,
  ).toBe(true);
  expect(client.getQueryState(["external", "getList"])?.isInvalidated).toBe(
    false,
  );
});

it("refreshes locally resolved relation pickers after replication", async () => {
  const client = new QueryClient();
  const key = [
    "relation-selected",
    "/v1/data-domains/example",
    "domain-id",
    "accounts",
    "name",
    ["id"],
  ];
  client.setQueryData(key, {});
  await reconcileLocalQueries(
    client,
    new Set(["accounts"]),
    new Set(["accounts"]),
  );
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});

it("refreshes only changed collections and their relation labels", async () => {
  const client = new QueryClient();
  const changedKeys = [
    ["people", "getList"],
    ["relation-labels", "people", ["a"]],
    ["relation-options", "/api", "domain", "people"],
  ];
  const untouched = ["policies", "getList"];
  for (const key of [...changedKeys, untouched]) client.setQueryData(key, {});
  await reconcileLocalQueries(
    client,
    new Set(["people", "policies"]),
    new Set(["people", "policies"]),
    new Set(["people"]),
  );
  for (const key of changedKeys)
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(untouched)?.isInvalidated).toBe(false);
});
