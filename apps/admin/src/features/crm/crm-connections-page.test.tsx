import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { render as localeRender } from "../studio-engine/test/locale-test-render";
import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import {
  CrmConnectionsPage,
  type NangoConnectFactory,
} from "./crm-connections-page";

const tenantState = vi.hoisted(() => ({
  id: null as number | null,
  isLoading: false,
  scopeStatus: undefined as
    "platform" | "loading" | "resolved" | "error" | "unavailable" | undefined,
  scopeError: undefined as string | undefined,
  retry: undefined as (() => unknown) | undefined,
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
      tenantState.refreshes[topics.join(",")] = refresh;
      return { changed: false, reload: refresh, status: "connected" };
    },
  };
});

vi.mock("@/features/tenants/use-current-tenant", () => ({
  useCurrentTenant: () => ({
    id: tenantState.id,
    isPlatformAdmin: false,
    isLoading: tenantState.isLoading,
    scopeStatus: tenantState.scopeStatus,
    scopeError: tenantState.scopeError,
    retry: tenantState.retry,
  }),
}));

afterEach(() => {
  cleanup();
  tenantState.id = null;
  tenantState.isLoading = false;
  tenantState.scopeStatus = undefined;
  tenantState.scopeError = undefined;
  tenantState.retry = undefined;
  tenantState.refreshes = {};
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

const providers = [
  {
    id: "hubspot" as const,
    displayName: "HubSpot",
    availability: "enabled" as const,
    capabilities: ["contacts:read", "contacts:write"],
  },
  {
    id: "salesforce" as const,
    displayName: "Salesforce",
    availability: "coming_soon" as const,
    capabilities: [],
  },
  {
    id: "zoho" as const,
    displayName: "Zoho CRM",
    availability: "coming_soon" as const,
    capabilities: [],
  },
  {
    id: "pipedrive" as const,
    displayName: "Pipedrive",
    availability: "coming_soon" as const,
    capabilities: [],
  },
];

function createServices() {
  return {
    crm: {
      listProviders: vi.fn().mockResolvedValue(providers),
      listConnections: vi.fn().mockResolvedValue([]),
      createConnectSession: vi.fn().mockResolvedValue({
        token: "opaque-connect-session",
        expiresAt: "2026-01-01T01:00:00.000Z",
        connectUrl: "https://connect.nango.example.test",
        apiUrl: "https://nango.example.test",
      }),
      complete: vi.fn().mockResolvedValue({
        id: "connection-1",
        agencyId: 101,
        provider: "hubspot",
        status: "connected",
        externalAccountLabel: "Acme Insurance",
        scopes: [],
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Pick<AppServices, "crm">;
}

describe("CrmConnectionsPage", () => {
  it("loads user-owned CRM providers without selecting a tenant", async () => {
    const services = createServices();

    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Conexiones CRM" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(services.crm.listProviders).toHaveBeenCalledWith(undefined),
    );
    await waitFor(() =>
      expect(services.crm.listConnections).toHaveBeenCalledWith(undefined),
    );
    expect(screen.getByRole("button", { name: "Conectar" })).toBeVisible();
    expect(screen.getAllByText("Disponible próximamente")).toHaveLength(3);
    expect(screen.queryByText("Sincronización automática")).toBeNull();
  });

  it("retains the same CRM row while a background read fails", async () => {
    tenantState.id = 101;
    const services = createServices();
    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );
    const connect = await screen.findByRole("button", { name: "Conectar" });
    vi.mocked(services.crm.listProviders).mockRejectedValueOnce(
      new Error("Temporary CRM read failure"),
    );

    await act(async () => {
      await tenantState.refreshes.integrations?.();
    });
    await waitFor(() =>
      expect(services.crm.listConnections).toHaveBeenCalledTimes(2),
    );

    await waitFor(() =>
      expect(services.crm.listProviders).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByRole("button", { name: "Conectar" })).toBe(connect);
    expect(await screen.findByText(/Temporary CRM read failure/)).toBeVisible();
  });

  it("hides cached CRM rows after an access-denied refresh", async () => {
    tenantState.id = 101;
    const services = createServices();
    vi.mocked(services.crm.listConnections).mockResolvedValueOnce([
      {
        id: "connection-1",
        agencyId: 101,
        provider: "hubspot",
        status: "connected",
        externalAccountLabel: "Acme Insurance",
        scopes: [],
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );
    await screen.findByText("Acme Insurance");
    vi.mocked(services.crm.listConnections).mockRejectedValueOnce(
      Object.assign(new Error("Access revoked"), { status: 403 }),
    );

    await act(async () => {
      await tenantState.refreshes.integrations?.();
    });
    await waitFor(() =>
      expect(services.crm.listConnections).toHaveBeenCalledTimes(2),
    );

    expect(screen.queryByText("Acme Insurance")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conectar" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Access revoked");
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("blocks CRM reads while the dedicated tenant scope is unresolved", async () => {
    tenantState.scopeStatus = "error";
    tenantState.scopeError = "Unable to resolve this tenant.";
    tenantState.retry = vi.fn();
    const services = createServices();
    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to resolve this tenant.",
    );
    expect(services.crm.listProviders).not.toHaveBeenCalled();
    expect(services.crm.listConnections).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(tenantState.retry).toHaveBeenCalledOnce();
  });

  it("identifies every CRM with its accessible brand logo", async () => {
    const services = createServices();

    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Conectar" });
    for (const provider of providers) {
      expect(
        screen.getByRole("img", { name: `Logo de ${provider.displayName}` }),
      ).toBeVisible();
    }
  });

  it("completes a Nango connect event using only the opaque connection id", async () => {
    const user = userEvent.setup();
    tenantState.id = 101;
    const services = createServices();
    let onEvent: ((event: unknown) => void) | undefined;
    const nango: NangoConnectFactory = vi.fn(() => ({
      openConnectUI: ({
        onEvent: callback,
      }: {
        onEvent(event: unknown): void | Promise<void>;
        sessionToken: string;
        baseURL: string;
        apiURL: string;
      }) => {
        onEvent = callback;
      },
    }));

    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} nangoFactory={nango} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Conectar" });
    await user.click(screen.getByRole("button", { name: "Conectar" }));

    expect(services.crm.createConnectSession).toHaveBeenCalledWith(
      "hubspot",
      false,
      101,
    );
    onEvent?.({
      type: "connect",
      payload: { connectionId: "nango-connection-1" },
    });
    await waitFor(() =>
      expect(services.crm.complete).toHaveBeenCalledWith(
        "hubspot",
        "nango-connection-1",
        101,
      ),
    );
  });

  it("keeps OAuth completion bound to its starting tenant without replacing the new tenant state", async () => {
    const services = createServices();
    let resolveComplete!: (
      value: Awaited<ReturnType<typeof services.crm.complete>>,
    ) => void;
    const deferredComplete = new Promise<
      Awaited<ReturnType<typeof services.crm.complete>>
    >((resolve) => {
      resolveComplete = resolve;
    });
    vi.mocked(services.crm.complete).mockReturnValue(deferredComplete);
    vi.mocked(services.crm.listProviders).mockImplementation((agencyId) =>
      Promise.resolve(
        agencyId === 202
          ? [
              {
                ...providers[2],
                displayName: "CRM Destino",
                availability: "enabled",
              },
            ]
          : providers,
      ),
    );
    let onEvent: ((event: unknown) => void) | undefined;
    const nango: NangoConnectFactory = () => ({
      openConnectUI: ({ onEvent: callback }) => {
        onEvent = callback;
      },
    });
    const user = userEvent.setup();

    tenantState.id = 101;
    const { rerender } = render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} nangoFactory={nango} />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "Conectar" }));

    tenantState.id = 202;
    rerender(
      <MemoryRouter>
        <CrmConnectionsPage services={services} nangoFactory={nango} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("CRM Destino")).toBeVisible();

    onEvent?.({
      type: "connect",
      payload: { connectionId: "nango-connection-1" },
    });
    await waitFor(() =>
      expect(services.crm.complete).toHaveBeenCalledWith(
        "hubspot",
        "nango-connection-1",
        101,
      ),
    );
    resolveComplete({
      id: "connection-1",
      agencyId: 101,
      provider: "hubspot",
      status: "connected",
      externalAccountLabel: "Cuenta propia",
      scopes: [],
      lastValidatedAt: null,
      createdAt: "",
      updatedAt: "",
    });

    expect(
      await screen.findByRole("button", { name: "Conectar" }),
    ).toBeEnabled();
    expect(screen.getByText("CRM Destino")).toBeVisible();
    expect(services.crm.listProviders).toHaveBeenLastCalledWith(202);
    expect(services.crm.listConnections).toHaveBeenLastCalledWith(202);
  });

  it("scopes provider and connection loads to the selected tenant and reloads on switch", async () => {
    const services = createServices();
    tenantState.id = 101;
    const { rerender } = render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(services.crm.listProviders).toHaveBeenCalledWith(101);
      expect(services.crm.listConnections).toHaveBeenCalledWith(101);
    });

    tenantState.id = 202;
    rerender(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(services.crm.listProviders).toHaveBeenLastCalledWith(202);
      expect(services.crm.listConnections).toHaveBeenLastCalledWith(202);
    });
  });

  it("waits for tenant resolution and ignores an older tenant response", async () => {
    let resolveOldProviders!: (value: typeof providers) => void;
    let resolveOldConnections!: (value: []) => void;
    const oldProviders = new Promise<typeof providers>((resolve) => {
      resolveOldProviders = resolve;
    });
    const oldConnections = new Promise<[]>((resolve) => {
      resolveOldConnections = resolve;
    });
    const services = createServices();
    vi.mocked(services.crm.listProviders).mockImplementation((agencyId) =>
      agencyId === 101
        ? oldProviders
        : Promise.resolve([
            {
              ...providers[2],
              displayName: "CRM Destino",
              availability: "enabled",
            },
          ]),
    );
    vi.mocked(services.crm.listConnections).mockImplementation((agencyId) =>
      agencyId === 101 ? oldConnections : Promise.resolve([]),
    );

    tenantState.id = 101;
    tenantState.isLoading = true;
    const { rerender } = render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );
    expect(services.crm.listProviders).not.toHaveBeenCalled();

    tenantState.isLoading = false;
    rerender(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(services.crm.listProviders).toHaveBeenCalledWith(101),
    );

    tenantState.id = 202;
    tenantState.isLoading = true;
    rerender(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "Conectar" })).toBeNull();
    expect(services.crm.listProviders).toHaveBeenCalledTimes(1);

    tenantState.isLoading = false;
    rerender(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("CRM Destino")).toBeVisible();
    resolveOldProviders([providers[0]]);
    resolveOldConnections([]);

    await waitFor(() => {
      expect(screen.getByText("CRM Destino")).toBeVisible();
      expect(screen.queryByText("HubSpot")).toBeNull();
    });
    expect(services.crm.listProviders).toHaveBeenLastCalledWith(202);
    expect(services.crm.listConnections).toHaveBeenLastCalledWith(202);
  });

  it("blocks connection actions when another owner's CRM occupies the organization", async () => {
    const services = createServices();
    tenantState.id = 101;
    vi.mocked(services.crm.listProviders).mockResolvedValue([
      { ...providers[0], connectionBlocked: true, activeProvider: "zoho" },
      ...providers.slice(1),
    ]);

    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );

    const connect = await screen.findByRole("button", { name: "Conectar" });
    expect(connect).toBeDisabled();
    expect(
      await screen.findByText(
        "Desconecta el CRM actual de la organización antes de conectar otro.",
      ),
    ).toBeVisible();
    expect(services.crm.createConnectSession).not.toHaveBeenCalled();
  });

  it("keeps the owner's provider usable while blocking a different provider", async () => {
    const services = createServices();
    tenantState.id = 101;
    vi.mocked(services.crm.listProviders).mockResolvedValue([
      { ...providers[0], connectionBlocked: false, activeProvider: "hubspot" },
      {
        ...providers[1],
        availability: "enabled",
        connectionBlocked: true,
        activeProvider: "hubspot",
      },
      ...providers.slice(2),
    ]);
    vi.mocked(services.crm.listConnections).mockResolvedValue([
      {
        id: "connection-1",
        agencyId: 101,
        provider: "hubspot",
        status: "connected",
        externalAccountLabel: "Cuenta propia",
        scopes: [],
        lastValidatedAt: null,
        createdAt: "",
        updatedAt: "",
      },
    ]);

    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("button", { name: "Desconectar" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reconectar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Conectar" })).toBeDisabled();
  });

  it("disables every provider action while a connection flow is active", async () => {
    const services = createServices();
    tenantState.id = 101;
    vi.mocked(services.crm.listProviders).mockResolvedValue([
      providers[0],
      { ...providers[1], availability: "enabled" },
      ...providers.slice(2),
    ]);
    let onEvent: ((event: unknown) => void) | undefined;
    const user = userEvent.setup();
    const nango: NangoConnectFactory = () => ({
      openConnectUI: ({ onEvent: callback }) => {
        onEvent = callback;
      },
    });

    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} nangoFactory={nango} />
      </MemoryRouter>,
    );

    const connectButtons = await screen.findAllByRole("button", {
      name: "Conectar",
    });
    expect(connectButtons).toHaveLength(2);
    await user.click(connectButtons[0]);
    expect(connectButtons[1]).toBeDisabled();
    await user.click(connectButtons[1]);
    expect(services.crm.createConnectSession).toHaveBeenCalledTimes(1);

    onEvent?.({ type: "close" });
  });

  it.each(["pending", "reconnect_required", "failed"] as const)(
    "keeps a %s connection disconnectable to free the organization slot",
    async (status) => {
      const services = createServices();
      tenantState.id = 101;
      vi.mocked(services.crm.listConnections).mockResolvedValue([
        {
          id: "connection-1",
          agencyId: 101,
          provider: "hubspot",
          status,
          externalAccountLabel: "Cuenta propia",
          scopes: [],
          lastValidatedAt: null,
          createdAt: "",
          updatedAt: "",
        },
      ]);
      const user = userEvent.setup();

      render(
        <MemoryRouter>
          <CrmConnectionsPage services={services} />
        </MemoryRouter>,
      );

      await user.click(
        await screen.findByRole("button", { name: "Desconectar" }),
      );
      expect(services.crm.disconnect).toHaveBeenCalledWith("hubspot", 101);
    },
  );

  it("keeps the validation error when Nango closes after a connect event", async () => {
    const user = userEvent.setup();
    const services = createServices();
    services.crm.complete = vi
      .fn()
      .mockRejectedValue(new Error("No fue posible validar la conexión CRM."));
    let onEvent: ((event: unknown) => void) | undefined;
    const nango: NangoConnectFactory = vi.fn(() => ({
      openConnectUI: ({
        onEvent: callback,
      }: {
        onEvent(event: unknown): void | Promise<void>;
        sessionToken: string;
        baseURL: string;
        apiURL: string;
      }) => {
        onEvent = callback;
      },
    }));

    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} nangoFactory={nango} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Conectar" });
    await user.click(screen.getByRole("button", { name: "Conectar" }));

    onEvent?.({
      type: "connect",
      payload: { connectionId: "nango-connection-1" },
    });
    expect(
      await screen.findByText("No fue posible validar la conexión CRM."),
    ).toBeVisible();

    onEvent?.({ type: "close" });

    await waitFor(() =>
      expect(
        screen.getByText("No fue posible validar la conexión CRM."),
      ).toBeVisible(),
    );
    expect(
      screen.queryByText("La ventana de conexión se cerró sin cambios."),
    ).not.toBeInTheDocument();
  });

  it("shows CRM providers in the embedded integrations layout", async () => {
    const services = createServices();

    render(
      <MemoryRouter>
        <CrmConnectionsPage embedded services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "CRM", level: 2 }),
    ).toBeVisible();
    expect(
      await screen.findByRole("button", { name: "Conectar" }),
    ).toBeVisible();
  });
});

it("reauthorizes an active CRM connection without disconnecting it", async () => {
  const services = createServices();
  vi.mocked(services.crm.listConnections).mockResolvedValue([
    {
      id: "connection-1",
      agencyId: 101,
      provider: "hubspot",
      status: "connected",
      externalAccountLabel: "HubSpot",
      scopes: [],
      lastValidatedAt: null,
      createdAt: "",
      updatedAt: "",
    },
  ]);
  const openConnectUI = vi.fn();
  render(
    <MemoryRouter>
      <CrmConnectionsPage
        services={services}
        nangoFactory={() => ({ openConnectUI })}
      />
    </MemoryRouter>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Reconectar" }),
  );
  expect(services.crm.createConnectSession).toHaveBeenCalledWith(
    "hubspot",
    true,
    undefined,
  );
  expect(services.crm.disconnect).not.toHaveBeenCalled();
  expect(openConnectUI).toHaveBeenCalled();
});
