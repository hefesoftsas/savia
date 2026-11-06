import { describe, expect, it } from "vitest";
import {
  availablePluginWidgets,
  isPluginWidgetEnabled,
  parsePluginKind,
  pluginContributionFor,
  pluginWidgetTitle,
  storeWidgetContributions,
  storeWidgetFor,
} from "./plugins";
import { releaseCatalog } from "@savia/release-catalog";

describe("parsePluginKind", () => {
  it("parses dotted extension ids", () => {
    expect(
      parsePluginKind("plugin:insurance.portfolio-dashboard:summary"),
    ).toEqual({
      extensionId: "insurance.portfolio-dashboard",
      widgetId: "summary",
    });
  });

  it("rejects built-in kinds and malformed values", () => {
    expect(parsePluginKind("summary")).toBeNull();
    expect(parsePluginKind("plugin:only-one")).toBeNull();
    expect(parsePluginKind("plugin:a:b:c")).toBeNull();
    expect(parsePluginKind("plugin:BAD:summary")).toBeNull();
  });
});

describe("plugin registry", () => {
  it("ships no compiled widgets after the store migration", () => {
    expect(releaseCatalog.extensionWidgets).toEqual([]);
    expect(
      pluginContributionFor({
        extensionId: "insurance.portfolio-dashboard",
        widgetId: "summary",
      }),
    ).toBeUndefined();
    expect(
      pluginWidgetTitle("plugin:insurance.portfolio-dashboard:summary"),
    ).toBeUndefined();
    expect(pluginWidgetTitle("summary")).toBeUndefined();
    expect(pluginWidgetTitle("plugin:unknown:missing")).toBeUndefined();
  });

  it("enables widgets with the same rule as extension screens", () => {
    const contribution = {
      id: "summary",
      extensionId: "insurance.portfolio-dashboard",
      collection: "polizas",
      title: { es: "Resumen de cartera" },
      Widget: () => null,
    };
    expect(isPluginWidgetEnabled(contribution, undefined)).toBe(false);
    expect(isPluginWidgetEnabled(contribution, [])).toBe(false);
    expect(
      isPluginWidgetEnabled(contribution, [
        {
          manifest: { id: "insurance.portfolio-dashboard" },
          builtIn: false,
          installed: { enabled: false },
        },
      ]),
    ).toBe(false);
    expect(
      isPluginWidgetEnabled(contribution, [
        {
          manifest: { id: "insurance.portfolio-dashboard" },
          builtIn: true,
          installed: null,
        },
      ]),
    ).toBe(true);
  });

  it("offers store widgets for their collection when enabled", () => {
    const enabled = [
      {
        manifest: { id: "insurance.portfolio-dashboard" },
        builtIn: false,
        store: true,
        widgets: [
          {
            id: "summary",
            collection: "polizas",
            title: { es: "Resumen de cartera" },
          },
        ],
        installed: { enabled: true },
      },
    ];
    expect(
      availablePluginWidgets("polizas", enabled).map((entry) => entry.id),
    ).toEqual(["summary"]);
    expect(availablePluginWidgets("clientes", enabled)).toEqual([]);
    expect(availablePluginWidgets("polizas", [])).toEqual([]);
    expect(availablePluginWidgets("polizas", undefined)).toEqual([]);
    expect(
      storeWidgetContributions(undefined),
      "ignora catálogos ausentes",
    ).toEqual([]);
    expect(
      storeWidgetFor(
        { extensionId: "insurance.portfolio-dashboard", widgetId: "summary" },
        enabled,
      ),
    ).toMatchObject({ collection: "polizas" });
    expect(
      storeWidgetFor(
        { extensionId: "insurance.portfolio-dashboard", widgetId: "otro" },
        enabled,
      ),
    ).toBeUndefined();
  });
});
