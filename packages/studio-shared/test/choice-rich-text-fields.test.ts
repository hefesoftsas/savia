import { expect, it } from "vitest";
import {
  makeConfig,
  objectSchema,
  validateRecord,
  type StudioObject,
} from "../src/metadata";
const object: StudioObject = {
  name: "notes",
  label: "Notes",
  description: "",
  config: makeConfig({
    tags: {
      type: "MultiSelect",
      label: "Tags",
      required: true,
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
    },
    notes: { type: "RichText", label: "Notes", required: true },
  }),
};
it("accepts rich text and multiple options and deduplicates selected values", () => {
  expect(objectSchema.safeParse(object).success).toBe(true);
  const result = validateRecord(object, {
    tags: ["a", "a", "b"],
    notes: "**Hello**\n\n- Item",
  });
  expect(result.errors).toEqual({});
  expect(result.data.tags).toEqual(["a", "b"]);
  expect(result.data.notes).toBe("**Hello**\n\n- Item");
});
it.each(["a", ["unknown"], [1], Array(501).fill("a")])(
  "rejects invalid multiple choices %j",
  (tags) => {
    expect(
      validateRecord(object, { tags, notes: "Note" }).errors.tags,
    ).toBeTruthy();
  },
);
it("enforces required choices and rich-text size", () => {
  expect(validateRecord(object, { tags: [], notes: " " }).errors).toEqual(
    expect.objectContaining({
      tags: expect.any(String),
      notes: expect.any(String),
    }),
  );
  expect(
    validateRecord(object, { tags: ["a"], notes: "x".repeat(100001) }).errors
      .notes,
  ).toBeTruthy();
});
it("rejects scalar-only configuration on multi-select fields", () => {
  for (const config of [
    { unique: true },
    { relation: "contacts" },
    { optionsWhen: { field: "tags", cases: {} } },
  ])
    expect(
      objectSchema.safeParse({
        ...object,
        config: makeConfig({
          tags: {
            type: "MultiSelect",
            label: "Tags",
            options: [{ value: "a", label: "A" }],
            config,
          },
        }),
      }).success,
    ).toBe(false);
});

it("imports multi-select JSON arrays and rejects malformed selections", async () => {
  const { mapCsvRow } = await import("../src/csv");
  const imported = mapCsvRow(
    object,
    ["Tags", "Notes"],
    ['["a","b"]', "**Hello**"],
    { Tags: "tags", Notes: "notes" },
  );
  expect(imported.errors).toEqual({});
  expect(imported.data.tags).toEqual(["a", "b"]);
  expect(
    mapCsvRow(object, ["Tags", "Notes"], ["a,b", "Note"], {
      Tags: "tags",
      Notes: "notes",
    }).errors.tags,
  ).toBeTruthy();
});
