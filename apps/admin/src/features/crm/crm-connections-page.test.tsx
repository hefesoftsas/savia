import { cleanup, screen, waitFor } from "@testing-library/react";
import { render } from "../studio-engine/test/locale-test-render";
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
    expect(screen.queryByText("Sincronización automática")).toBeNull();
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
