import { describe, expect, it } from "vitest";
import { configSchema } from "../src/metadata";
const config = {
  version: 2,
  fields: {
    _id: { type: "Textbox", label: "ID", readOnly: true },
    name: { type: "Textbox", label: "Name" },
  },
  fieldOrder: ["_id", "name"],
};
const collection = {
  kind: "mongodb",
  sourceId: "mongo",
  resource: "records",
  idColumn: "_id",
  idType: "objectId",
  capabilities: {
    list: true,
    read: true,
    create: true,
    update: true,
    delete: true,
    schema: false,
    customFields: false,
  },
};
describe("MongoDB native identifier metadata", () => {
  it("accepts the native identifier in bound fields and their display order", () => {
    expect(
      configSchema.safeParse({ ...config, studio: { collection } }).success,
    ).toBe(true);
  });
  it("keeps the identifier reserved outside MongoDB bindings", () => {
    expect(configSchema.safeParse(config).success).toBe(false);
    expect(
      configSchema.safeParse({
        ...config,
        studio: { collection: { ...collection, kind: "mysql" } },
      }).success,
    ).toBe(false);
  });
});
