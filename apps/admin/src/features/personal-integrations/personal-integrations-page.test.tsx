import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { ApiClientError } from "@/api/api-client";
import {
  PersonalIntegrationsPage,
  type PersonalNangoConnectFactory,
} from "./personal-integrations-page";

afterEach(cleanup);

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
  it("combines personal accounts and private CRM connections in one integrations screen", async () => {
    const services = createServices();

    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Integraciones" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Google" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Microsoft" })).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: "CRM" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Logo de Google Calendar")).toBeVisible();
    expect(screen.getByLabelText("Logo de HubSpot")).toBeVisible();
  });

  it("loads user-owned CRM connections alongside personal integrations", async () => {
    const services = createServices();

    render(
      <MemoryRouter>
        <PersonalIntegrationsPage services={services} />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Integraciones" });
    await waitFor(() => expect(services.crm.listProviders).toHaveBeenCalledWith());
    await waitFor(() =>
      expect(services.crm.listConnections).toHaveBeenCalledWith(),
    );
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
    expect(screen.getByRole("heading", { name: "Google" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Microsoft" })).toBeVisible();
    for (const provider of providers) {
      expect(screen.getByText(provider.displayName)).toBeVisible();
      expect(
        screen.getByRole("img", { name: `Logo de ${provider.displayName}` }),
      ).toBeVisible();
    }
  });

  it("keeps the six integrations visible and offers retry when their status cannot load", async () => {
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
    expect(
      screen.getAllByRole("button", { name: "No disponible" }),
    ).toHaveLength(6);
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
    await user.click(screen.getAllByRole("button", { name: "Conectar" })[0]);

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
