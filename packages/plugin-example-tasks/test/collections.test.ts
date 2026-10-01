import { expect, it } from "vitest";
import { createMockPluginApi } from "@savia/plugin-sdk/testing";

it("creates and searches records through the plugin API", async () => {
  const savia = createMockPluginApi({
    collections: [
      {
        definition: {
          name: "example_tasks",
          label: "Example Tasks",
          description: "",
          config: {
            version: 2,
            fields: { name: { type: "Textbox", label: "Name" } },
            fieldOrder: ["name"],
          },
        },
        records: [],
      },
    ],
  });
  const collection = savia.collections.collection<{ id: string; name: string }>(
    "example_tasks",
  );
  await collection.create({ name: "Example" });
  const page = await collection.list({ q: "Example", searchFields: ["name"] });
  expect(page.data).toHaveLength(1);
});
