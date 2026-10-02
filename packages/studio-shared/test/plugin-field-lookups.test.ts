import { expect, it } from "vitest";
import { objectSchema } from "../src/metadata";
import {
  getPluginLookup,
  pluginLookupSchema,
  validatePluginLookupTargets,
} from "../src/plugin-field-lookups";

const lookup = {
  collection: "clients",
  labelField: "name",
  searchFields: ["name", "email"],
  idField: "client_id",
};

function object(fields: Record<string, unknown>) {
  const fieldMap = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      { type: "Textbox", label: name, ...(field as object) },
    ]),
  );
  return objectSchema.parse({
    name: "receivables",
    label: "Receivables",
    config: {
      version: 2,
      fields: fieldMap,
      fieldOrder: Object.keys(fieldMap),
    },
  });
}

const target = (overrides: Record<string, unknown> = {}) => ({
  name: "clients",
  label: "Clients",
  description: "",
  config: {
    version: 2,
    fields: {
      name: { type: "Textbox", label: "Name" },
      email: { type: "Email", label: "Email" },
      notes: { type: "Textarea", label: "Notes", hidden: true },
      address: { type: "Address", label: "Address" },
    },
    fieldOrder: ["name", "email", "notes", "address"],
    ...overrides,
  },
});

it("parses a strict plugin lookup mapping and exposes it from a field", () => {
  const source = object({
    customer: { config: { pluginLookup: lookup } },
    client_id: {},
  });

  expect(getPluginLookup(source.config.fields.customer)).toEqual(lookup);
  expect(
    pluginLookupSchema.safeParse({ ...lookup, unexpected: true }).success,
  ).toBe(false);
});

it("rejects malformed lookup identifiers, empty searches, and excess search fields", () => {
  for (const config of [
    { ...lookup, collection: "Clients" },
    { ...lookup, searchFields: [] },
    { ...lookup, searchFields: ["a", "b", "c", "d", "e", "f"] },
    { ...lookup, filter: { field: "stage", value: null } },
    { ...lookup, unexpected: "value" },
  ]) {
    expect(pluginLookupSchema.safeParse(config).success).toBe(false);
  }
  expect(
    pluginLookupSchema.safeParse({
      ...lookup,
      filter: { field: "active", value: false },
    }).success,
  ).toBe(true);
});

it("requires a plain editable source textbox and a distinct optional ID textbox", () => {
  const invalids = [
    {
      customer: { type: "Dropdown", config: { pluginLookup: lookup } },
      client_id: {},
    },
    {
      customer: { readOnly: true, config: { pluginLookup: lookup } },
      client_id: {},
    },
    {
      customer: { hidden: true, config: { pluginLookup: lookup } },
      client_id: {},
    },
    {
      customer: { computedValue: "name", config: { pluginLookup: lookup } },
      client_id: {},
    },
    {
      customer: {
        config: { pluginLookup: { ...lookup, idField: "customer" } },
      },
    },
    {
      customer: { config: { pluginLookup: lookup } },
      client_id: { required: true },
    },
    {
      customer: { config: { pluginLookup: lookup } },
      client_id: { readOnly: true },
    },
    {
      customer: { config: { pluginLookup: lookup } },
      client_id: { computedValue: "name" },
    },
    {
      customer: { config: { pluginLookup: lookup } },
      client_id: { config: { pluginLookup: lookup } },
    },
  ];

  for (const fields of invalids) {
    expect(() => object(fields)).toThrow();
  }
});

it("validates target collections, capabilities, and scalar visible fields", () => {
  const source = object({
    customer: { config: { pluginLookup: lookup } },
    client_id: {},
  });

  expect(validatePluginLookupTargets(source, [target()])).toEqual([]);
  expect(validatePluginLookupTargets(source, [])).not.toEqual([]);
  expect(
    validatePluginLookupTargets(source, [
      target({ studio: { capabilities: { list: true, read: false } } }),
    ]),
  ).not.toEqual([]);
  expect(
    validatePluginLookupTargets(source, [
      target({ studio: { capabilities: { list: false, read: true } } }),
    ]),
  ).not.toEqual([]);
  expect(
    validatePluginLookupTargets(source, [
      target({
        studio: { capabilities: { list: true, read: true, search: false } },
      }),
    ]),
  ).not.toEqual([]);
  expect(
    validatePluginLookupTargets(source, [
      target({
        studio: { collection: { capabilities: { list: true, read: true } } },
      }),
    ]),
  ).toEqual([]);
  const filtered = object({
    customer: {
      config: {
        pluginLookup: { ...lookup, filter: { field: "email", value: "x" } },
      },
    },
    client_id: {},
  });
  expect(
    validatePluginLookupTargets(filtered, [
      target({
        studio: { capabilities: { list: true, read: true, filter: false } },
      }),
    ]),
  ).not.toEqual([]);
});

it("rejects nonexistent, hidden, and nonscalar lookup target fields", () => {
  const source = object({
    customer: { config: { pluginLookup: lookup } },
    client_id: {},
  });
  const mapped = (mapping: Record<string, unknown>) =>
    object({
      customer: { config: { pluginLookup: { ...lookup, ...mapping } } },
      client_id: {},
    });

  expect(
    validatePluginLookupTargets(mapped({ labelField: "missing" }), [target()]),
  ).not.toEqual([]);
  expect(
    validatePluginLookupTargets(mapped({ labelField: "notes" }), [target()]),
  ).not.toEqual([]);
  expect(
    validatePluginLookupTargets(mapped({ labelField: "address" }), [target()]),
  ).not.toEqual([]);
  expect(validatePluginLookupTargets(source, [target()])).toEqual([]);
});
