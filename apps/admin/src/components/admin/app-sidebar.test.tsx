import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { ApiClientError } from "@/api/api-client";
import { App } from "@/app";
import type { SidebarNavigationLayout } from "@/api/user-preferences-client";
import { defaultSidebarNavigationLayout } from "./sidebar-navigation-layout";

const defaultLayout: SidebarNavigationLayout = {
  ...defaultSidebarNavigationLayout(),
  blocks: defaultSidebarNavigationLayout().blocks.map((block) =>
    block.kind === "builtin" && block.id === "operation"
      ? { ...block, items: ["dashboard", "dynamic-crm"] }
      : block,
  ),
};

function createServices(): AppServices {
  return {
    authSession: {
      checkSession: vi.fn().mockResolvedValue(undefined),
      handleCallback: vi.fn().mockResolvedValue(undefined),
      login: vi.fn(),
      logout: vi.fn(),
      getAccessToken: vi.fn(),
      getIdentity: vi.fn(),
      getPermissions: vi.fn().mockResolvedValue({
        canManageIdentity: true,
        memberships: [],
      }),
    },
    authProvider: {
      checkAuth: vi.fn().mockResolvedValue(undefined),
      checkError: vi.fn(),
      getIdentity: vi.fn().mockResolvedValue({
        id: "principal-1",
        fullName: "Admin Savia",
      }),
      getPermissions: vi.fn().mockResolvedValue({
        canManageIdentity: true,
        memberships: [],
      }),
      login: vi.fn(),
      logout: vi.fn(),
      canAccess: vi.fn().mockResolvedValue(true),
    },
    dataProvider: {
      getList: vi.fn().mockResolvedValue({
        data: [{ id: 101, name: "Norte" }],
        pageInfo: { hasNextPage: false, hasPreviousPage: false },
      }),
      getOne: vi.fn(),
      getMany: vi.fn(),
      getManyReference: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    domains: { list: vi.fn() },
    commands: { execute: vi.fn() },
    crm: {
      listProviders: vi.fn(),
      listConnections: vi.fn(),
      createConnectSession: vi.fn(),
      complete: vi.fn(),
      disconnect: vi.fn(),
    },
    personalIntegrations: {
      listProviders: vi.fn().mockResolvedValue([]),
      listConnections: vi.fn().mockResolvedValue([]),
      listEvents: vi.fn().mockResolvedValue([]),
      createConnectSession: vi.fn(),
      createCalendarEvent: vi.fn(),
      complete: vi.fn(),
      disconnect: vi.fn(),
    },
    assistantConfiguration: {
      summary: vi.fn().mockResolvedValue({ global: null, agencies: [] }),
      models: vi.fn().mockResolvedValue([]),
      activeAgency: vi.fn().mockResolvedValue({ agencies: [] }),
      saveGlobal: vi.fn(),
      saveAgencyOverride: vi.fn(),
      clearAgencyOverride: vi.fn(),
      setActiveAgency: vi.fn(),
    },
    userPreferences: {
      getSidebarNavigation: vi.fn().mockResolvedValue(defaultLayout),
      saveSidebarNavigation: vi.fn().mockResolvedValue(defaultLayout),
      getAppearance: vi.fn().mockResolvedValue({
        version: 1,
        theme: "light",
        colorTheme: "emerald",
      }),
      saveAppearance: vi.fn().mockResolvedValue({
        version: 1,
        theme: "light",
        colorTheme: "emerald",
      }),
    },
    apiClient: {
      get: vi.fn().mockImplementation(async (path: string) =>
        path === "/v1/data-domains"
          ? {
              data: [
                {
                  id: "platform",
                  label: "Plataforma",
                  kind: "platform",
                  apiBasePath: "/v1/data-domains/platform",
                },
              ],
            }
          : {
              data: [
                { name: "account", label: "Empresas", count: 0, config: {} },
                {
                  name: "activity",
                  label: "Actividades",
                  count: 0,
                  config: {},
                },
                { name: "contact", label: "Contactos", count: 0, config: {} },
                {
                  name: "opportunity",
                  label: "Oportunidades",
                  count: 0,
                  config: {},
                },
                { name: "task", label: "Tareas", count: 0, config: {} },
              ],
            },
      ),
    },
  } as unknown as AppServices;
}

function sidebarGroup(label: string): HTMLElement {
  const group = screen.getByText(label).closest('[data-slot="sidebar-group"]');
  if (!group) throw new Error(`Sidebar group ${label} was not rendered`);
  return group as HTMLElement;
}

describe("AppSidebar navigation preferences", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path !== "/api/public/tenant-branding")
        throw new Error(`Unexpected sidebar request: ${path}`);
      return new Response(JSON.stringify({ data: null }), {
        headers: { "content-type": "application/json" },
      });
    });
    window.history.replaceState({}, "", "/");
    window.location.hash = "#/";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("saves an item moved from Work to Build", async () => {
    const user = userEvent.setup();
    const services = createServices();

    render(<App services={services} />);

    await user.click(
      await screen.findByRole("button", { name: "Organizar menú" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Mover Mi día al grupo siguiente" }),
    );

    await waitFor(() =>
      expect(
        services.userPreferences.saveSidebarNavigation,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              kind: "builtin",
              id: "productivity",
              items: expect.arrayContaining(["my-day"]),
            }),
          ]),
        }),
      ),
    );
  });

  it("collapses a section and saves its state in the navigation layout", async () => {
    const user = userEvent.setup();
    const services = createServices();

    render(<App services={services} />);

    await user.click(
      await screen.findByRole("button", { name: "Contraer Trabajo" }),
    );

    expect(
      within(sidebarGroup("Trabajo")).queryByRole("link", { name: "Inicio" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        services.userPreferences.saveSidebarNavigation,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              kind: "builtin",
              id: "operation",
              collapsed: true,
            }),
          ]),
        }),
      ),
    );
  });

  it("toggles a section when clicking its title", async () => {
    const user = userEvent.setup();
    const services = createServices();
    vi.mocked(
      services.userPreferences.saveSidebarNavigation,
    ).mockImplementation(async (layout) => layout);

    render(<App services={services} />);

    await user.click(await screen.findByText("Trabajo", { exact: true }));

    expect(
      await screen.findByRole("button", { name: "Expandir Trabajo" }),
    ).toBeVisible();
  });

  it("restores a saved collapsed state for custom and built-in sections", async () => {
    const services = createServices();
    const savedLayout: SidebarNavigationLayout = {
      ...defaultLayout,
      blocks: [
        {
          kind: "builtin",
          id: "operation",
          items: ["dashboard", "dynamic-crm"],
          collapsed: true,
        },
        {
          kind: "custom",
          id: "custom:reports",
          label: "Reportes",
          items: [],
          collapsed: true,
        },
        ...defaultLayout.blocks.filter(
          (block) => block.kind === "builtin" && block.id !== "operation",
        ),
      ],
    };
    vi.mocked(services.userPreferences.getSidebarNavigation).mockResolvedValue(
      savedLayout,
    );

    render(<App services={services} />);

    expect(
      await screen.findByRole("button", { name: "Expandir Trabajo" }),
    ).toBeVisible();
    expect(
      within(sidebarGroup("Trabajo")).queryByRole("link", { name: "Inicio" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Expandir Reportes" }),
    ).toBeVisible();
  });

  it("restores the last confirmed menu when saving fails", async () => {
    const user = userEvent.setup();
    const services = createServices();
    vi.mocked(services.userPreferences.saveSidebarNavigation).mockRejectedValue(
      new ApiClientError(
        503,
        "PREFERENCES_UNAVAILABLE",
        "No fue posible guardar.",
      ),
    );

    render(<App services={services} />);

    await user.click(
      await screen.findByRole("button", { name: "Organizar menú" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Mover Mi día al grupo siguiente" }),
    );

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .some((alert) =>
            alert.textContent?.includes(
              "No pudimos guardar el orden del menú. Inténtalo de nuevo.",
            ),
          ),
      ).toBe(true),
    );
    expect(
      within(sidebarGroup("Construir")).queryByRole("link", {
        name: "Mi día",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebarGroup("Trabajo")).getByRole("link", {
        name: "Mi día",
      }),
    ).toBeVisible();
  });

  it("disables organization while the menu search is filtering", async () => {
    const user = userEvent.setup();

    render(<App services={createServices()} />);

    const organizeButton = await screen.findByRole("button", {
      name: "Organizar menú",
    });
    await user.type(
      screen.getByRole("searchbox", { name: "Buscar en el menú" }),
      "integraciones",
    );

    expect(organizeButton).toBeDisabled();
  });

  it("reorders individual pages and restores their saved section", async () => {
    const user = userEvent.setup();
    const services = createServices();
    let saved: SidebarNavigationLayout = defaultLayout;
    vi.mocked(services.userPreferences.getSidebarNavigation).mockImplementation(
      async () => saved,
    );
    vi.mocked(
      services.userPreferences.saveSidebarNavigation,
    ).mockImplementation(async (layout) => {
      saved = layout;
      return layout;
    });
    const mounted = render(<App services={services} />);
    await screen.findByRole("link", { name: /^Empresas/ });
    await user.click(screen.getByRole("button", { name: "Organizar menú" }));
    expect(
      screen.getByRole("button", { name: "Reordenar Empresas" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Reordenar Páginas" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Mover Empresas al grupo siguiente" }),
    );
    await waitFor(() => {
      const productivity = saved.blocks.find(
        (block) => block.kind === "builtin" && block.id === "productivity",
      );
      const operation = saved.blocks.find(
        (block) => block.kind === "builtin" && block.id === "operation",
      );
      expect(productivity?.items).toContain("page:platform:account");
      expect(operation?.items).not.toContain("page:platform:account");
    });
    await user.click(screen.getByRole("button", { name: "Listo" }));
    expect(
      within(sidebarGroup("Construir")).getByRole("link", {
        name: /^Empresas/,
      }),
    ).toBeVisible();
    mounted.unmount();
    render(<App services={services} />);
    await waitFor(() =>
      expect(
        within(sidebarGroup("Construir")).getByRole("link", {
          name: /^Empresas/,
        }),
      ).toBeVisible(),
    );
  });

  it("shows dynamic pages as direct menu links without synthetic agencies or CRM group", async () => {
    render(<App services={createServices()} />);
    const companies = await screen.findByRole("link", { name: /^Empresas/ });
    expect(companies).toHaveAttribute(
      "href",
      "#/crm?domain=platform&object=account",
    );
    expect(companies.closest("li")?.parentElement).toHaveAttribute(
      "data-slot",
      "sidebar-menu",
    );
    expect(
      screen.queryByRole("button", { name: "CRM" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Agencias" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Administrar" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Eliminar pantalla Empresas" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Contactos/ })).toBeVisible();
  });

  it("shows page administration under Construir with the current domain", async () => {
    render(<App services={createServices()} />);
    await screen.findByRole("link", { name: /^Empresas/ });
    // The scoped destinations gain the current object once the CRM object
    // catalog resolves; the link renders first without it.
    await waitFor(() =>
      expect(
        within(sidebarGroup("Construir")).getByRole("link", {
          name: "Pantallas",
        }),
      ).toHaveAttribute(
        "href",
        "#/crm?domain=platform&object=account&view=admin",
      ),
    );
  });

  it("exposes scoped building destinations and keeps users beside roles", async () => {
    render(<App services={createServices()} />);
    // The scoped destinations gain the current object once the CRM object
    // catalog resolves; the link renders first without it.
    const operations = await screen.findByRole("link", {
      name: "Operaciones",
    });
    await waitFor(() =>
      expect(operations).toHaveAttribute(
        "href",
        "#/crm?domain=platform&object=account&view=operations",
      ),
    );
    expect(screen.getByRole("link", { name: "Empleados IA" })).toHaveAttribute(
      "href",
      "#/my-integrations?tab=virtual-employees",
    );
    expect(
      within(sidebarGroup("Administración")).getByRole("link", {
        name: "Usuarios",
      }),
    ).toBeVisible();
    expect(
      within(sidebarGroup("Administración")).getByRole("link", {
        name: "Roles y permisos",
      }),
    ).toBeVisible();
    expect(
      within(sidebarGroup("Construir")).getByRole("link", {
        name: "Pantallas",
      }),
    ).toBeVisible();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar en el menú" }),
      { target: { value: "automatizaciones" } },
    );
    expect(screen.getByRole("link", { name: "Operaciones" })).toBeVisible();
  });

  it("does not reveal denied domain tools through search", async () => {
    const services = createServices();
    vi.mocked(services.authProvider.canAccess!).mockImplementation(
      async ({ resource }) => resource === "my-day",
    );
    render(<App services={services} />);
    await screen.findByRole("link", { name: "Mi día" });
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar en el menú" }),
      { target: { value: "flujos" } },
    );
    expect(
      screen.queryByRole("link", { name: "Flujos de trabajo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Empleados IA" }),
    ).not.toBeInTheDocument();
  });

  it("finds personally hidden screens without changing saved visibility", async () => {
    const services = createServices();
    vi.mocked(services.userPreferences.getSidebarNavigation).mockResolvedValue({
      ...defaultLayout,
      hiddenItems: ["page:platform:account"],
    });
    render(<App services={services} />);
    // Wait for the asynchronous permission and domain catalog queries before exercising search.
    await screen.findByRole(
      "link",
      { name: /^Contactos/ },
      { timeout: 10_000 },
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: /^Empresas/ }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar en el menú" }),
      { target: { value: "empresas" } },
    );
    expect(
      await screen.findByRole("link", { name: /^Empresas/ }),
    ).toHaveAttribute("href", "#/crm?domain=platform&object=account");
    expect(screen.getByText("Oculta de mi menú")).toBeVisible();
    expect(
      services.userPreferences.saveSidebarNavigation,
    ).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Mostrar Empresas" }),
    ).toBeVisible();
  });

  it("finds a CRM object when searching the menu", async () => {
    const user = userEvent.setup();
    render(<App services={createServices()} />);

    await screen.findByRole("link", { name: /^Empresas/ }, { timeout: 10_000 });
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar en el menú" }),
      {
        target: { value: "empresas" },
      },
    );

    expect(
      screen.queryByRole("button", { name: "CRM" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: /^Empresas/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Integraciones" }),
    ).not.toBeInTheDocument();
  });

  it("toggles item visibility in organization mode and persists hidden items", async () => {
    const user = userEvent.setup();
    const services = createServices();
    let saved: SidebarNavigationLayout = defaultLayout;
    vi.mocked(services.userPreferences.getSidebarNavigation).mockImplementation(
      async () => saved,
    );
    vi.mocked(
      services.userPreferences.saveSidebarNavigation,
    ).mockImplementation(async (layout) => {
      saved = layout;
      return layout;
    });

    const mounted = render(<App services={services} />);
    await screen.findByRole("link", { name: /^Empresas/ }, { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: "Organizar menú" }));

    const hideSwitch = screen.getByRole("switch", { name: "Ocultar Empresas" });
    expect(hideSwitch).toBeChecked();

    await user.click(hideSwitch);
    await waitFor(() => {
      expect(saved.hiddenItems).toContain("page:platform:account");
    });

    expect(
      screen.getByRole("switch", { name: "Mostrar Empresas" }),
    ).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Listo" }));
    expect(
      screen.queryByRole("link", { name: /^Empresas/ }),
    ).not.toBeInTheDocument();

    // Reopen organization mode and reset
    await user.click(screen.getByRole("button", { name: "Organizar menú" }));
    expect(
      screen.getByRole("switch", { name: "Mostrar Empresas" }),
    ).not.toBeChecked();

    await user.click(
      screen.getByRole("button", { name: "Restablecer orden del menú" }),
    );
    await waitFor(() => {
      expect(saved.hiddenItems ?? []).not.toContain("page:platform:account");
    });

    await user.click(screen.getByRole("button", { name: "Listo" }));
    expect(screen.getByRole("link", { name: /^Empresas/ })).toBeVisible();

    mounted.unmount();
  });

  it("renders dedicated tenant monogram and name when loaded under tenant subdomain", async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: {
        ...originalLocation,
        hostname: "merkaseguros.savia.app.hefesoft.com",
        origin: "https://merkaseguros.savia.app.hefesoft.com",
        pathname: "/",
        search: "",
        hash: "#/",
      },
      writable: true,
      configurable: true,
    });

    try {
      const services = createServices();
      const mounted = render(<App services={services} />);

      await waitFor(() => {
        expect(screen.getAllByText("Merkaseguros")[0]).toBeVisible();
      });
      expect(screen.getByText("M")).toBeVisible();
      expect(screen.getByText("Espacio de trabajo · Savia")).toBeVisible();
      mounted.unmount();
    } finally {
      Object.defineProperty(window, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    }
  });
});
