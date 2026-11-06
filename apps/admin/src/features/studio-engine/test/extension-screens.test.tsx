// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  extensionApiFor,
  extensionScreenFor,
  isExtensionScreenEnabled,
  isStorePluginScreen,
  storeScreenContributions,
  storeScreenDefaultHidden,
  storeScreenFor,
} from "../extension-screens";

describe("trusted extension screen registry", () => {
  const screen = {
    id: "inventory.sync.dashboard",
    extensionId: "inventory.sync",
    object: "inventory",
    view: "records",
    Screen: () => null,
  };

  it("has no compiled screens after the store migration", () => {
    expect(extensionScreenFor("polizas", "records")).toBeUndefined();
    expect(extensionScreenFor("cotizador", "records")).toBeUndefined();
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

describe("store screen slots", () => {
  const entries = [
    {
      manifest: { id: "insurance.collections" },
      builtIn: false,
      store: true,
      screens: [{ object: "cobros", view: "records", hidden: false }],
      installed: { enabled: true },
    },
    {
      manifest: { id: "custom.off" },
      builtIn: false,
      store: true,
      screens: [{ object: "otros", view: "records", hidden: true }],
      installed: { enabled: false },
    },
    {
      manifest: { id: "insurance.quotes" },
      builtIn: true,
      installed: null,
    },
  ];

  it("resolves screens of enabled store plugins", () => {
    expect(storeScreenContributions(entries)).toEqual([
      {
        extensionId: "insurance.collections",
        object: "cobros",
        view: "records",
        hidden: false,
      },
    ]);
    expect(storeScreenFor("cobros", "records", entries)).toMatchObject({
      extensionId: "insurance.collections",
    });
    expect(storeScreenFor("cobros", "edit", entries)).toBeUndefined();
    expect(storeScreenFor("otros", "records", entries)).toBeUndefined();
  });

  it("detects store-owned objects and hidden screens", () => {
    expect(isStorePluginScreen("cobros", entries)).toBe(true);
    expect(isStorePluginScreen("polizas", entries)).toBe(false);
    expect(isStorePluginScreen("cobros", undefined)).toBe(false);
    expect(storeScreenDefaultHidden("cobros", entries)).toBe(false);
  });
});

import { localizedExtensionObjectLabel } from "../extension-screens";
it("preserves labels without a compiled catalog to translate them", () => {
  expect(
    localizedExtensionObjectLabel("insurance_claims", "Siniestros", "en"),
  ).toBe("Siniestros");
  expect(
    localizedExtensionObjectLabel("insurance_claims", "My claims", "pt"),
  ).toBe("My claims");
  expect(localizedExtensionObjectLabel("custom", "Siniestros", "en")).toBe(
    "Siniestros",
  );
});
