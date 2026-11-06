import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { render as localeRender } from "../studio-engine/test/locale-test-render";
import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { ApiClientError } from "@/api/api-client";
import {
  PersonalIntegrationsPage,
  type PersonalNangoConnectFactory,
} from "./personal-integrations-page";

const realtime = vi.hoisted(() => ({
  refreshes: {} as Record<string, () => unknown>,
}));

vi.mock("@/realtime/use-realtime-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/realtime/use-realtime-query")>();
  const { useQueryClient } = await import("@tanstack/react-query");
  return {
    ...actual,
    useRealtimeQuery: ({
      topics,
      queryKeys,
    }: {
      topics: string[];
      queryKeys: readonly QueryKey[];
    }) => {
      const client = useQueryClient();
      const refresh = () =>
        Promise.all(
          queryKeys.map((queryKey) =>
            client.invalidateQueries({ queryKey, exact: true }),
          ),
        );
      realtime.refreshes[topics.join(",")] = refresh;
      return { changed: false, reload: refresh, status: "connected" };
    },
  };
});

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return localeRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  realtime.refreshes = {};
});

const providers = [
  {
    id: "google_drive",
    displayName: "Google Drive",
    availability: "enabled",
    capabilities: ["files:read"],
  },
  {
    id: "gmail",
    displayName: "Gmail",
    availability: "enabled",
    capabilities: ["messages:read", "messages:send"],
  },
  {
    id: "google_calendar",
    displayName: "Google Calendar",
    availability: "enabled",
    capabilities: ["events:read", "events:create"],
  },
  {
    id: "outlook",
    displayName: "Outlook",
    availability: "enabled",
    capabilities: [
      "messages:read",
      "messages:send",
      "events:read",
      "events:create",
    ],
  },
  {
    id: "onedrive_personal",
    displayName: "OneDrive Personal",
    availability: "enabled",
    capabilities: ["files:read"],
  },
  {
    id: "onedrive_business",
    displayName: "OneDrive for Business",
    availability: "enabled",
    capabilities: ["files:read"],
  },
  {
    id: "jira",
    displayName: "Jira Cloud",
    availability: "enabled",
    capabilities: ["issues:read"],
  },
  {
    id: "linear",
    displayName: "Linear",
    availability: "enabled",
    capabilities: ["issues:read"],
  },
  {
    id: "github",
    displayName: "GitHub",
    availability: "enabled",
    capabilities: ["issues:read"],
  },
  {
    id: "slack",
    displayName: "Slack",
    availability: "enabled",
    capabilities: ["messages:send"],
  },
  {
    id: "microsoft_teams",
    displayName: "Microsoft Teams",
    availability: "enabled",
    capabilities: ["messages:send"],
  },
] as const;

function createServices() {
  return {
    personalIntegrations: {
      listProviders: vi.fn().mockResolvedValue(providers),
      listConnections: vi.fn().mockResolvedValue([]),
      createConnectSession: vi.fn().mockResolvedValue({
        token: "opaque-connect-session",
        expiresAt: "2026-01-01T01:00:00.000Z",
        connectUrl: "https://connect.nango.example.test",
        apiUrl: "https://nango.example.test",
      }),
      previewIssue: vi.fn(),
      complete: vi.fn().mockResolvedValue({
        id: "connection-1",
        provider: "google_drive",
        status: "connected",
        externalAccountLabel: "member@example.com",
        scopes: [],
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    },
    dataProvider: {
      getList: vi.fn().mockResolvedValue({
        data: [{ id: 101, name: "Acme Brokers" }],
      }),
    },
    authProvider: {
      canAccess: vi.fn().mockResolvedValue(true),
    },
    crm: {
      listProviders: vi.fn().mockResolvedValue([
        {
          id: "hubspot",
          displayName: "HubSpot",
          availability: "enabled",
          capabilities: ["contacts:read", "contacts:write"],
        },
      ]),
      listConnections: vi.fn().mockResolvedValue([]),
      complete: vi.fn(),
      disconnect: vi.fn(),
    },
    virtualEmployees: {
      list: vi.fn().mockResolvedValue([
        {
          id: "emp-1",
          name: "Sofía",
          handle: "ventas",
          position: "Especialista en Ventas",
          avatar: "briefcase",
          status: "active",
          systemPrompt: "Eres Sofía de ventas.",
          allowedCollections: ["customers", "quotes"],
          filesCount: 2,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ]),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      uploadFile: vi.fn(),
      deleteFile: vi.fn(),
    },
    assistantConfiguration: {
      models: vi.fn().mockResolvedValue([]),
      summary: vi.fn().mockResolvedValue(null),
    },
  } as unknown as Pick<
    AppServices,
    | "personalIntegrations"
    | "dataProvider"
    | "authProvider"
    | "crm"
    | "virtualEmployees"
    | "assistantConfiguration"
  >;
}

describe("PersonalIntegrationsPage", () => {
  it("uses the current ChatGPT Apps setup routes in its connection guide", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/integrations?tab=ai-assistants"]}>
        <PersonalIntegrationsPage services={createServices()} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Integraciones" }),
    ).toBeVisible();
    expect(
      screen.getByRole("tab", { name: "ChatGPT y Claude" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText(
        /ChatGPT Business.*Configuración del espacio de trabajo/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/Abre Apps\/Aplicaciones, elige Crear/),
    ).toBeVisible();
    expect(screen.queryByText(/Seguridad e inicio de sesión/)).toBeNull();
    expect(screen.queryByText(/Abre Plugins/)).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Aplicaciones" }));
    expect(
      await screen.findByRole("heading", { name: "Savia Companion" }),
    ).toBeVisible();
  });

  it("opens the applications tab from its URL and keeps other integration tabs available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/integrations?tab=apps"]}>
        <PersonalIntegrationsPage services={createServices()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("tab", { name: "Aplicaciones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await screen.findByText(
        "Todavía no hay una versión de Companion publicada para descargar.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Cuentas y Conexiones" }));
    expect(
      await screen.findByRole("heading", { name: "Google" }),
    ).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Aplicaciones" }));
    expect(
      await screen.findByRole("heading", { name: "Savia Companion" }),
    ).toBeVisible();
  });

  it("combines personal accounts and private CRM connections in one integrations screen", async () => {
    const services = createServices();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Integraciones" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: "Google" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Microsoft" })).toBeVisible();
    expect(screen.getByLabelText("Logo de Google Calendar")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "CRM" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "CRM" }));
    expect(await screen.findByRole("heading", { name: "CRM" })).toBeVisible();
    expect(screen.getByLabelText("Logo de HubSpot")).toBeVisible();
  });

  it("loads user-owned CRM connections alongside personal integrations", async () => {
    const services = createServices();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Integraciones" });
    await user.click(screen.getByRole("tab", { name: "CRM" }));
    await waitFor(() =>
      expect(services.crm.listProviders).toHaveBeenCalledWith(undefined),
    );
    await waitFor(() =>
      expect(services.crm.listConnections).toHaveBeenCalledWith(undefined),
    );
  });

  it("does not reload CRM when the parent recreates its services wrapper", async () => {
    const services = createServices();
    const { rerender } = render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "CRM" }));
    await waitFor(() =>
      expect(services.crm.listProviders).toHaveBeenCalledTimes(1),
    );

    rerender(
      <MemoryRouter>
        <PersonalIntegrationsPage services={{ ...services }} />
      </MemoryRouter>,
    );

    expect(services.crm.listProviders).toHaveBeenCalledTimes(1);
    expect(services.crm.listConnections).toHaveBeenCalledTimes(1);
  });

  it("retains loaded connections and row identity during a failed background refresh", async () => {
    const services = createServices();
    vi.mocked(
      services.personalIntegrations.listConnections,
    ).mockResolvedValueOnce([
      {
        id: "connection-1",
        provider: "google_drive",
        status: "connected",
        externalAccountLabel: "member@example.com",
        scopes: [],
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} />
      </MemoryRouter>,
    );
    await screen.findByText(/member@example.com/);
    const connection = screen.getByText(/member@example.com/);
    vi.mocked(
      services.personalIntegrations.listConnections,
    ).mockRejectedValueOnce(new Error("Temporary read failure"));

    await act(async () => {
      await realtime.refreshes["personal-integrations"]?.();
    });
    await waitFor(() =>
      expect(
        services.personalIntegrations.listConnections,
      ).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByText(/member@example.com/)).toBe(connection);
    expect(
      await screen.findByText(
        /No pudimos cargar el estado de las integraciones/,
      ),
    ).toBeVisible();
  });

  it("hides cached personal connections after an access-denied refresh", async () => {
    const services = createServices();
    vi.mocked(
      services.personalIntegrations.listConnections,
    ).mockResolvedValueOnce([
      {
        id: "connection-1",
        provider: "google_drive",
        status: "connected",
        externalAccountLabel: "member@example.com",
        scopes: [],
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} />
      </MemoryRouter>,
    );
    await screen.findByText(/member@example.com/);
    vi.mocked(
      services.personalIntegrations.listConnections,
    ).mockRejectedValueOnce(
      Object.assign(new Error("Access revoked"), { status: 403 }),
    );

    await act(async () => {
      await realtime.refreshes["personal-integrations"]?.();
    });
    await waitFor(() =>
      expect(
        services.personalIntegrations.listConnections,
      ).toHaveBeenCalledTimes(2),
    );

    expect(screen.queryByText(/member@example.com/)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos cargar el estado de las integraciones.",
    );
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("shows the six personal Google and Microsoft integrations", async () => {
    const services = createServices();

    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Integraciones" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: "Google" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Microsoft" })).toBeVisible();
    for (const provider of providers) {
      expect(screen.getByText(provider.displayName)).toBeVisible();
      expect(
        screen.getByRole("img", { name: `Logo de ${provider.displayName}` }),
      ).toBeVisible();
    }
  });

  it("shows Slack and Teams with their channel-sharing capability", async () => {
    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={createServices()} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Colaboración" }),
    ).toBeVisible();
    for (const name of ["Slack", "Microsoft Teams"]) {
      expect(screen.getByText(name)).toBeVisible();
      expect(
        screen.getByRole("img", { name: `Logo de ${name}` }),
      ).toBeVisible();
    }
    expect(
      screen.getByText("Comparte resúmenes de registros en canales de Slack."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Comparte resúmenes de registros en canales de Microsoft Teams.",
      ),
    ).toBeVisible();
  });

  it("shows unavailable issue providers without deployment instructions", async () => {
    const services = createServices();
    vi.mocked(services.personalIntegrations.listProviders).mockResolvedValue(
      providers.map((provider) => ({
        ...provider,
        capabilities: [...provider.capabilities],
        availability:
          provider.id === "jira" ||
          provider.id === "linear" ||
          provider.id === "github"
            ? "unavailable"
            : "enabled",
      })),
    );

    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        "Un administrador debe habilitar Jira en Nango. Después podrás conectar tu cuenta aquí.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Un administrador debe habilitar Linear en Nango. Después podrás conectar tu cuenta aquí.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Un administrador debe habilitar GitHub en Nango. Después podrás conectar tu cuenta aquí.",
      ),
    ).toBeVisible();
    expect(screen.getAllByText("Requiere configuración")).toHaveLength(3);
    expect(
      screen.getAllByRole("button", { name: "No disponible" }),
    ).toHaveLength(3);
    expect(screen.queryByText("Ver configuración")).not.toBeInTheDocument();
  });

  it("shows connected and reconnect-required states for issue trackers", async () => {
    const services = createServices();
    vi.mocked(services.personalIntegrations.listConnections).mockResolvedValue([
      {
        id: "jira-connection",
        provider: "jira",
        status: "reconnect_required",
        externalAccountLabel: null,
        scopes: [],
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "linear-connection",
        provider: "linear",
        status: "connected",
        externalAccountLabel: "acme",
        scopes: [],
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(
        "La sesión expiró. Vuelve a conectar para continuar usándola.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Conectado como acme.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reconectar" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeVisible();
  });

  it("keeps all twelve integrations visible and offers retry when their status cannot load", async () => {
    const user = userEvent.setup();
    const services = createServices();
    const missingRoute = new ApiClientError(404, "NOT_FOUND", "Not found");
    vi.mocked(services.personalIntegrations.listProviders).mockRejectedValue(
      missingRoute,
    );
    vi.mocked(services.personalIntegrations.listConnections).mockRejectedValue(
      missingRoute,
    );

    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("alert", {
        name: "La API que está en ejecución aún no incluye las integraciones personales. Reinicia Savia desde la versión actual.",
      }),
    ).toBeVisible();
    for (const provider of providers) {
      expect(screen.getByText(provider.displayName)).toBeVisible();
    }
    expect(screen.getAllByText("Zoom")).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "No disponible" }),
    ).toHaveLength(12);
    expect(
      screen.queryByText("No hay integraciones disponibles."),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() =>
      expect(services.personalIntegrations.listProviders).toHaveBeenCalledTimes(
        2,
      ),
    );
  });

  it("completes a connection using only Nango's opaque connection id", async () => {
    const user = userEvent.setup();
    const services = createServices();
    let onEvent: ((event: unknown) => void | Promise<void>) | undefined;
    const nango: PersonalNangoConnectFactory = vi.fn(() => ({
      openConnectUI: ({
        onEvent: callback,
      }: {
        sessionToken: string;
        baseURL: string;
        apiURL: string;
        onEvent(event: unknown): void | Promise<void>;
      }) => {
        onEvent = callback;
      },
    }));

    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} nangoFactory={nango} />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Integraciones" });
    await user.click(
      (await screen.findAllByRole("button", { name: "Conectar" }))[0]!,
    );

    expect(
      services.personalIntegrations.createConnectSession,
    ).toHaveBeenCalledWith("google_drive", false);
    await onEvent?.({
      type: "connect",
      payload: { connectionId: "nango-connection-1" },
    });
    await waitFor(() =>
      expect(services.personalIntegrations.complete).toHaveBeenCalledWith(
        "google_drive",
        "nango-connection-1",
      ),
    );
  });

  it("renders virtual employees tab and displays registered employees", async () => {
    const user = userEvent.setup();
    const services = createServices();

    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Integraciones" });
    const tab = screen.getByRole("tab", { name: /empleados virtuales/i });
    expect(tab).toBeVisible();

    await user.click(tab);

    expect(await screen.findByText("Sofía")).toBeVisible();
    expect(screen.getByText("@ventas")).toBeVisible();
    expect(screen.getByText("Especialista en Ventas")).toBeVisible();
  });
});

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Current URL">{location.search}</output>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}

it("opens employee deep links and preserves query context and history when switching tabs", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter
      initialEntries={["/my-integrations?domain=demo&tab=virtual-employees"]}
    >
      <NavigationProbe />
      <PersonalIntegrationsPage services={createServices()} />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Sofía")).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "Cuentas y Conexiones" }));
  expect(screen.getByLabelText("Current URL")).toHaveTextContent(
    "?domain=demo&tab=connections",
  );
  await user.click(screen.getByRole("tab", { name: "CRM" }));
  expect(screen.getByLabelText("Current URL")).toHaveTextContent(
    "?domain=demo&tab=crm",
  );
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Current URL")).toHaveTextContent(
    "?domain=demo&tab=connections",
  );
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByText("Sofía")).toBeVisible();
});
