import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Authenticator } from "../src/auth/types";
import {
  defaultSidebarNavigationLayout,
  parseSidebarNavigationLayout,
} from "../src/user-preferences/contracts";
import { createUserPreferencesRepository } from "../src/user-preferences/repository";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

async function applyMigrations() {
  for (const migration of migrationSqls) {
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((value) =>
        value
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean)) {
      await env.DB.exec(statement);
    }
  }
}

async function seedPrincipal(id: string) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal (
      id, issuer, subject, email, display_name, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      "savia:test",
      id,
      `${id}@savia.test`,
      id,
      1,
      "2026-09-05T00:00:00.000Z",
      "2026-09-05T00:00:00.000Z",
    )
    .run();
}

function appFor(principalId: string) {
  return createApp(env.DB, undefined, undefined, authenticator(principalId));
}

function authenticator(principalId: string): Authenticator {
  return {
    async authenticate() {
      return {
        principal: {
          id: principalId,
          issuer: "savia:test",
          subject: principalId,
          email: `${principalId}@savia.test`,
          displayName: principalId,
          isActive: true,
          createdAt: "2026-09-05T00:00:00.000Z",
          updatedAt: "2026-09-05T00:00:00.000Z",
        },
        globalRoles: [],
        memberships: [],
      };
    },
  };
}

describe("user sidebar navigation preferences", () => {
  beforeAll(applyMigrations);

  beforeEach(async () => {
    await env.DB.exec(`
      DELETE FROM user_my_day_widgets;
      DELETE FROM user_appearance_preferences;
      DELETE FROM user_navigation_preferences;
      DELETE FROM identity_principal WHERE id IN ('principal-a', 'principal-b');
    `);
    await seedPrincipal("principal-a");
    await seedPrincipal("principal-b");
  });

  it("keeps a saved sidebar layout private to its principal", async () => {
    const repository = createUserPreferencesRepository(env.DB);

    await repository.saveSidebarNavigation("principal-a", {
      version: 1,
      sections: {
        operation: ["page:tenant%3A101:clients", "dynamic-crm"],
        productivity: ["integrations", "my-day"],
        administration: ["provider-credentials"],
        management: ["tenants", "users"],
      },
    });

    expect(await repository.getSidebarNavigation("principal-a")).toMatchObject({
      version: 2,
      blocks: expect.arrayContaining([
        expect.objectContaining({
          kind: "builtin",
          id: "productivity",
          items: ["integrations", "my-day"],
        }),
      ]),
    });
    expect(
      await repository.getSidebarNavigation("principal-b"),
    ).toBeUndefined();
  });

  it("persists the collapsed state for each sidebar section", async () => {
    const repository = createUserPreferencesRepository(env.DB);
    const layout = defaultSidebarNavigationLayout();
    const savedLayout = {
      ...layout,
      blocks: layout.blocks.map((block) =>
        block.kind === "builtin" && block.id === "operation"
          ? { ...block, collapsed: true }
          : block,
      ),
    };

    await repository.saveSidebarNavigation("principal-a", savedLayout);

    expect(
      (await repository.getSidebarNavigation("principal-a"))?.blocks.find(
        (block) => block.kind === "builtin" && block.id === "operation",
      ),
    ).toMatchObject({ collapsed: true });
  });

  it("persists and restores hidden items in the sidebar navigation layout", async () => {
    const repository = createUserPreferencesRepository(env.DB);
    const layout = defaultSidebarNavigationLayout();
    const savedLayout = {
      ...layout,
      hiddenItems: ["dashboard", "page:platform:cotizador"] as const,
    };

    await repository.saveSidebarNavigation("principal-a", savedLayout as any);

    const retrieved = await repository.getSidebarNavigation("principal-a");
    expect(retrieved?.hiddenItems).toEqual([
      "dashboard",
      "page:platform:cotizador",
    ]);
  });

  it("rejects invalid or duplicate hidden items in the layout", () => {
    const layout = defaultSidebarNavigationLayout();
    expect(() =>
      parseSidebarNavigationLayout({
        ...layout,
        hiddenItems: ["invalid-item-id"],
      }),
    ).toThrow("Sidebar navigation item is invalid");

    expect(() =>
      parseSidebarNavigationLayout({
        ...layout,
        hiddenItems: ["dashboard", "dashboard"],
      }),
    ).toThrow("Sidebar navigation item is duplicated");
  });

  it("rejects a duplicate sidebar item before persistence", () => {
    expect(() =>
      parseSidebarNavigationLayout({
        version: 1,
        sections: {
          operation: ["page:tenant%3A101:clients", "dynamic-crm"],
          productivity: ["my-day", "my-day"],
          administration: [],
          management: [],
        },
      }),
    ).toThrow("Sidebar navigation item is duplicated");
  });

  it("returns defaults and isolates a saved layout to the authenticated principal", async () => {
    const principalA = appFor("principal-a");
    const principalB = appFor("principal-b");

    const initial = await principalA.request(
      "https://savia.test/v1/user-preferences/sidebar-navigation",
    );
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toEqual({
      data: defaultSidebarNavigationLayout(),
    });

    const savedLayout = parseSidebarNavigationLayout({
      version: 1,
      sections: {
        operation: ["page:tenant%3A101:clients", "dynamic-crm"],
        productivity: ["integrations", "my-day"],
        administration: ["provider-credentials"],
        management: ["tenants", "users"],
      },
    });
    const saved = await principalA.request(
      "https://savia.test/v1/user-preferences/sidebar-navigation",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(savedLayout),
      },
    );
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toEqual({ data: savedLayout });

    expect(
      await (
        await principalA.request(
          "https://savia.test/v1/user-preferences/sidebar-navigation",
        )
      ).json(),
    ).toEqual({ data: savedLayout });

    const otherPrincipal = await principalB.request(
      "https://savia.test/v1/user-preferences/sidebar-navigation",
    );
    await expect(otherPrincipal.json()).resolves.toEqual({
      data: defaultSidebarNavigationLayout(),
    });
  });

  it("persists new tool visibility and the preset marker through the HTTP API", async () => {
    const app = appFor("principal-a");
    const layout = {
      ...defaultSidebarNavigationLayout(),
      hiddenItems: ["domain-workflows", "virtual-employees"],
    };
    const url = "https://savia.test/v1/user-preferences/sidebar-navigation";
    const saved = await app.request(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(layout),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ data: layout });
    const restored = await app.request(url);
    expect(await restored.json()).toEqual({ data: layout });
  });

  it("persists appearance preferences per principal", async () => {
    const repository = createUserPreferencesRepository(env.DB);

    await repository.saveAppearance("principal-a", {
      version: 1,
      theme: "dark",
      colorTheme: "mauve",
    });

    expect(await repository.getAppearance("principal-a")).toEqual({
      version: 1,
      theme: "dark",
      colorTheme: "mauve",
    });
    expect(await repository.getAppearance("principal-b")).toBeUndefined();
  });

  it("returns defaults and isolates saved appearance per principal", async () => {
    const principalA = appFor("principal-a");
    const principalB = appFor("principal-b");

    const initial = await principalA.request(
      "https://savia.test/v1/user-preferences/appearance",
    );
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toEqual({
      data: { version: 1, theme: "light", colorTheme: "emerald" },
    });

    const savedSettings = {
      version: 1 as const,
      theme: "dark" as const,
      colorTheme: "mauve" as const,
    };
    const saved = await principalA.request(
      "https://savia.test/v1/user-preferences/appearance",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(savedSettings),
      },
    );
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toEqual({ data: savedSettings });

    const otherPrincipal = await principalB.request(
      "https://savia.test/v1/user-preferences/appearance",
    );
    await expect(otherPrincipal.json()).resolves.toEqual({
      data: { version: 1, theme: "light", colorTheme: "emerald" },
    });
  });

  it("returns a public validation error for an invalid layout", async () => {
    const response = await appFor("principal-a").request(
      "https://savia.test/v1/user-preferences/sidebar-navigation",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          sections: {
            operation: ["not-a-savia-route"],
            productivity: [],
            administration: [],
            management: [],
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_SIDEBAR_NAVIGATION" },
    });
  });

  it("keeps a saved My Day widgets layout private to its principal", async () => {
    const repository = createUserPreferencesRepository(env.DB);

    await repository.saveMyDayWidgets("principal-a", {
      version: 1,
      widgets: [
        {
          id: "w_polizas1",
          apiBasePath: "/v1/data-domains/platform",
          collection: "polizas",
          kind: "summary",
        },
      ],
    });

    expect(await repository.getMyDayWidgets("principal-a")).toMatchObject({
      version: 1,
      widgets: [
        expect.objectContaining({
          id: "w_polizas1",
          collection: "polizas",
          size: "md",
        }),
      ],
    });
    expect(await repository.getMyDayWidgets("principal-b")).toBeUndefined();
  });

  it("returns defaults and isolates a saved widgets layout to the authenticated principal", async () => {
    const principalA = appFor("principal-a");
    const principalB = appFor("principal-b");

    const initial = await principalA.request(
      "https://savia.test/v1/user-preferences/my-day-widgets",
    );
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toEqual({
      data: { version: 1, widgets: [] },
    });

    const layout = {
      version: 1 as const,
      widgets: [
        {
          id: "w_clientes1",
          apiBasePath: "/v1/dynamic-crm/101",
          collection: "clientes",
          kind: "items" as const,
          config: { limit: 5, sort: "updated_at", order: "DESC" as const },
          size: "md" as const,
        },
      ],
    };
    const saved = await principalA.request(
      "https://savia.test/v1/user-preferences/my-day-widgets",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(layout),
      },
    );
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toEqual({ data: layout });

    expect(
      await (
        await principalA.request(
          "https://savia.test/v1/user-preferences/my-day-widgets",
        )
      ).json(),
    ).toEqual({ data: layout });

    const otherPrincipal = await principalB.request(
      "https://savia.test/v1/user-preferences/my-day-widgets",
    );
    await expect(otherPrincipal.json()).resolves.toEqual({
      data: { version: 1, widgets: [] },
    });
  });

  it("returns a public validation error for invalid widgets", async () => {
    const response = await appFor("principal-a").request(
      "https://savia.test/v1/user-preferences/my-day-widgets",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          widgets: [
            {
              id: "not valid!",
              apiBasePath: "/v1/data-domains/platform",
              collection: "polizas",
              kind: "summary",
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_MY_DAY_WIDGETS" },
    });
  });

  it("persists plugin widget kinds with dotted extension ids", async () => {
    const layout = {
      version: 1 as const,
      widgets: [
        {
          id: "w_plugin1",
          apiBasePath: "/v1/data-domains/platform",
          collection: "polizas",
          kind: "plugin:insurance.portfolio-dashboard:summary",
          config: { limit: 5, sort: "updated_at", order: "DESC" as const },
          size: "md" as const,
        },
      ],
    };
    const response = await appFor("principal-a").request(
      "https://savia.test/v1/user-preferences/my-day-widgets",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(layout),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: layout });
  });
});

it("round trips the navigation preset version and newly addressable tools", () => {
  const layout = defaultSidebarNavigationLayout();
  expect(layout.presetVersion).toBe(2);
  expect(parseSidebarNavigationLayout(layout)).toEqual(layout);
  expect(layout.blocks.flatMap((block) => block.items)).toEqual(
    expect.arrayContaining([
      "domain-workflows",
      "domain-sources",
      "virtual-employees",
      "tenant-branding",
    ]),
  );
});
