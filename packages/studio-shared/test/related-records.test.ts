import { expect, it } from "vitest";
import { configSchema, makeConfig } from "../src/metadata";
const field = (config: Record<string, unknown>) =>
  makeConfig({ details: { type: "Textbox", label: "Details", config } });
it("accepts configured local related tables and preserves permissions", () => {
  const result = configSchema.parse(
    field({
      collectionRelation: "items",
      multiple: true,
      relationPresentation: "table",
      relationFields: ["name", "quantity"],
      relationAllowCreate: false,
    }),
  );
  expect(result.fields.details.config?.relationPresentation).toBe("table");
  expect(result.fields.details.config?.relationAllowCreate).toBe(false);
});
it("rejects nested presentation without a binding, table on to-one and duplicate columns", () => {
  for (const config of [
    { relationPresentation: "subform" },
    { collectionRelation: "items", relationPresentation: "table" },
    {
      collectionRelation: "items",
      relationPresentation: "subform",
      relationFields: ["name", "name"],
    },
  ])
    expect(configSchema.safeParse(field(config)).success).toBe(false);
});
