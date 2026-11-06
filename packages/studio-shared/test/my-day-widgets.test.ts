import { describe, expect, it } from "vitest";
import {
  createMyDayWidgetId,
  defaultMyDayWidgets,
  parseMyDayWidgets,
} from "../src/my-day-widgets";

describe("my-day widgets layout", () => {
  it("defaults to agenda, quick task, and personal mail", () => {
    expect(defaultMyDayWidgets()).toEqual({
      version: 1,
      widgets: [
        { id: "agenda", kind: "agenda", size: "lg" },
        { id: "quick_task", kind: "quick_task", size: "md" },
        { id: "mail", kind: "mail", size: "md" },
      ],
    });
  });

  it("accepts system widgets without a collection", () => {
    const layout = parseMyDayWidgets({
      version: 1,
      widgets: [
        { id: "agenda", kind: "agenda" },
        {
          id: "w_abc123",
          apiBasePath: "/v1/studio/0",
          collection: "polizas",
          kind: "summary",
        },
      ],
    });
    expect(layout.widgets).toHaveLength(2);
    expect(layout.widgets[0]).toMatchObject({ id: "agenda", size: "md" });
    expect(layout.widgets[0]).not.toHaveProperty("config");
  });

  it("accepts the optional office documents system widget", () => {
    expect(
      parseMyDayWidgets({
        version: 1,
        widgets: [{ id: "office_documents", kind: "office_documents" }],
      }).widgets,
    ).toEqual([
      { id: "office_documents", kind: "office_documents", size: "md" },
    ]);
  });

  it("applies per-widget defaults", () => {
    const layout = parseMyDayWidgets({
      version: 1,
      widgets: [
        {
          id: "w_abc123",
          apiBasePath: "/v1/studio/0",
          collection: "polizas",
          kind: "summary",
        },
      ],
    });
    expect(layout.widgets[0]).toMatchObject({
      size: "md",
      config: { limit: 5, sort: "updated_at", order: "DESC" },
    });
  });

  it("rejects invalid layouts", () => {
    expect(() => parseMyDayWidgets(null)).toThrow(
      "My Day widgets layout is invalid",
    );
    expect(() =>
      parseMyDayWidgets({ version: 1, widgets: [{ id: "BAD ID!" }] }),
    ).toThrow("My Day widgets layout is invalid");
    expect(() =>
      parseMyDayWidgets({ version: 1, widgets: new Array(13).fill({}) }),
    ).toThrow("My Day widgets layout is invalid");
  });

  it("rejects duplicated widget ids", () => {
    const widget = {
      id: "w_dup",
      apiBasePath: "/v1/studio/0",
      collection: "polizas",
      kind: "items",
    };
    expect(() =>
      parseMyDayWidgets({ version: 1, widgets: [widget, widget] }),
    ).toThrow("My Day widget id is duplicated");
  });

  it("accepts agency domains and future chart/actions kinds", () => {
    const layout = parseMyDayWidgets({
      version: 1,
      widgets: [
        {
          id: "w_chart1",
          apiBasePath: "/v1/dynamic-crm/101",
          collection: "clientes",
          kind: "chart",
          config: { groupField: "estado", limit: 8 },
        },
      ],
    });
    expect(layout.widgets).toHaveLength(1);
  });

  it("accepts plugin kinds with dotted extension ids", () => {
    const layout = parseMyDayWidgets({
      version: 1,
      widgets: [
        {
          id: "w_plugin1",
          apiBasePath: "/v1/studio/0",
          collection: "polizas",
          kind: "plugin:insurance.portfolio-dashboard:summary",
        },
      ],
    });
    expect(layout.widgets[0]?.kind).toBe(
      "plugin:insurance.portfolio-dashboard:summary",
    );
  });

  it("creates unique ids", () => {
    const ids = new Set(
      Array.from({ length: 50 }, () => createMyDayWidgetId()),
    );
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9_-]{1,48}$/);
    }
  });
});

it("accepts mail without a collection and preserves existing layouts", () => {
  expect(
    parseMyDayWidgets({ version: 1, widgets: [{ id: "mail", kind: "mail" }] })
      .widgets[0],
  ).toEqual({ id: "mail", kind: "mail", size: "md" });
  expect(parseMyDayWidgets({ version: 1, widgets: [] }).widgets).toEqual([]);
  expect(() =>
    parseMyDayWidgets({
      version: 1,
      widgets: [{ id: "mail", kind: "mail", collection: "contacts" }],
    }),
  ).toThrow();
});
