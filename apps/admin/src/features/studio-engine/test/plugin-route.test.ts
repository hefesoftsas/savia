import { describe, expect, it } from "vitest";
import { readPluginRoute, writePluginRoute } from "../plugin-route";

describe("plugin URL state", () => {
  const href =
    "https://savia.test/#/studio?tenantId=12&object=opportunities&plugin.other.tab=keep";
  it("round trips a tender and tab without changing workspace or another plugin", () => {
    const url = writePluginRoute(href, "procurement.secop", {
      tender: "CO1.REQ.123",
      tab: "documents",
    });
    expect(readPluginRoute(url.href, "procurement.secop")).toEqual({
      tender: "CO1.REQ.123",
      tab: "documents",
    });
    expect(readPluginRoute(url.href, "other")).toEqual({ tab: "keep" });
    expect(url.hash).toContain("tenantId=12&object=opportunities");
    expect(
      readPluginRoute(
        writePluginRoute(url.href, "procurement.secop", {}).href,
        "procurement.secop",
      ),
    ).toEqual({});
  });
  it("also preserves path routing and query parameters", () => {
    const url = writePluginRoute(
      "https://savia.test/studio?tenantId=12#anchor",
      "demo",
      { tab: "chat" },
    );
    expect(url.pathname).toBe("/studio");
    expect(url.hash).toBe("#anchor");
    expect(readPluginRoute(url.href, "demo")).toEqual({ tab: "chat" });
    expect(url.searchParams.get("tenantId")).toBe("12");
  });
  it.each([
    null,
    [],
    { tab: 12 },
    { "../tenantId": "0" },
    { tab: "a".repeat(513) },
    Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`key${i}`, "a"])),
  ])("rejects invalid or excessive state %j", (state) => {
    expect(() => writePluginRoute(href, "demo", state)).toThrow();
  });
  it("does not expose another plugin's state or unchecked keys from hand edited links", () => {
    expect(
      readPluginRoute(
        href + "&plugin.demo.%2Ftenant=0&plugin.demo.tab=chat",
        "demo",
      ),
    ).toEqual({ tab: "chat" });
  });
  it("preserves nested extension IDs when the parent extension updates its own state", () => {
    const url = writePluginRoute(
      href + "&plugin.demo.other.tab=chat&plugin.demo.tab=old",
      "demo",
      { tab: "summary" },
    );
    expect(readPluginRoute(url.href, "demo.other")).toEqual({ tab: "chat" });
    expect(readPluginRoute(url.href, "demo")).toEqual({ tab: "summary" });
  });
});
