import { describe, it, expect } from "vitest";
import {
  makeConfig,
  objectSchema,
  recordSurface,
  validateRecord,
  type CrmObject,
} from "../src/metadata";
import { inspectDocument, schemaToObject } from "../src/openapi";
import { exampleOpenApi } from "../src/seed";
const object: CrmObject = {
  name: "vehicle",
  label: "Vehículos",
  description: "",
  config: makeConfig({
    name: { type: "Textbox", label: "Placa", required: true },
    year: { type: "Number", label: "Año" },
    active: { type: "Toggle", label: "Activo" },
    date: { type: "DateControl", label: "Fecha" },
  }),
};
describe("metadata validation", () => {
  it("rejects required, type, date and unknown field violations", () => {
    expect(
      validateRecord(object, {
        year: "2026",
        active: "yes",
        date: "2026-02-31",
        injected: "x",
      }).errors,
    ).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        year: expect.any(String),
        active: expect.any(String),
        date: expect.any(String),
        injected: expect.any(String),
      }),
    );
  });
  it("accepts false and zero and valid leap dates", () => {
    expect(
      validateRecord(object, {
        name: "RECORDID",
        year: 0,
        active: false,
        date: "2024-02-29",
      }).errors,
    ).toEqual({});
  });
  it("rejects duplicate order and reserved field names", () => {
    expect(
      objectSchema.safeParse({
        ...object,
        config: {
          ...object.config,
          fieldOrder: ["name", "year", "year", "date"],
        },
      }).success,
    ).toBe(false);
    expect(
      objectSchema.safeParse({
        ...object,
        config: makeConfig({ id: { type: "Textbox", label: "ID" } }),
      }).success,
    ).toBe(false);
  });
  it("rejects unsupported rules and field types explicitly", () => {
    expect(
      objectSchema.safeParse({
        ...object,
        config: makeConfig({
          name: {
            type: "Textbox",
            label: "Name",
            rules: [
              {
                when: { field: "name", operator: "equals", value: "x" },
                then: { name: { hidden: true } },
              },
            ],
          },
        }),
      }).success,
    ).toBe(false);
  });

  it("accepts an R2 attachment field and keeps pending files out of record data", () => {
    const parsed = objectSchema.parse({
      name: "contracts",
      label: "Contratos",
      description: "",
      config: {
        version: 2,
        fields: {
          agreement: {
            type: "R2Attachment",
            label: "Contrato",
            config: {
              maxFiles: 3,
              maxSize: 1_048_576,
              accept: ["application/pdf"],
            },
          },
        },
        fieldOrder: ["agreement"],
      },
    });

    expect(
      validateRecord(parsed, { agreement: [new File(["draft"], "a.pdf")] })
        .data,
    ).not.toHaveProperty("agreement");
  });
});
describe("OpenAPI import", () => {
  it("extracts operation request body through a local ref", () => {
    const info = inspectDocument(exampleOpenApi);
    expect(info.operations[0].object?.config.fields.seats.type).toBe("Number");
    expect(info.schemas).toEqual(["Quote"]);
  });
  it("imports JSON and YAML identically", () => {
    expect(inspectDocument(JSON.stringify(exampleOpenApi)).title).toContain(
      "Cotizador",
    );
    expect(
      inspectDocument(
        "openapi: 3.1.0\ninfo:\n  title: Test\n  version: 1.0.0\npaths: {}",
      ).title,
    ).toBe("Test");
  });
  it("rejects external references and circular refs", () => {
    expect(() =>
      schemaToObject(
        exampleOpenApi,
        { $ref: "http://127.0.0.1/private" },
        "test",
      ),
    ).toThrow("locales");
    const doc = {
      components: { schemas: { A: { $ref: "#/components/schemas/A" } } },
    };
    expect(() => schemaToObject(doc, doc.components.schemas.A, "test")).toThrow(
      "circulares",
    );
  });
  it("preserves and validates nested shapes as JSON fields", () => {
    const nested = schemaToObject(
      exampleOpenApi,
      {
        type: "object",
        properties: { items: { type: "array", items: { type: "string" } } },
      },
      "nested",
    );
    expect(nested.config.fields.items.type).toBe("Textarea");
    expect(validateRecord(nested, { items: '["a","b"]' }).errors).toEqual({});
    expect(
      validateRecord(nested, { items: "[123]" }).errors.items,
    ).toBeTruthy();
  });
  it("chooses modal, drawer or page surfaces for create and edit", () => {
    expect(recordSurface(object, "create")).toBe("modal");
    expect(recordSurface(object, "edit")).toBe("modal");
    const configured: CrmObject = {
      ...object,
      config: {
        ...object.config,
        studio: { screen: { createMode: "page", editMode: "drawer" } },
      },
    };
    expect(recordSurface(configured, "create")).toBe("page");
    expect(recordSurface(configured, "edit")).toBe("drawer");
    expect(
      recordSurface(
        {
          ...object,
          config: {
            ...object.config,
            studio: { screen: { createMode: "drawer-long" } },
          },
        },
        "create",
      ),
    ).toBe("drawer-long");
    expect(
      objectSchema.safeParse({
        ...configured,
        config: {
          ...configured.config,
          studio: { screen: { createMode: "window" } },
        },
      }).success,
    ).toBe(false);
  });

  it("keeps a Lucide icon and sidebar section for a screen", () => {
    const configured = objectSchema.parse({
      ...object,
      config: {
        ...object.config,
        studio: {
          screen: { section: "administration", icon: "settings-2" },
        },
      },
    });

    expect(configured.config.studio?.screen).toMatchObject({
      section: "administration",
      icon: "settings-2",
    });
    expect(
      objectSchema.safeParse({
        ...object,
        config: {
          ...object.config,
          studio: { screen: { icon: "thesvg:hubspot" } },
        },
      }).success,
    ).toBe(false);
  });
});

it("validates scalar and multiple IDs for collection-bound fields without static options", () => {
  const config = makeConfig({
    client_id: {
      type: "Dropdown",
      label: "Cliente",
      config: { collectionRelation: "r1" },
    },
  });
  const bound = { ...object, config };
  expect(validateRecord(bound, { client_id: "remote-42" }).errors).toEqual({});
  const many = {
    ...bound,
    config: makeConfig({
      client_id: {
        type: "Textbox",
        label: "Clientes",
        config: { collectionRelation: "r1", multiple: true },
      },
    }),
  };
  expect(
    validateRecord(many, { client_id: ["remote-42", "remote-43"] }).errors,
  ).toEqual({});
  expect(
    validateRecord(many, { client_id: "remote-42" }).errors.client_id,
  ).toBeTruthy();
});
