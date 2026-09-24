import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { UserPreferencesClient } from "@/api/user-preferences-client";
import {
  defaultSidebarNavigationLayout,
  normalizeSidebarNavigationLayout,
  upgradeSidebarNavigationPreset,
  reconcileSidebarNavigation,
} from "./sidebar-navigation-layout";

const savedLayout = normalizeSidebarNavigationLayout({
  version: 1,
  sections: {
    operation: ["dashboard"],
    productivity: ["integrations", "my-day"],
    administration: [],
    management: ["tenants"],
  },
});

describe("sidebar navigation registry", () => {
  it("filters a persisted item that is no longer permitted", () => {
    const result = reconcileSidebarNavigation(savedLayout, [
      "my-day",
      "integrations",
    ]);
    const productivity = result.blocks.find(
      (block) => block.kind === "builtin" && block.id === "productivity",
    );
    expect(productivity?.items).toEqual(["integrations", "my-day"]);
  });
});

describe("user preferences client", () => {
  it("loads and saves the full sidebar layout through the API", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: input.toString(), init });
        return Response.json({ data: defaultSidebarNavigationLayout() });
      },
    );
    const api = new ApiClient({
      baseUrl: "https://api.savia.test",
      tokenSource: { getAccessToken: async () => "access-token" },
      fetcher,
    });
    const client = new UserPreferencesClient(api);
    const layout = defaultSidebarNavigationLayout();

    await expect(client.getSidebarNavigation()).resolves.toEqual(layout);
    await expect(client.saveSidebarNavigation(layout)).resolves.toEqual(layout);

    expect(requests).toEqual([
      expect.objectContaining({
        url: "https://api.savia.test/v1/user-preferences/sidebar-navigation",
        init: expect.objectContaining({ method: "GET" }),
      }),
      expect.objectContaining({
        url: "https://api.savia.test/v1/user-preferences/sidebar-navigation",
        init: expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(layout),
        }),
      }),
    ]);
  });
});

it("keeps a saved page section and appends newly created pages", () => {
  const layout = normalizeSidebarNavigationLayout({
    version: 1,
    sections: {
      operation: ["studio", "dashboard"],
      productivity: ["page:platform:clients"],
      administration: [],
      management: [],
    },
  });
  const result = reconcileSidebarNavigation(layout, [
    "page:platform:clients",
    "page:platform:projects",
    "dashboard",
  ]);
  const productivity = result.blocks.find(
    (block) => block.kind === "builtin" && block.id === "productivity",
  );
  const operation = result.blocks.find(
    (block) => block.kind === "builtin" && block.id === "operation",
  );
  expect(productivity?.items).toEqual(["page:platform:clients"]);
  expect(operation?.items).toEqual(["page:platform:projects", "dashboard"]);
});

it("places work, building and administration in coherent default groups", () => {
  const layout = defaultSidebarNavigationLayout();
  const items = (id: string) =>
    layout.blocks.find((block) => block.id === id)?.items;
  expect(items("operation")).toContain("my-day");
  expect(items("productivity")).toEqual(
    expect.arrayContaining(["page-administrator", "provider-credentials"]),
  );
  expect(items("administration")).toEqual(
    expect.arrayContaining(["users", "access-control"]),
  );
  expect(items("management")).toEqual(["tenants"]);
});

it("upgrades legacy defaults once while preserving custom placement and hidden screens", () => {
  const legacy = normalizeSidebarNavigationLayout({
    version: 1,
    sections: {
      operation: ["page:platform:clients"],
      productivity: ["my-day", "integrations"],
      administration: ["provider-credentials", "access-control"],
      management: ["tenants", "users", "page-administrator"],
    },
  });
  legacy.blocks.push({
    kind: "custom",
    id: "custom:mine",
    label: "Mine",
    collapsed: true,
    items: ["service-credentials"],
  });
  legacy.hiddenItems = ["page:platform:clients"];
  const result = upgradeSidebarNavigationPreset(legacy);
  expect(result.blocks.find((b) => b.id === "operation")?.items).toContain(
    "my-day",
  );
  expect(result.blocks.find((b) => b.id === "administration")?.items).toContain(
    "users",
  );
  expect(result.blocks.find((b) => b.id === "custom:mine")).toEqual(
    legacy.blocks.at(-1),
  );
  expect(result.hiddenItems).toEqual(legacy.hiddenItems);
  expect(upgradeSidebarNavigationPreset(result)).toEqual(result);
});

it("preserves explicitly reordered built-in preferences during preset upgrade", () => {
  const legacy = normalizeSidebarNavigationLayout({
    version: 1,
    sections: {
      operation: [],
      productivity: ["integrations", "my-day"],
      administration: [],
      management: ["users", "tenants", "page-administrator"],
    },
  });
  const result = upgradeSidebarNavigationPreset(legacy);
  expect(result.blocks.find((b) => b.id === "productivity")?.items).toEqual([
    "integrations",
    "my-day",
  ]);
  expect(result.blocks.find((b) => b.id === "management")?.items).toEqual([
    "users",
    "tenants",
    "page-administrator",
  ]);
});
