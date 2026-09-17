import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { UserPreferencesClient } from "@/api/user-preferences-client";
import {
  defaultSidebarNavigationLayout,
  normalizeSidebarNavigationLayout,
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
      operation: ["dynamic-crm", "dashboard"],
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
