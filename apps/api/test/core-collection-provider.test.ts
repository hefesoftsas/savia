import { expect, it } from "vitest";
import { createCollectionSourceApp } from "../src/crm/collection-sources";
import { defaultOperationMap } from "../src/crm/collection-operations";
import { loadCollectionOptions } from "../src/crm/collection-options";

const unavailableDb = new Proxy(
  {},
  {
    get() {
      throw new Error("Core requested a database table");
    },
  },
) as D1Database;

it("has an empty catalog without consulting legacy tables or services", async () => {
  const app = createCollectionSourceApp(
    unavailableDb,
    {} as R2Bucket,
    "domain:platform",
    "owner",
  );
  const response = await app.request("/api/collection-catalog");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: [] });
});

it("rejects legacy option sources before querying a database", async () => {
  await expect(
    loadCollectionOptions(unavailableDb, {
      domain: "reference-values",
      collection: "identification-types",
      valueField: "id",
      labelField: "attributes.label",
    }),
  ).rejects.toThrow("La colección de opciones no está disponible");
});

it("preserves generic remote operation mapping with no domain provider", () => {
  const operations = defaultOperationMap("workspace", {
    kind: "jsonapi",
    resource: "/contacts",
    capabilities: {
      list: true,
      read: true,
      create: true,
      update: true,
      delete: true,
    },
  });
  expect(operations.list).toMatchObject({
    method: "GET",
    path: "/contacts",
    format: "jsonapi",
  });
  expect(operations.update).toMatchObject({
    method: "PATCH",
    path: "/contacts/{id}",
  });
  expect(operations.delete).toMatchObject({
    method: "DELETE",
    path: "/contacts/{id}",
  });
});
