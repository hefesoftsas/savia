// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createPluginPreviewDocument } from "../plugin-ide-preview";
import { readPluginIdeTheme } from "../plugin-ide-theme";

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("style");
  document.documentElement.className = "";
});

describe("plugin IDE theme snapshots", () => {
  it("reads inherited Savia variables and converts OKLCH colors to hex", () => {
    document.documentElement.style.setProperty(
      "--background",
      "oklch(0.2 0 0)",
    );
    document.documentElement.style.setProperty(
      "--foreground",
      "oklch(0.9 0 0)",
    );
    document.documentElement.style.setProperty(
      "--muted",
      "oklch(0.3 0.04 150)",
    );
    document.documentElement.style.setProperty(
      "--muted-foreground",
      "oklch(0.7 0.02 150)",
    );
    document.documentElement.style.setProperty(
      "--border",
      "oklch(1 0 0 / 10%)",
    );
    document.documentElement.style.setProperty(
      "--primary",
      "oklch(0.8 0.15 150)",
    );
    document.documentElement.style.setProperty(
      "--font-sans",
      "Inter, sans-serif",
    );
    const container = document.createElement("section");
    const surface = document.createElement("div");
    container.append(surface);
    document.body.append(container);

    const theme = readPluginIdeTheme(surface);

    expect(theme).toEqual({
      background: "#161616",
      foreground: "#dedede",
      muted: "#1f3423",
      mutedForeground: "#96a298",
      border: "#2d2d2d",
      primary: "#6ed889",
      fontFamily: "Inter, sans-serif",
      isDark: true,
    });
  });

  it("falls back safely when the element or CSS values are unavailable", () => {
    expect(readPluginIdeTheme(null)).toMatchObject({
      background: "#ffffff",
      foreground: "#1b2430",
      fontFamily: "system-ui, sans-serif",
      isDark: false,
    });
  });

  it("keeps opaque RGB values opaque and composites alpha colors over the background", () => {
    const theme = {
      background: "rgb(0, 0, 0)",
      foreground: "rgb(255, 255, 255)",
      muted: "rgb(32, 32, 32)",
      mutedForeground: "rgba(255, 255, 255, 0.5)",
      border: "rgba(255, 255, 255, 0.1)",
      primary: "#00ff00",
      fontFamily: "system-ui, sans-serif",
      isDark: true,
    };
    const element = document.createElement("div");
    element.style.setProperty("--background", theme.background);
    element.style.setProperty("--foreground", theme.foreground);
    element.style.setProperty("--muted", theme.muted);
    element.style.setProperty("--muted-foreground", theme.mutedForeground);
    element.style.setProperty("--border", theme.border);
    element.style.setProperty("--primary", theme.primary);
    document.body.append(element);

    expect(readPluginIdeTheme(element)).toMatchObject({
      background: "#000000",
      foreground: "#ffffff",
      mutedForeground: "#808080",
      border: "#1a1a1a",
    });
  });

  it("converts computed sRGB color() values returned by modern CSS color mixes", () => {
    const element = document.createElement("div");
    element.style.setProperty("--background", "#000000");
    element.style.setProperty("--foreground", "#ffffff");
    element.style.setProperty("--muted", "#202020");
    element.style.setProperty("--muted-foreground", "#808080");
    element.style.setProperty("--border", "#303030");
    element.style.setProperty("--primary", "color(srgb 0.1 0.5 0.25 / 0.5)");
    document.body.append(element);

    expect(readPluginIdeTheme(element).primary).toBe("#0d4020");
  });

  it("embeds only allowlisted safe theme values in preview styles", () => {
    const theme = {
      background: "#101820",
      foreground: "#f0f4f8",
      muted: "#202b35",
      mutedForeground: "#b0becb",
      border: "#405060",
      primary: "#43a97b",
      fontFamily: "Inter, sans-serif; background:url(https://bad.invalid)",
      isDark: true,
    };
    const html = createPluginPreviewDocument(
      "",
      {},
      { collections: [] },
      "session-1",
      "en",
      theme,
    );

    expect(html).toContain("#101820");
    expect(html).toContain("#f0f4f8");
    expect(html).not.toContain("https://bad.invalid");
    expect(html).toContain("system-ui, sans-serif");
    expect(html).toContain(String.raw`/^[\w\s,'"-]+$/`);
    expect(html).toContain("event.source !== parent");
    expect(html).toContain("savia-plugin-ide-theme");

    const scriptStart = html.indexOf("const themeColorKeys");
    const scriptEnd = html.indexOf("function applyTheme", scriptStart);
    const safeThemeSource = html.slice(scriptStart, scriptEnd);
    const safeTheme = new Function(
      `${safeThemeSource}; return safeTheme;`,
    )() as (value: unknown) => unknown;
    const safeSnapshot = {
      background: "#101820",
      foreground: "#f0f4f8",
      muted: "#202b35",
      mutedForeground: "#b0becb",
      border: "#405060",
      primary: "#43a97b",
      fontFamily: "Inter, sans-serif",
      isDark: true,
    };
    expect(safeTheme(safeSnapshot)).toMatchObject(safeSnapshot);
    expect(
      safeTheme({ ...safeSnapshot, fontFamily: "Arial; color:red" }),
    ).toBeNull();
    expect(
      safeTheme({ ...safeSnapshot, primary: "url(https://bad.invalid)" }),
    ).toBeNull();
  });
});
