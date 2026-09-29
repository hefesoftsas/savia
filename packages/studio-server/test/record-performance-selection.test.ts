import { expect, it } from "vitest";
import type { StudioObject } from "@savia/studio-shared/metadata";
import { indexedRecordSort } from "../src/record-performance";

const object = {
  name: "items",
  config: {
    fields: {
      stage: { type: "Textbox", label: "Stage" },
      region: { type: "Textbox", label: "Region" },
      name: { type: "Textbox", label: "Name" },
      age: { type: "Number", label: "Age" },
    },
    performance: {
      indexes: [{ fields: ["stage", "region", "name"], order: "ASC" }],
      summaries: [],
    },
  },
} as StudioObject;

const filters = (logic: "and" | "or", conditions: unknown[]) =>
  JSON.stringify({ logic, conditions });

it("selects a three-field index when all prefix fields have exact equalities", () => {
  const index = indexedRecordSort(object, "name", "ASC", {
    filters: filters("and", [
      { field: "stage", op: "eq", value: "open" },
      { field: "region", op: "eq", value: "west" },
    ]),
  });

  expect(index?.fields).toEqual(["stage", "region", "name"]);
});

it("combines the stage parameter with AND equality filters and extra predicates", () => {
  const index = indexedRecordSort(object, "name", "ASC", {
    stage: "open",
    filters: filters("and", [
      { field: "region", op: "eq", value: "west" },
      { field: "age", op: "gt", value: 20 },
    ]),
  });

  expect(index?.fields).toEqual(["stage", "region", "name"]);
});

it("uses a one-condition OR filter as an exact equality", () => {
  const singlePrefixObject = {
    ...object,
    config: {
      ...object.config,
      performance: {
        indexes: [{ fields: ["stage", "name"], order: "ASC" }],
        summaries: [],
      },
    },
  } as StudioObject;
  const index = indexedRecordSort(singlePrefixObject, "name", "ASC", {
    filters: filters("or", [{ field: "stage", op: "eq", value: "open" }]),
  });

  expect(index?.fields).toEqual(["stage", "name"]);
});

it("does not treat equalities inside a multi-condition OR as an index prefix", () => {
  const index = indexedRecordSort(object, "name", "ASC", {
    filters: filters("or", [
      { field: "stage", op: "eq", value: "open" },
      { field: "region", op: "eq", value: "west" },
    ]),
  });

  expect(index).toBeUndefined();
});

it("does not select a composite index when one prefix equality is missing", () => {
  const index = indexedRecordSort(object, "name", "ASC", {
    filters: filters("and", [
      { field: "stage", op: "eq", value: "open" },
      { field: "age", op: "gt", value: 20 },
    ]),
  });

  expect(index).toBeUndefined();
});

it("does not use an equality prefix for empty-stage queries", () => {
  const index = indexedRecordSort(object, "name", "ASC", {
    stage: "open",
    emptyStage: "true",
    filters: filters("and", [{ field: "region", op: "eq", value: "west" }]),
  });

  expect(index).toBeUndefined();
});
