import { cleanup, screen, waitFor } from "@testing-library/react";
import { render } from "../studio-engine/test/locale-test-render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppServices } from "@/app-services";
import {
  WhatsappConnectionsPage,
  type WhatsappNangoConnectFactory,
} from "./whatsapp-connections-page";

const tenantState = vi.hoisted(() => ({
  id: null as number | null,
  isLoading: false,
}));

vi.mock("@/features/tenants/use-current-tenant", () => ({
  useCurrentTenant: () => ({
    id: tenantState.id,
    isPlatformAdmin: false,
    isLoading: tenantState.isLoading,
  }),
}));

afterEach(() => {
  cleanup();
  tenantState.id = null;
  tenantState.isLoading = false;
});

function createServices() {
  return {
    whatsapp: {
      listProviders: vi.fn().mockResolvedValue([
        {
          id: "whatsapp",
          displayName: "WhatsApp",
          availability: "enabled",
          capabilities: ["messages:write"],
        },
      ]),
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
        provider: "whatsapp",
        status: "connected",
        phoneNumberId: null,
        displayPhoneNumber: null,
        wabaId: null,
        externalAccountLabel: null,
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      updateNumber: vi.fn(),
      testSend: vi.fn(),
      getAssistant: vi.fn().mockResolvedValue({
        settings: null,
        employees: [],
        webhookReady: false,
      }),
      updateAssistant: vi.fn(),
      getNative: vi.fn().mockResolvedValue({
        configuration: {
          replyButtons: false,
          listMessages: false,
          mediaUnderstanding: false,
          readReceipts: false,
          typingIndicator: false,
          flows: [],
          catalogs: [],
          templates: [],
          media: [],
          locations: [],
        },
        configured: false,
        contributions: [],
      }),
      updateNative: vi.fn().mockResolvedValue({}),
      listNativeAssets: vi.fn().mockResolvedValue({ flows: [], templates: [] }),
      sendNativeMessage: vi.fn().mockResolvedValue({ messageId: "wamid.test" }),
      uploadNativeMedia: vi.fn().mockResolvedValue({
        mediaId: "12345",
        type: "image/png",
        filename: "image.png",
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Pick<AppServices, "whatsapp">;
}

describe("WhatsappConnectionsPage", () => {
  it("renders the WhatsApp integration with its brand logo", async () => {
    const services = createServices();

    render(
      <MemoryRouter>
        <WhatsappConnectionsPage services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "WhatsApp", level: 1 }),
    ).toBeVisible();
    await waitFor(() =>
      expect(services.whatsapp.listProviders).toHaveBeenCalledWith(undefined),
    );
    expect(screen.getByRole("img", { name: "Logo de WhatsApp" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Conectar" })).toBeVisible();
  });

  it("completes a Nango connect event using only the opaque connection id", async () => {
    const user = userEvent.setup();
    tenantState.id = 101;
    const services = createServices();
    let onEvent: ((event: unknown) => void) | undefined;
    const nango: WhatsappNangoConnectFactory = vi.fn(() => ({
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
        <WhatsappConnectionsPage services={services} nangoFactory={nango} />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Conectar" });
    await user.click(screen.getByRole("button", { name: "Conectar" }));

    expect(services.whatsapp.createConnectSession).toHaveBeenCalledWith(
      false,
      101,
    );
    onEvent?.({
      type: "connect",
      payload: { connectionId: "nango-connection-1" },
    });
    await waitFor(() =>
      expect(services.whatsapp.complete).toHaveBeenCalledWith(
        "nango-connection-1",
        { agencyId: 101 },
      ),
    );
  });

  it("shows number linking and test send once connected", async () => {
    tenantState.id = 101;
    const services = createServices();
    vi.mocked(services.whatsapp.listConnections).mockResolvedValue([
      {
        id: "connection-1",
        agencyId: 101,
        provider: "whatsapp",
        status: "connected",
        phoneNumberId: "123456789012345",
        displayPhoneNumber: "+573001234567",
        wabaId: "987654321098765",
        externalAccountLabel: "Acme",
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    render(
      <MemoryRouter>
        <WhatsappConnectionsPage services={services} />
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Desconectar" });
    expect(screen.getByText("+573001234567 · Acme")).toBeVisible();
    expect(screen.getByRole("button", { name: "Enviar prueba" })).toBeVisible();
  });

  it("keeps a saved assistant available to disable after disconnect", async () => {
    const user = userEvent.setup();
    tenantState.id = 101;
    const services = createServices();
    vi.mocked(services.whatsapp.listConnections).mockResolvedValue([
      {
        id: "connection-1",
        agencyId: 101,
        provider: "whatsapp",
        status: "disconnected",
        phoneNumberId: null,
        displayPhoneNumber: null,
        wabaId: null,
        externalAccountLabel: null,
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(services.whatsapp.getAssistant).mockResolvedValue({
      settings: {
        connectionId: "connection-1",
        tenantId: 101,
        employeeId: "employee-1",
        enabled: true,
        allowedContacts: ["573001234567"],
        updatedBy: "admin-1",
      },
      employees: [{ id: "employee-1", name: "Asistente de soporte" }],
      webhookReady: false,
    });

    render(
      <MemoryRouter>
        <WhatsappConnectionsPage services={services} />
      </MemoryRouter>,
    );

    const assistantToggle = await screen.findByRole("checkbox", {
      name: "Responder con IA",
    });
    expect(assistantToggle).toBeChecked();
    expect(assistantToggle).toBeEnabled();
    expect(
      screen.getByText("Asistente de WhatsApp", { selector: "h2" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Enviar prueba" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "WhatsApp nativo" }),
    ).toBeNull();

    await user.click(assistantToggle);
    await user.click(screen.getByRole("button", { name: "Guardar asistente" }));
    await waitFor(() =>
      expect(services.whatsapp.updateAssistant).toHaveBeenCalledWith({
        agencyId: 101,
        employeeId: "employee-1",
        enabled: false,
        allowedContacts: ["+573001234567"],
      }),
    );
  });

  it("keeps the connected integration usable when the native settings request fails", async () => {
    tenantState.id = 101;
    const services = createServices();
    vi.mocked(services.whatsapp.listConnections).mockResolvedValue([
      {
        id: "connection-1",
        agencyId: 101,
        provider: "whatsapp",
        status: "connected",
        phoneNumberId: "123456789012345",
        displayPhoneNumber: "+573001234567",
        wabaId: "987654321098765",
        externalAccountLabel: null,
        lastValidatedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(services.whatsapp.getNative).mockRejectedValue(
      new Error("Native settings are not available"),
    );

    render(
      <MemoryRouter>
        <WhatsappConnectionsPage services={services} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Native settings are not available"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Enviar prueba" })).toBeVisible();
  });
});
