import { act, cleanup, screen, waitFor } from "@testing-library/react";
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

const realtime = vi.hoisted(() => ({
  refresh: undefined as undefined | (() => void | Promise<unknown>),
}));

vi.mock("@/realtime/use-realtime-refresh", () => ({
  useRealtimeRefresh: (options: { refresh: () => void | Promise<unknown> }) => {
    realtime.refresh = options.refresh;
    return { changed: false, status: "live", reload: options.refresh };
  },
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
  realtime.refresh = undefined;
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
      getChannel: vi.fn().mockResolvedValue({
        configuration: {
          routingEnabled: false,
          tasks: [],
          staff: [],
          internalCapabilities: [],
          externalCapabilities: [],
        },
        employees: [],
        members: [],
      }),
      updateChannel: vi.fn(),
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
  it("preserves edited number fields while refreshing untouched fields", async () => {
    tenantState.id = 101;
    const user = userEvent.setup();
    const services = createServices();
    const connection = {
      ...(await services.whatsapp.complete("connection-1", { agencyId: 101 })),
      phoneNumberId: "12345",
      displayPhoneNumber: "+573001234567",
      wabaId: "54321",
    };
    vi.mocked(services.whatsapp.listConnections).mockResolvedValue([
      connection,
    ]);
    render(
      <MemoryRouter>
        <WhatsappConnectionsPage services={services} />
      </MemoryRouter>,
    );
    const phone = await screen.findByRole("textbox", {
      name: "Phone number ID",
    });
    await user.clear(phone);
    await user.type(phone, "99999");
    vi.mocked(services.whatsapp.listConnections).mockResolvedValue([
      {
        ...connection,
        phoneNumberId: "77777",
        displayPhoneNumber: "+573007654321",
        wabaId: "88888",
      },
    ]);
    await act(async () => {
      await realtime.refresh?.();
    });
    expect(
      screen.getByRole("textbox", { name: "Phone number ID" }),
    ).toHaveValue("99999");
    expect(screen.getByRole("textbox", { name: "Número visible" })).toHaveValue(
      "+573007654321",
    );
    expect(screen.getByRole("textbox", { name: "WABA ID" })).toHaveValue(
      "88888",
    );
  });

  it("ignores an old tenant background response after switching tenants", async () => {
    tenantState.id = 101;
    const services = createServices();
    const connection = await services.whatsapp.complete("connection-1", {
      agencyId: 101,
    });
    vi.mocked(services.whatsapp.listConnections).mockResolvedValue([
      connection,
    ]);
    const page = () => (
      <MemoryRouter>
        <WhatsappConnectionsPage services={services} />
      </MemoryRouter>
    );
    const { rerender } = render(page());
    await screen.findByRole("tab", { name: "Avanzado" });
    let resolveOld!: (value: (typeof connection)[]) => void;
    vi.mocked(services.whatsapp.listConnections).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = Promise.resolve(realtime.refresh?.());
    });
    tenantState.id = 202;
    vi.mocked(services.whatsapp.listConnections).mockResolvedValue([
      { ...connection, agencyId: 202, displayPhoneNumber: "+573007654321" },
    ]);
    rerender(page());
    expect(screen.queryByRole("tab", { name: "Avanzado" })).toBeNull();
    await screen.findByText("+573007654321");
    await act(async () => {
      resolveOld([{ ...connection, displayPhoneNumber: "+573001234567" }]);
      await pending;
    });
    expect(screen.getByText("+573007654321")).toBeVisible();
    expect(screen.queryByText("+573001234567")).toBeNull();
    expect(services.whatsapp.listConnections).toHaveBeenLastCalledWith(202);
  });

  it("does not reload or reset drafts when a parent recreates the services wrapper", async () => {
    tenantState.id = 101;
    const user = userEvent.setup();
    const services = createServices();
    const page = () => (
      <MemoryRouter>
        <WhatsappConnectionsPage services={{ whatsapp: services.whatsapp }} />
      </MemoryRouter>
    );
    const { rerender } = render(page());
    await user.click(await screen.findByRole("tab", { name: "Asistente IA" }));
    await user.type(
      await screen.findByRole("textbox", { name: "Contactos de prueba" }),
      "+573028648594",
    );
    rerender(page());
    await waitFor(() =>
      expect(services.whatsapp.listProviders).toHaveBeenCalledTimes(1),
    );
    expect(services.whatsapp.getAssistant).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("textbox", { name: "Contactos de prueba" }),
    ).toHaveValue("+573028648594");
    expect(screen.getByRole("tab", { name: "Asistente IA" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps the selected form and drafts mounted during background refresh and failure", async () => {
    tenantState.id = 101;
    const user = userEvent.setup();
    const services = createServices();
    const connection = await services.whatsapp.complete("connection-1", {
      agencyId: 101,
    });
    vi.mocked(services.whatsapp.listConnections).mockResolvedValue([
      connection,
    ]);
    render(
      <MemoryRouter>
        <WhatsappConnectionsPage services={services} />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("tab", { name: "Asistente IA" }));
    await user.type(
      await screen.findByRole("textbox", { name: "Contactos de prueba" }),
      "+573028648594",
    );
    let resolveConnections!: (value: (typeof connection)[]) => void;
    vi.mocked(services.whatsapp.listConnections).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConnections = resolve;
      }),
    );
    let refresh!: Promise<unknown>;
    act(() => {
      refresh = Promise.resolve(realtime.refresh?.());
    });
    expect(
      screen.getByRole("textbox", { name: "Contactos de prueba" }),
    ).toHaveValue("+573028648594");
    expect(screen.getByRole("tab", { name: "Asistente IA" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await act(async () => {
      resolveConnections([connection]);
      await refresh;
    });
    expect(services.whatsapp.getAssistant).toHaveBeenCalledTimes(1);
    expect(services.whatsapp.getChannel).toHaveBeenCalledTimes(1);
    expect(services.whatsapp.getNative).toHaveBeenCalledTimes(1);
    vi.mocked(services.whatsapp.listConnections).mockRejectedValueOnce(
      new Error("Temporary connection failure"),
    );
    await act(async () => {
      await realtime.refresh?.();
    });
    expect(screen.getByText("Temporary connection failure")).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Contactos de prueba" }),
    ).toHaveValue("+573028648594");
    expect(services.whatsapp.getAssistant).toHaveBeenCalledTimes(1);
    await act(async () => {
      await realtime.refresh?.();
    });
    expect(screen.queryByText("Temporary connection failure")).toBeNull();
  });

  it("shows only the selected section and preserves unsaved assistant changes", async () => {
    tenantState.id = 101;
    const user = userEvent.setup();
    const services = createServices();
    vi.mocked(services.whatsapp.listConnections).mockResolvedValue([
      await services.whatsapp.complete("connection-1", { agencyId: 101 }),
    ]);

    render(
      <MemoryRouter>
        <WhatsappConnectionsPage services={services} />
      </MemoryRouter>,
    );

    await screen.findByRole("tab", { name: "Avanzado" });
    const expectOnlySelectedPanel = () => {
      const panels = screen.getAllByRole("tabpanel", { hidden: true });
      expect(panels).toHaveLength(4);
      for (const panel of panels) {
        if (panel.dataset.state === "active") expect(panel).toBeVisible();
        else expect(panel).not.toBeVisible();
      }
    };
    expectOnlySelectedPanel();
    await user.click(screen.getByRole("tab", { name: "Conexión" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("tab", { name: "Asistente IA" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Asistente IA" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expectOnlySelectedPanel();
    const contacts = await screen.findByRole("textbox", {
      name: "Contactos de prueba",
    });
    await user.type(contacts, "+573028648594");
    for (const name of ["Menú y equipo", "Avanzado", "Conexión"]) {
      await user.click(screen.getByRole("tab", { name }));
      expectOnlySelectedPanel();
    }
    await user.click(screen.getByRole("tab", { name: "Asistente IA" }));
    expectOnlySelectedPanel();
    expect(
      screen.getByRole("textbox", { name: "Contactos de prueba" }),
    ).toHaveValue("+573028648594");
    expect(services.whatsapp.updateAssistant).not.toHaveBeenCalled();
  });

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
    const user = userEvent.setup();
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
    expect(screen.queryByText(/Nango/i)).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Ayuda: Número de WhatsApp" }),
    );
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Savia valida el número antes de vincularlo.",
    );
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

    await user.click(await screen.findByRole("tab", { name: "Asistente IA" }));
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
    const user = userEvent.setup();
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
      await screen.findByRole("button", { name: "Desconectar" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Enviar prueba" })).toBeVisible();
    await user.click(await screen.findByRole("tab", { name: "Avanzado" }));
    expect(
      await screen.findByText("Native settings are not available"),
    ).toBeVisible();
  });
});
