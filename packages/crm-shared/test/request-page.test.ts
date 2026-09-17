import { describe, expect, it } from "vitest";
import {
  createLookupActionFromOperation,
  generateRequestPage,
  requestPageSchema,
  isValidResultColumnPointer,
  listRequestOperations,
  reorderResultColumns,
  requestActionSchema,
  requestOperations,
  resolveRequestActionLabel,
} from "../src/request-page";
import { configSchema, validateRecord } from "../src/metadata";
const input = {
  type: "object",
  properties: {
    "auto_light.vehicle.plate": {
      type: "string",
      title: "Placa",
      examples: ["PRIVATE123"],
      "x-savia-field": {
        section: "vehicle",
        sectionLabel: "Vehículo",
        transform: "uppercase",
      },
    },
    "auto_light.vehicle.productionYear": {
      type: "string",
      title: "Año",
      "x-savia-field": { type: "Number", integer: true, minimum: 1900 },
    },
    "auto_light.applicant.secondSurname": {
      type: "string",
      title: "Segundo apellido",
      "x-savia-field": { required: false },
    },
  },
};
const doc = {
  openapi: "3.1.0",
  paths: {
    "/api/flows/quote-a/runs": {
      post: {
        operationId: "execute_quote-a",
        summary: "Aseguradora A",
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object", properties: { input } },
            },
          },
        },
      },
    },
    "/api/flows/lookup/runs": {
      post: {
        operationId: "execute_lookup",
        summary: "Consultar placa",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  input: {
                    type: "object",
                    properties: {
                      plate: {
                        type: "string",
                        "x-savia-field": {
                          bind: "auto_light.vehicle.plate",
                          output: {
                            "auto_light.vehicle.productionYear":
                              "/data/vehicle/year",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
describe("pages generated from request operations", () => {
  it("generates editable fields and exact input mappings without sample personal data", () => {
    const page = generateRequestPage(doc, {
      name: "cotizador",
      label: "Cotizador",
      operationIds: ["quote-a"],
      lookupIds: ["lookup"],
    });
    expect(configSchema.safeParse(page.config).success).toBe(true);
    expect(page.config.fields.vehicle_plate.label).toBe("Placa");
    expect(page.config.fields.vehicle_plate.defaultValue).toBeUndefined();
    expect(JSON.stringify(page)).not.toContain("PRIVATE123");
    expect(
      page.config.studio?.requestPage?.actions[0].input[
        "auto_light.vehicle.plate"
      ],
    ).toBe("vehicle_plate");
    expect(page.config.studio?.requestPage?.actions[1].output).toEqual({
      vehicle_production_year: "/data/vehicle/year",
    });
    expect(page.config.studio?.requestPage?.actions[1].placement).toBe(
      "inline-end",
    );
    expect(
      validateRecord(page, {
        vehicle_plate: "TESTCAR",
        vehicle_production_year: 1899,
      }).errors.vehicle_production_year,
    ).toBeTruthy();
  });
  it("stores lookup trigger events on lookup actions only", () => {
    expect(
      requestActionSchema.safeParse({
        id: "lookup",
        operationId: "execute_lookup",
        label: "Consultar",
        kind: "lookup",
        events: ["blur", "change"],
        input: { plate: "vehicle_plate" },
        output: {},
      }).success,
    ).toBe(true);
    expect(
      requestActionSchema.safeParse({
        id: "quote-a",
        operationId: "execute_quote-a",
        label: "Cotizar",
        kind: "submit",
        events: ["blur"],
        input: { "auto_light.vehicle.plate": "vehicle_plate" },
        output: {},
      }).success,
    ).toBe(false);
    expect(
      requestActionSchema.safeParse({
        id: "lookup",
        operationId: "execute_lookup",
        label: "Consultar",
        kind: "lookup",
        events: ["blur", "blur"],
        input: { plate: "vehicle_plate" },
        output: {},
      }).success,
    ).toBe(false);
  });
  it("stores lookup event debounce on lookup actions only", () => {
    expect(
      requestActionSchema.safeParse({
        id: "lookup",
        operationId: "execute_lookup",
        label: "Consultar",
        kind: "lookup",
        events: ["input"],
        eventDebounce: true,
        eventDebounceMs: 600,
        input: { plate: "vehicle_plate" },
        output: {},
      }).success,
    ).toBe(true);
    expect(
      requestActionSchema.safeParse({
        id: "lookup",
        operationId: "execute_lookup",
        label: "Consultar",
        kind: "lookup",
        events: ["input"],
        eventDebounceMs: 600,
        input: { plate: "vehicle_plate" },
        output: {},
      }).success,
    ).toBe(false);
    expect(
      requestActionSchema.safeParse({
        id: "quote-a",
        operationId: "execute_quote-a",
        label: "Cotizar",
        kind: "submit",
        eventDebounce: true,
        input: { "auto_light.vehicle.plate": "vehicle_plate" },
        output: {},
      }).success,
    ).toBe(false);
  });
  it("stores lookup button placement on lookup actions only", () => {
    expect(
      requestActionSchema.safeParse({
        id: "lookup",
        operationId: "execute_lookup",
        label: "Consultar",
        kind: "lookup",
        placement: "below-field",
        input: { plate: "vehicle_plate" },
        output: {},
      }).success,
    ).toBe(true);
    expect(
      requestActionSchema.safeParse({
        id: "lookup",
        operationId: "execute_lookup",
        label: "Consultar placa",
        kind: "lookup",
        buttonStyle: "icon",
        icon: "search",
        input: { plate: "vehicle_plate" },
        output: {},
      }).success,
    ).toBe(true);
    expect(
      requestActionSchema.safeParse({
        id: "quote-a",
        operationId: "execute_quote-a",
        label: "Cotizar",
        kind: "submit",
        placement: "inline-end",
        input: { "auto_light.vehicle.plate": "vehicle_plate" },
        output: {},
      }).success,
    ).toBe(false);
    expect(
      requestActionSchema.safeParse({
        id: "quote-a",
        operationId: "execute_quote-a",
        label: "Cotizar",
        kind: "submit",
        buttonStyle: "icon",
        input: { "auto_light.vehicle.plate": "vehicle_plate" },
        output: {},
      }).success,
    ).toBe(false);
  });
  it("rejects unavailable operations and extracts only execution endpoints", () => {
    expect(() =>
      generateRequestPage(doc, {
        name: "test",
        label: "Test",
        operationIds: ["unknown"],
      }),
    ).toThrow("no disponible");
    expect(requestOperations(doc).map((o) => o.id)).toEqual([
      "quote-a",
      "lookup",
    ]);
  });
  it("stores localized lookup labels", () => {
    expect(
      requestActionSchema.safeParse({
        id: "lookup",
        operationId: "execute_lookup",
        label: "Consultar placa",
        labels: { en: "Look up plate", pt: "Consultar placa" },
        kind: "lookup",
        input: { plate: "vehicle_plate" },
        output: {},
      }).success,
    ).toBe(true);
    expect(
      resolveRequestActionLabel(
        {
          label: "Consultar placa",
          labels: { en: "Look up plate" },
        },
        "en",
      ),
    ).toBe("Look up plate");
  });
  it("filters request operations for the lookup picker", () => {
    const operations = requestOperations(doc);
    expect(
      listRequestOperations(operations, "look", { excludeIds: [] }).map(
        (operation) => operation.id,
      ),
    ).toEqual(["lookup"]);
    expect(
      listRequestOperations(operations, "", {
        excludeIds: ["lookup", "quote-a"],
      }),
    ).toEqual([]);
  });
  it("builds lookup actions from catalog operations", () => {
    const operation = requestOperations(doc).find(
      (entry) => entry.id === "lookup",
    );
    expect(operation).toBeTruthy();
    const action = createLookupActionFromOperation(
      operation!,
      "vehicle_plate",
      {
        vehicle_plate: { label: "Placa", type: "Text" },
        vehicle_production_year: { label: "Año", type: "Number" },
      },
    );
    expect(action.kind).toBe("lookup");
    expect(action.input.plate).toBe("vehicle_plate");
    expect(action.output.vehicle_production_year).toBe("/data/vehicle/year");
  });
  it("reorders result columns without dropping entries", () => {
    const columns = [
      { label: "Producto", pointer: "/product/name", format: "text" as const },
      { label: "Prima", pointer: "/premium/total", format: "money" as const },
      { label: "Referencia", pointer: "/reference", format: "text" as const },
    ];
    const next = reorderResultColumns(columns, 0, 2);
    expect(next.map((column) => column.pointer)).toEqual([
      "/premium/total",
      "/reference",
      "/product/name",
    ]);
  });
  it("validates result column pointers", () => {
    expect(isValidResultColumnPointer("/product/name")).toBe(true);
    expect(isValidResultColumnPointer("product/name")).toBe(false);
  });
});

it("uses industry neutral result columns for newly generated requests", () => {
  expect(
    requestPageSchema.parse({
      version: 1,
      source: "savia-request",
      actions: [
        {
          id: "inventory",
          operationId: "inventory",
          label: "Inventory",
          kind: "submit",
          input: {},
          output: {},
        },
      ],
    }).resultColumns,
  ).toEqual([{ label: "Resultado", pointer: "/result", format: "text" }]);
});
