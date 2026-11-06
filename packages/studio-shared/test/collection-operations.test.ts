import { it, expect } from "vitest";
import {
  inferOperationEndpoints,
  endpointSchema,
  mapRequest,
} from "../src/collection-operations";
it("infers POST update/delete commands instead of treating every POST as create", () => {
  const candidates = inferOperationEndpoints({
    openapi: "3.1.0",
    paths: {
      "/clients": { get: {}, post: {} },
      "/clients/{clientId}": { patch: {} },
      "/commands/delete-client": { post: { operationId: "deleteClient" } },
      "/commands/recalculate": { post: {} },
    },
  });
  expect(candidates.map((c) => c.action)).toEqual([
    "list",
    "create",
    "update",
    "delete",
    null,
  ]);
  expect(candidates[2].endpoint.path).toBe("/clients/{id}");
});
it("rejects foreign URLs, traversal and reserved mapping properties", () => {
  for (const path of [
    "https://example.com/x",
    "//example.com",
    "a/../b",
    "a/%2f/b",
  ])
    expect(endpointSchema.safeParse({ path, method: "GET" }).success).toBe(
      false,
    );
  expect(
    endpointSchema.safeParse({
      path: "clients",
      method: "POST",
      requestFields: { name: "__proto__.name" },
    }).success,
  ).toBe(false);
  expect(
    mapRequest({ name: "Ana", ignored: "x" }, { name: "person.name" }),
  ).toEqual({ person: { name: "Ana" } });
});
