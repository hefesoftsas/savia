import { describe, expect, it } from "vitest";
import {
  availablePluginWidgets,
  isPluginWidgetEnabled,
  parsePluginKind,
  pluginContributionFor,
  pluginWidgetTitle,
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
  it("resolves the portfolio summary contribution from the catalog", () => {
    const ref = parsePluginKind("plugin:insurance.portfolio-dashboard:summary");
    expect(ref).not.toBeNull();
    const contribution = pluginContributionFor(ref!);
    expect(contribution).toMatchObject({
      collection: "polizas",
      title: { es: "Resumen de cartera" },
    });
    expect(releaseCatalog.extensionWidgets).toContain(contribution);
    expect(
      pluginWidgetTitle("plugin:insurance.portfolio-dashboard:summary"),
    ).toBe("Resumen de cartera");
    expect(pluginWidgetTitle("summary")).toBeUndefined();
    expect(pluginWidgetTitle("plugin:unknown:missing")).toBeUndefined();
  });

  it("enables widgets with the same rule as extension screens", () => {
    const contribution = pluginContributionFor({
      extensionId: "insurance.portfolio-dashboard",
      widgetId: "summary",
    })!;
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

  it("offers plugin widgets only for their collection and when enabled", () => {
    const enabled = [
      {
        manifest: { id: "insurance.portfolio-dashboard" },
        builtIn: true,
        installed: null,
      },
    ];
    expect(
      availablePluginWidgets("polizas", enabled).map((entry) => entry.id),
    ).toEqual(["summary"]);
    expect(availablePluginWidgets("clientes", enabled)).toEqual([]);
    expect(availablePluginWidgets("polizas", [])).toEqual([]);
    expect(availablePluginWidgets("polizas", undefined)).toEqual([]);
  });
});
