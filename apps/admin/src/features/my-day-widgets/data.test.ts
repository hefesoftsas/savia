import { describe, expect, it } from "vitest";
import {
  normalizeCollections,
  normalizeSchema,
  widgetDeepLink,
  type ObjectsResponse,
} from "./data";
import type { MyDayWidget } from "@savia/studio-shared/my-day-widgets";

const response: ObjectsResponse = {
  data: [
    {
      name: "polizas",
      label: "Pólizas",
      count: 42,
      config: {
        fields: { estado: { type: "Dropdown", label: "Estado" } },
        studio: {},
      },
    },
    {
      name: "hidden_one",
      label: "Oculta",
      hidden: true,
      config: { fields: {} },
    },
    {
      name: "form_only",
      label: "Formulario",
      config: { fields: {}, studio: { requestPage: {} } },
    },
    { label: "Sin nombre", config: { fields: {} } },
  ],
};

describe("normalizeCollections", () => {
  it("keeps visible collections sorted by label", () => {
    const collections = normalizeCollections("/v1/studio/0", response);
    expect(collections.map((entry) => entry.name)).toEqual(["polizas"]);
    expect(collections[0]).toMatchObject({
      apiBasePath: "/v1/studio/0",
      label: "Pólizas",
      count: 42,
    });
  });
});

describe("normalizeSchema", () => {
  it("extracts typed fields", () => {
    expect(normalizeSchema("/v1/studio/0", response, "polizas")).toEqual({
      apiBasePath: "/v1/studio/0",
      name: "polizas",
      label: "Pólizas",
      fields: [{ name: "estado", label: "Estado", type: "Dropdown" }],
    });
  });

  it("returns undefined for hidden or unknown collections", () => {
    expect(
      normalizeSchema("/v1/studio/0", response, "hidden_one"),
    ).toBeUndefined();
    expect(
      normalizeSchema("/v1/studio/0", response, "missing"),
    ).toBeUndefined();
  });
});

describe("widgetDeepLink", () => {
  it("links tenant widgets to the studio screen", () => {
    expect(
      widgetDeepLink({
        id: "w_1",
        apiBasePath: "/v1/studio/0",
        collection: "polizas",
        kind: "summary",
      } as MyDayWidget),
    ).toBe("/studio?tenantId=0&object=polizas");
  });

  it("links legacy dynamic CRM widgets with tenantId", () => {
    expect(
      widgetDeepLink({
        id: "w_2",
        apiBasePath: "/v1/dynamic-crm/101",
        collection: "clientes",
        kind: "items",
      } as MyDayWidget),
    ).toBe("/studio?tenantId=101&object=clientes");
  });

  it("links tenant widgets on the canonical /v1/studio base", () => {
    expect(
      widgetDeepLink({
        id: "w_3",
        apiBasePath: "/v1/studio/101",
        collection: "clientes",
        kind: "items",
      } as MyDayWidget),
    ).toBe("/studio?tenantId=101&object=clientes");
  });
});
