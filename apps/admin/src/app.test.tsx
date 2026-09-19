import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "./app-services";
import { App } from "./app";

type AgencyListResult = {
  data: Array<{ id: number; name: string }>;
  pageInfo?: { hasNextPage: boolean; hasPreviousPage: boolean };
  total?: number;
};

function createServices(
  agencyListResult: AgencyListResult = {
    data: [],
    pageInfo: { hasNextPage: false, hasPreviousPage: false },
  },
): AppServices {
  return {
    authSession: {
      checkSession: vi.fn().mockResolvedValue(undefined),
      handleCallback: vi.fn().mockResolvedValue(undefined),
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi
        .fn()
        .mockResolvedValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
      getAuthorizeUrl: vi
        .fn()
        .mockReturnValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
      getAccessToken: vi.fn(),
      getIdentity: vi.fn(),
      getPermissions: vi.fn(),
    },
    authProvider: {
      checkAuth: vi.fn().mockResolvedValue(undefined),
      checkError: vi.fn(),
      getIdentity: vi.fn().mockResolvedValue({
        id: "principal-1",
        fullName: "Admin Savia",
      }),
      getPermissions: vi.fn(),
      login: vi.fn().mockResolvedValue(undefined),
      logout: vi
        .fn()
        .mockResolvedValue("http://127.0.0.1:8787/api/auth/admin/authorize"),
    },
    dataProvider: {
      getList: vi.fn().mockResolvedValue(agencyListResult),
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
      listProviders: vi.fn().mockResolvedValue([]),
      listConnections: vi.fn().mockResolvedValue([]),
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
    apiClient: {
      get: vi.fn().mockResolvedValue({ data: [] }),
      requestResponse: vi.fn(),
    },
  } as unknown as AppServices;
}

function mockAccountRequests(actionPath: string) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === "/api/public/tenant-branding")
      return new Response(JSON.stringify({ data: null }), {
        headers: { "content-type": "application/json" },
      });
    if (path === "/api/auth/get-session")
      return new Response(
        JSON.stringify({
          user: {
            id: "account-1",
            name: "Admin Savia",
            email: "admin@savia.test",
            twoFactorEnabled: true,
          },
          session: { id: "session-1" },
        }),
        { headers: { "content-type": "application/json" } },
      );
    if (path === actionPath) return new Response(null, { status: 200 });
    throw new Error(`Unexpected account request: ${path}`);
  });
}

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path !== "/api/public/tenant-branding")
        throw new Error(`Unexpected app request: ${path}`);
      return new Response(JSON.stringify({ data: null }), {
        headers: { "content-type": "application/json" },
      });
    });
    window.history.replaceState({}, "", "/");
    window.location.hash = "#/my-integrations";
  });

  it("starts in the integrations workspace with the emerald theme", async () => {
    render(<App services={createServices()} />);

    expect(
      await screen.findByRole(
        "heading",
        { name: "Integraciones" },
        { timeout: 10000 },
      ),
    ).toBeVisible();
    expect(document.documentElement).toHaveAttribute(
      "data-color-theme",
      "emerald",
    );
    expect(
      screen.queryByText("Tu espacio de operación"),
    ).not.toBeInTheDocument();
  });

  it("filters sidebar navigation to matching tools", async () => {
    const user = userEvent.setup();

    render(<App services={createServices()} />);

    await screen.findByRole("heading", { name: "Integraciones" });
    await user.type(
      screen.getByRole("searchbox", { name: "Buscar en el menú" }),
      "integraciones",
    );

    expect(screen.getByRole("link", { name: "Integraciones" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Autos livianos" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the assistant available from the authenticated workspace without eagerly reading a token", async () => {
    const services = createServices();
    const user = userEvent.setup();

    render(<App services={services} />);

    await screen.findByRole("heading", { name: "Integraciones" });
    expect(services.authSession.getAccessToken).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    expect(
      await screen.findByRole("heading", { name: "Asistente Savia" }),
    ).toBeVisible();
    expect(services.authSession.getAccessToken).not.toHaveBeenCalled();
  });

  it("shows the persisted active-agency selector when the user can operate across agencies", async () => {
    const services = createServices();
    services.assistantConfiguration.activeAgency = vi.fn().mockResolvedValue({
      activeAgencyId: 101,
      agencies: [
        { id: 101, name: "Agencia Norte" },
        { id: 202, name: "Agencia Sur" },
      ],
    });
    const user = userEvent.setup();

    render(<App services={services} />);
    await screen.findByRole("heading", { name: "Integraciones" });
    await user.click(screen.getByRole("button", { name: "Abrir asistente" }));

    expect(await screen.findByLabelText("Agencia activa")).toHaveValue("101");
  });

  it("keeps the signed-in account menu in the sidebar", async () => {
    const user = userEvent.setup();

    render(<App services={createServices()} />);

    await screen.findByRole("heading", { name: "Integraciones" });
    const accountMenuTrigger = screen.getByRole("button", {
      name: "Abrir menú de cuenta",
    });

    const footer = accountMenuTrigger.closest('[data-slot="sidebar-footer"]');
    expect(footer).toBeTruthy();
    const appearanceHeading = screen.getByText("Apariencia");
    expect(
      appearanceHeading.compareDocumentPosition(accountMenuTrigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(accountMenuTrigger);

    expect(screen.getByRole("menuitem", { name: "Mi cuenta" })).toHaveAttribute(
      "href",
      "#/account",
    );
  });

  it("opens personal integrations for every authenticated user", async () => {
    window.location.hash = "#/my-integrations";
    const services = createServices();

    render(<App services={services} />);

    expect(
      await screen.findByRole("heading", { name: "Integraciones" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Integraciones" })).toHaveAttribute(
      "href",
      "#/my-integrations",
    );
  });

  it("redirects the legacy CRM URL to the unified integrations screen", async () => {
    window.location.hash = "#/crm-connections";

    render(<App services={createServices()} />);

    expect(
      await screen.findByRole("heading", { name: "Integraciones" }),
    ).toBeVisible();
    await waitFor(() => expect(window.location.hash).toBe("#/my-integrations"));
  });

  it("opens the Outlook-backed My Day workspace for every authenticated user", async () => {
    window.location.hash = "#/my-day";
    const services = createServices();

    render(<App services={services} />);

    expect(
      await screen.findByRole("heading", { name: "Mi día" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Mi día" })).toHaveAttribute(
      "href",
      "#/my-day",
    );
  });

  it("keeps CRM connections inside the integrations screen", async () => {
    window.location.hash = "#/my-integrations";
    const administrator = createServices();
    administrator.crm.listProviders = vi.fn().mockResolvedValue([]);
    administrator.crm.listConnections = vi.fn().mockResolvedValue([]);

    render(<App services={administrator} />);

    expect(
      await screen.findByRole("link", { name: "Integraciones" }),
    ).toHaveAttribute("href", "#/my-integrations");
    expect(await screen.findByRole("heading", { name: "CRM" })).toBeVisible();
  });

  it("shows the Request access explanation without mounting the editor for a non-platform administrator", async () => {
    window.location.hash = "#/savia-request";
    const services = createServices();
    services.authProvider.canAccess = vi.fn(async () => false);
    render(<App services={services} />);
    expect(
      await screen.findByText("Acceso de administrador de plataforma"),
    ).toBeVisible();
    expect(
      await screen.findByText(/Tu cuenta no tiene acceso al editor/),
    ).toHaveTextContent("administrador de plataforma");
    expect(screen.queryByTitle("Savia request")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Savia request" }),
    ).toBeInTheDocument();
  });

  it("opens Savia Request in the integrated admin workspace for a platform administrator", async () => {
    window.location.hash = "#/savia-request";
    const services = createServices();
    services.authProvider.canAccess = vi.fn(async () => true);
    services.apiClient = {
      get: vi.fn(async (path: string) => {
        if (path.endsWith("/flows")) {
          return [
            {
              id: "autos",
              name: "Autos",
              folderPath: "Cotizaciones",
              steps: [{ id: "cotizar", name: "Cotizar", method: "POST" }],
            },
          ];
        }
        if (path.endsWith("/folders")) return ["Cotizaciones"];
        if (path.endsWith("/flows/autos")) {
          return {
            id: "autos",
            name: "Autos",
            folderPath: "Cotizaciones",
            description: "Cotiza autos livianos.",
            input: {},
            variables: [],
            versions: [],
            steps: [
              {
                id: "cotizar",
                name: "Cotizar",
                method: "POST",
                url: "https://provider.example.test/quote",
                headers: {},
                body: "{}",
                bodyType: "json",
                pre: "",
                post: "",
              },
            ],
          };
        }
        if (path.endsWith("/runs")) return [];
        throw new Error(`Ruta inesperada: ${path}`);
      }),
      put: vi.fn().mockResolvedValue({ ok: true }),
      post: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
    } as unknown as AppServices["apiClient"];
    services.requestResults = {
      read: vi.fn().mockRejectedValue(new Error("sin resultado")),
    } as unknown as AppServices["requestResults"];

    render(<App services={services} />);

    expect(
      await screen.findByRole("heading", { name: "Autos" }, { timeout: 5000 }),
    ).toBeVisible();
    expect(screen.queryByTitle("Savia request")).not.toBeInTheDocument();
    const flowNavigation = screen.getByRole("navigation", {
      name: "Flows de Savia Request",
    });
    const saviaRequest = screen.getByRole("button", { name: "Savia request" });
    expect(flowNavigation).toBeVisible();
    expect(saviaRequest).toBeVisible();
    expect(saviaRequest.closest("li")).toContainElement(flowNavigation);
  });

  it("opens the unified service credentials screen from its protected route", async () => {
    window.location.hash = "#/service-credentials";
    const services = createServices();
    services.assistantConfiguration.activeAgency = vi.fn().mockResolvedValue({
      agencies: [{ id: 101, name: "Agencia Norte" }],
    });

    render(<App services={services} />);

    expect(
      await screen.findByRole("heading", {
        name: "Claves y servicios",
      }),
    ).toBeVisible();
    expect(
      await screen.findByRole("heading", {
        name: "OpenRouter",
      }),
    ).toBeVisible();
    expect(screen.getByRole("tab", { name: "Globales" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Integraciones/i })).toBeVisible();
    expect(screen.queryByRole("tab", { name: /Por agencia/i })).toBeNull();
    expect(
      await screen.findByRole("link", { name: "Claves y servicios" }),
    ).toHaveAttribute("href", "#/service-credentials");
  });

  it("changes the signed-in user's password with their current password", async () => {
    window.location.hash = "#/account";
    const fetcher = mockAccountRequests("/api/auth/change-password");
    const user = userEvent.setup();

    render(<App services={createServices()} />);

    expect(
      await screen.findByRole("heading", { name: "Mi cuenta" }),
    ).toBeVisible();
    await user.click(screen.getByRole("tab", { name: /Seguridad/ }));
    await user.type(
      screen.getByLabelText("Contraseña actual"),
      "current-password",
    );
    await user.type(
      screen.getByLabelText("Nueva contraseña"),
      "new-password-123",
    );
    await user.type(
      screen.getByLabelText("Confirmar nueva contraseña"),
      "new-password-123",
    );
    await user.click(
      screen.getByRole("button", { name: "Actualizar contraseña" }),
    );

    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        new URL("/api/auth/change-password", window.location.origin).toString(),
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({
            currentPassword: "current-password",
            newPassword: "new-password-123",
            revokeOtherSessions: true,
          }),
        }),
      ),
    );
    expect(
      await screen.findByText(
        "Tu contraseña se actualizó y las demás sesiones se cerraron.",
      ),
    ).toBeVisible();
  });

  it("lets the signed-in user disable their active MFA with their current password", async () => {
    window.location.hash = "#/account";
    const fetcher = mockAccountRequests("/api/auth/two-factor/disable");
    const user = userEvent.setup();

    render(<App services={createServices()} />);

    await user.click(await screen.findByRole("tab", { name: /^MFA/ }));
    expect(await screen.findByText("MFA activa en esta cuenta")).toBeVisible();
    await user.type(
      screen.getByLabelText("Contraseña actual para desactivar MFA"),
      "current-password",
    );
    await user.click(screen.getByRole("button", { name: "Desactivar MFA" }));

    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        new URL(
          "/api/auth/two-factor/disable",
          window.location.origin,
        ).toString(),
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({ password: "current-password" }),
        }),
      ),
    );
    expect(
      await screen.findByText("MFA desactivada para esta cuenta."),
    ).toBeVisible();
  });

  it("starts Better Auth immediately when the login route opens", async () => {
    window.location.hash = "#/login";
    const services = createServices();
    let resolveLogin: (() => void) | undefined;
    services.authProvider.login = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLogin = resolve;
        }),
    );

    render(
      <StrictMode>
        <App services={services} />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(services.authProvider.login).toHaveBeenCalledTimes(1),
    );
    await act(async () => resolveLogin?.());
    expect(window.location.hash).toBe("#/login");
    expect(
      screen.queryByRole("button", { name: "Iniciar sesión con Savia" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the Better Auth OAuth session in memory after its callback", async () => {
    const services = createServices();
    window.history.replaceState({}, "", "/auth/callback?code=code&state=state");

    render(<App services={services} />);

    await waitFor(() =>
      expect(services.authSession.handleCallback).toHaveBeenCalledTimes(1),
    );
    expect(window.location.pathname).toBe("/");
    expect(window.location.hash).toBe("#/my-day");
  });

  it("applies the Savia color theme when the OAuth callback fails", async () => {
    const services = createServices();
    services.authSession.handleCallback = vi
      .fn()
      .mockRejectedValue(
        new Error("The login transaction is invalid or expired"),
      );
    document.documentElement.removeAttribute("data-color-theme");
    window.history.replaceState({}, "", "/auth/callback?code=code&state=state");

    render(<App services={services} />);

    expect(
      await screen.findByRole("heading", { name: "No pudimos iniciar sesión" }),
    ).toBeVisible();
    expect(document.documentElement).toHaveAttribute(
      "data-color-theme",
      "emerald",
    );
  });

  it("logs out and redirects to the authorization endpoint when user closes session", async () => {
    const services = createServices();
    const user = userEvent.setup();

    render(<App services={services} />);

    await screen.findByRole(
      "heading",
      { name: "Integraciones" },
      { timeout: 10000 },
    );
    const userMenuButton = screen.getByRole("button", {
      name: "Abrir menú de cuenta",
    });
    await user.click(userMenuButton);
    const logoutButton = await screen.findByRole("menuitem", {
      name: /Cerrar sesión/i,
    });
    await user.click(logoutButton);

    await waitFor(() => {
      expect(services.authProvider.logout).toHaveBeenCalledWith({
        logoutFromProvider: true,
      });
    });
  });
});
