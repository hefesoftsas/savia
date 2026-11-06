import { expect, it } from "vitest";
import {
  makeConfig,
  objectSchema,
  validateRecord,
  type StudioObject,
} from "../src/metadata";
import { mapCsvRow } from "../src/csv";
const object: StudioObject = {
  name: "reviews",
  label: "Reviews",
  description: "",
  config: makeConfig({
    rate: { type: "Percentage", label: "Rate", config: { decimals: 2 } },
    score: { type: "Rating", label: "Score" },
  }),
};
it("accepts numeric percentage and rating fields and imports numeric CSV values", () => {
  expect(objectSchema.safeParse(object).success).toBe(true);
  expect(validateRecord(object, { rate: 25.25, score: 4 }).errors).toEqual({});
  const imported = mapCsvRow(object, ["rate", "score"], ["25.25", "4"], {
    rate: "rate",
    score: "score",
  });
  expect(imported.errors).toEqual({});
  expect(imported.data).toMatchObject({ rate: 25.25, score: 4 });
});
it.each([-1, 101, 25.255, "25", Infinity, NaN])(
  "rejects invalid percentage %s",
  (rate) => expect(validateRecord(object, { rate }).errors.rate).toBeTruthy(),
);
it.each([0, 6, 2.5, "4", Infinity])("rejects invalid rating %s", (score) =>
  expect(validateRecord(object, { score }).errors.score).toBeTruthy(),
);
it("honors configured percentage bounds and rating maximum", () => {
  const custom = {
    ...object,
    config: makeConfig({
      rate: {
        type: "Percentage",
        label: "Rate",
        config: { minimum: 10, maximum: 150, decimals: 1 },
      },
      score: {
        type: "Rating",
        label: "Score",
        config: { maximum: 10, ratingStyle: "number" },
      },
    }),
  };
  expect(objectSchema.safeParse(custom).success).toBe(true);
  expect(validateRecord(custom, { rate: 125.5, score: 10 }).errors).toEqual({});
  expect(validateRecord(custom, { rate: 9, score: 11 }).errors).toMatchObject({
    rate: expect.any(String),
    score: expect.any(String),
  });
});
it("rejects invalid scale settings", () => {
  for (const config of [{ maximum: 0 }, { maximum: 11 }, { maximum: 2.5 }])
    expect(
      objectSchema.safeParse({
        ...object,
        config: makeConfig({
          score: { type: "Rating", label: "Score", config },
        }),
      }).success,
    ).toBe(false);
  expect(
    objectSchema.safeParse({
      ...object,
      config: makeConfig({
        rate: {
          type: "Percentage",
          label: "Rate",
          config: { minimum: 80, maximum: 20 },
        },
      }),
    }).success,
  ).toBe(false);
});
