import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import {
  CrmConnectionsPage,
  type NangoConnectFactory,
} from "./crm-connections-page";

afterEach(cleanup);

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
  it("enables automatic HubSpot create/update for an explicitly selected tenant", async () => {
    const user = userEvent.setup();
    const services = createServices();
    Object.assign(services.crm, {
      listSyncRules: vi.fn().mockResolvedValue({
        rules: [],
        tenants: [{ id: 101, name: "Agencia Norte" }],
      }),
      createSyncRule: vi
        .fn()
        .mockResolvedValue({ id: "rule-1", enabled: true }),
      setSyncRuleEnabled: vi.fn(),
      deleteSyncRule: vi.fn(),
      listSyncJobs: vi.fn().mockResolvedValue([]),
      retrySyncJob: vi.fn(),
    });
    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );

    await user.selectOptions(await screen.findByLabelText("Tenant"), "101");
    await user.click(
      screen.getByRole("button", { name: "Activar sincronización" }),
    );

    expect(services.crm.createSyncRule).toHaveBeenCalledWith(101);
    expect(screen.getByText(/clientes nuevos y actualizados/i)).toBeVisible();
    expect(screen.getByText(/no elimina/i)).toBeVisible();
  });

  it("shows sync failures and only links trusted HubSpot job URLs", async () => {
    const services = createServices();
    Object.assign(services.crm, {
      listSyncRules: vi.fn().mockResolvedValue({ rules: [], tenants: [] }),
      createSyncRule: vi.fn(),
      setSyncRuleEnabled: vi.fn(),
      deleteSyncRule: vi.fn(),
      listSyncJobs: vi.fn().mockResolvedValue([
        {
          id: "safe",
          customerId: 42,
          status: "failed",
          lastError: "CRM_CONNECTION_NOT_READY",
          externalUrl: "https://app.hubspot.com/contacts/1/record/0-1/2",
        },
        {
          id: "unsafe",
          customerId: 43,
          status: "synced",
          lastError: null,
          externalUrl: "https://evil.test/customer/43",
        },
      ]),
      retrySyncJob: vi
        .fn()
        .mockRejectedValue(new Error("La regla está pausada.")),
    });
    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByText("Estado reciente (2)"));
    expect(await screen.findByText(/requiere conexión/i)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Ver en HubSpot" }),
    ).toHaveAttribute(
      "href",
      "https://app.hubspot.com/contacts/1/record/0-1/2",
    );
    expect(screen.getByText(/Cliente 43: Sincronizado/)).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: "Ver en HubSpot" }),
    ).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La regla está pausada.",
    );
  });

  it("deletes an active synchronization rule after confirmation", async () => {
    const user = userEvent.setup();
    const services = createServices();
    const rule = {
      id: "rule-1",
      tenantId: 101,
      tenantName: "Agencia Norte",
      provider: "hubspot" as const,
      accountLabel: "HubSpot 51969008",
      enabled: true,
      connectionId: "conn-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    Object.assign(services.crm, {
      listSyncRules: vi
        .fn()
        .mockResolvedValueOnce({
          rules: [rule],
          tenants: [{ id: 101, name: "Agencia Norte" }],
        })
        .mockResolvedValueOnce({
          rules: [],
          tenants: [{ id: 101, name: "Agencia Norte" }],
        }),
      createSyncRule: vi.fn(),
      setSyncRuleEnabled: vi.fn(),
      deleteSyncRule: vi.fn().mockResolvedValue(undefined),
      listSyncJobs: vi.fn().mockResolvedValue([]),
      retrySyncJob: vi.fn(),
    });

    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/HubSpot 51969008 · Activada/),
    ).toBeVisible();

    const deleteBtn = screen.getByRole("button", {
      name: /eliminar sincronización de agencia norte/i,
    });
    await user.click(deleteBtn);

    expect(
      screen.getByRole("heading", { name: "Eliminar sincronización" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /¿Estás seguro de que deseas eliminar la sincronización automática para Agencia Norte\?/i,
      ),
    ).toBeVisible();

    const confirmBtn = screen.getByRole("button", { name: "Eliminar" });
    await user.click(confirmBtn);

    expect(services.crm.deleteSyncRule).toHaveBeenCalledWith("rule-1");
    expect(await screen.findByText("Sincronización eliminada.")).toBeVisible();
  });

  it("cancels deletion when dismissed from the confirmation dialog", async () => {
    const user = userEvent.setup();
    const services = createServices();
    const rule = {
      id: "rule-1",
      tenantId: 101,
      tenantName: "Agencia Norte",
      provider: "hubspot" as const,
      accountLabel: "HubSpot 51969008",
      enabled: true,
      connectionId: "conn-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    Object.assign(services.crm, {
      listSyncRules: vi.fn().mockResolvedValue({
        rules: [rule],
        tenants: [{ id: 101, name: "Agencia Norte" }],
      }),
      createSyncRule: vi.fn(),
      setSyncRuleEnabled: vi.fn(),
      deleteSyncRule: vi.fn().mockResolvedValue(undefined),
      listSyncJobs: vi.fn().mockResolvedValue([]),
      retrySyncJob: vi.fn(),
    });

    render(
      <MemoryRouter>
        <CrmConnectionsPage services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/HubSpot 51969008 · Activada/),
    ).toBeVisible();

    const deleteBtn = screen.getByRole("button", {
      name: /eliminar sincronización de agencia norte/i,
    });
    await user.click(deleteBtn);

    expect(
      screen.getByRole("heading", { name: "Eliminar sincronización" }),
    ).toBeVisible();

    const cancelBtn = screen.getByRole("button", { name: "Cancelar" });
    await user.click(cancelBtn);

    expect(services.crm.deleteSyncRule).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Eliminar sincronización" }),
    ).not.toBeInTheDocument();
  });

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
      expect(services.crm.listProviders).toHaveBeenCalledWith(),
    );
    await waitFor(() =>
      expect(services.crm.listConnections).toHaveBeenCalledWith(),
    );
    expect(screen.getByRole("button", { name: "Conectar" })).toBeVisible();
    expect(screen.getAllByText("Disponible próximamente")).toHaveLength(3);
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
    );
    onEvent?.({
      type: "connect",
      payload: { connectionId: "nango-connection-1" },
    });
    await waitFor(() =>
      expect(services.crm.complete).toHaveBeenCalledWith(
        "hubspot",
        "nango-connection-1",
      ),
    );
  });

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
    expect(screen.getByRole("button", { name: "Conectar" })).toBeVisible();
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
  );
  expect(services.crm.disconnect).not.toHaveBeenCalled();
  expect(openConnectUI).toHaveBeenCalled();
});
