// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  extensionApiFor,
  extensionScreenFor,
  isExtensionScreenEnabled,
} from "../extension-screens";

describe("trusted extension screen registry", () => {
  const screen = {
    id: "inventory.sync.dashboard",
    extensionId: "inventory.sync",
    object: "inventory",
    view: "records",
    Screen: () => null,
  };

  it("resolves contributed screens without adding them to the host", () => {
    expect(extensionScreenFor("polizas", "records")).toMatchObject({
      id: "insurance.portfolio-dashboard.policies",
      extensionId: "insurance.portfolio-dashboard",
    });
    expect(extensionScreenFor("cotizador", "records")).toMatchObject({
      id: "insurance.quotes.direct",
      extensionId: "insurance.quotes",
    });
    expect(extensionScreenFor("inventory", "admin")).toBeUndefined();
  });

  it("requires the owning extension to be enabled for the tenant", () => {
    expect(
      isExtensionScreenEnabled(screen, [
        {
          manifest: { id: "inventory.sync" },
          builtIn: false,
          installed: { enabled: false },
        },
      ]),
    ).toBe(false);
    expect(
      isExtensionScreenEnabled(screen, [
        {
          manifest: { id: "inventory.sync" },
          builtIn: false,
          installed: { enabled: true },
        },
      ]),
    ).toBe(true);
  });

  it("provides each screen an API scoped to its owning extension", async () => {
    const request = async (path: string) => {
      expect(path).toBe("/extensions/inventory.sync/summary");
      return { data: { total: 1 } };
    };

    await expect(
      extensionApiFor(screen, request).services.get("summary"),
    ).resolves.toEqual({ total: 1 });
  });
});
