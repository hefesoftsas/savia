import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyDayWidgetsSection } from "./section";
import { CALENDAR_CONNECT_NOTICE_KEY } from "./agenda-widget";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const objectsPayload = {
  data: [
    {
      name: "polizas",
      label: "Pólizas",
      count: 42,
      config: {
        fields: {
          name: { type: "Textbox", label: "Póliza" },
          estado: { type: "Dropdown", label: "Estado" },
          prima: { type: "Currency", label: "Prima" },
          fin: { type: "DateControl", label: "Vence" },
        },
        studio: {},
      },
    },
  ],
};

function isoDay(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function createApiClient() {
  return {
    get: vi.fn(async (path: string) => {
      if (path === "/v1/data-domains") {
        return {
          data: [
            {
              id: "platform",
              label: "Platform",
              kind: "platform",
              apiBasePath: "/v1/data-domains/platform",
            },
          ],
        };
      }
      if (path === "/v1/data-domains/platform/api/objects") {
        return objectsPayload;
      }
      if (path.includes("/api/records/polizas/summary")) {
        return {
          data: [
            { value: "Vigente", count: 40, amount: 1000 },
            { value: "Vencida", count: 2, amount: 50 },
          ],
        };
      }
      if (path.includes("/api/records/polizas")) {
        return {
          data: [
            {
              id: "rec-1",
              name: "POL-001",
              estado: "Vigente",
              fin: isoDay(-2),
            },
            {
              id: "rec-2",
              name: "POL-002",
              estado: "Vencida",
              fin: isoDay(3),
            },
          ],
          total: 42,
          page: 1,
          perPage: 5,
        };
      }
      throw new Error(`unexpected path ${path}`);
    }),
  };
}

function createPreferences(widgets: unknown[] = []) {
  return {
    getMyDayWidgets: vi.fn().mockResolvedValue({ version: 1, widgets }),
    saveMyDayWidgets: vi.fn(async (layout: unknown) => layout),
  };
}

describe("MyDayWidgetsSection", () => {
  it("renders nothing when clients are unavailable", () => {
    const { container } = render(<MyDayWidgetsSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an empty state when there are no widgets", async () => {
    render(
      <MyDayWidgetsSection
        apiClient={createApiClient() as never}
        userPreferences={createPreferences() as never}
      />,
    );
    expect(await screen.findByTestId("my-day-widgets-empty")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Agregar tu primer widget" }),
    ).toBeVisible();
  });

  it("renders a summary widget with server totals and groups", async () => {
    render(
      <MyDayWidgetsSection
        apiClient={createApiClient() as never}
        userPreferences={
          createPreferences([
            {
              id: "w_polizas1",
              apiBasePath: "/v1/data-domains/platform",
              collection: "polizas",
              kind: "summary",
            },
          ]) as never
        }
      />,
    );

    const card = await screen.findByTestId("my-day-widget-w_polizas1");
    await waitFor(() => expect(card).toHaveTextContent("42"));
    expect(card).toHaveTextContent("Vigente");
    expect(card).toHaveTextContent("Vencida");
    expect(
      screen.getByRole("link", { name: "Ver Pólizas completa" }),
    ).toHaveAttribute("href", "/studio?domain=platform&object=polizas");
  });

  it("renders an items widget with recent records", async () => {
    render(
      <MyDayWidgetsSection
        apiClient={createApiClient() as never}
        userPreferences={
          createPreferences([
            {
              id: "w_polizas2",
              apiBasePath: "/v1/data-domains/platform",
              collection: "polizas",
              kind: "items",
            },
          ]) as never
        }
      />,
    );

    const card = await screen.findByTestId("my-day-widget-w_polizas2");
    await waitFor(() => expect(card).toHaveTextContent("POL-001"));
    expect(card).toHaveTextContent("POL-002");
  });

  it("renders a chart widget with bars per status", async () => {
    render(
      <MyDayWidgetsSection
        apiClient={createApiClient() as never}
        userPreferences={
          createPreferences([
            {
              id: "w_polizas3",
              apiBasePath: "/v1/data-domains/platform",
              collection: "polizas",
              kind: "chart",
            },
          ]) as never
        }
      />,
    );

    const card = await screen.findByTestId("my-day-widget-w_polizas3");
    await waitFor(() =>
      expect(
        card.querySelector('[aria-label="Vigente: 40"]'),
      ).toBeInTheDocument(),
    );
    expect(card).toHaveTextContent("Vencida");
  });

  it("renders an actions widget with overdue and coming items", async () => {
    render(
      <MyDayWidgetsSection
        apiClient={createApiClient() as never}
        userPreferences={
          createPreferences([
            {
              id: "w_polizas4",
              apiBasePath: "/v1/data-domains/platform",
              collection: "polizas",
              kind: "actions",
            },
          ]) as never
        }
      />,
    );

    const card = await screen.findByTestId("my-day-widget-w_polizas4");
    await waitFor(() => expect(card).toHaveTextContent("1 vencido"));
    expect(card).toHaveTextContent("POL-001");
    expect(card).toHaveTextContent("POL-002");
    expect(card).toHaveTextContent("Vencido");
    expect(card).toHaveTextContent("Esta semana");
  });

  it("moves a widget right and persists the new order", async () => {
    const user = userEvent.setup();
    const widgetA = {
      id: "w_a",
      title: "Widget A",
      apiBasePath: "/v1/data-domains/platform",
      collection: "polizas",
      kind: "items",
    };
    const widgetB = {
      id: "w_b",
      title: "Widget B",
      apiBasePath: "/v1/data-domains/platform",
      collection: "polizas",
      kind: "summary",
    };
    const preferences = createPreferences([widgetA, widgetB]);
    render(
      <MyDayWidgetsSection
        apiClient={createApiClient() as never}
        userPreferences={preferences as never}
      />,
    );

    await screen.findByTestId("my-day-widget-w_a");
    await user.click(
      screen.getByRole("button", { name: "Opciones del widget Widget A" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Mover después" }));

    await waitFor(() =>
      expect(preferences.saveMyDayWidgets).toHaveBeenCalledWith({
        version: 1,
        widgets: [
          expect.objectContaining({ id: "w_b" }),
          expect.objectContaining({ id: "w_a" }),
        ],
      }),
    );
  });

  it("removes a widget and persists the empty layout", async () => {
    const user = userEvent.setup();
    const preferences = createPreferences([
      {
        id: "w_polizas1",
        apiBasePath: "/v1/data-domains/platform",
        collection: "polizas",
        kind: "summary",
      },
    ]);
    render(
      <MyDayWidgetsSection
        apiClient={createApiClient() as never}
        userPreferences={preferences as never}
      />,
    );

    await screen.findByTestId("my-day-widget-w_polizas1");
    await user.click(
      screen.getByRole("button", { name: "Opciones del widget Pólizas" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Quitar widget" }));

    await waitFor(() =>
      expect(preferences.saveMyDayWidgets).toHaveBeenCalledWith({
        version: 1,
        widgets: [],
      }),
    );
    expect(await screen.findByTestId("my-day-widgets-empty")).toBeVisible();
  });

  it("renders the agenda system widget with a drag handle", async () => {
    const preferences = createPreferences([{ id: "agenda", kind: "agenda" }]);
    render(
      <MyDayWidgetsSection
        apiClient={createApiClient() as never}
        userPreferences={preferences as never}
        personalIntegrations={
          {
            listConnections: async () => [],
            listEvents: async () => [],
            createCalendarEvent: async () => {
              throw new Error("not used");
            },
          } as never
        }
      />,
    );

    const card = await screen.findByTestId("my-day-widget-agenda");
    expect(card).toHaveTextContent("Agenda");
    expect(
      screen.getByRole("button", { name: "Arrastrar widget Agenda" }),
    ).toBeVisible();
  });

  it("removes the agenda widget and persists the layout", async () => {
    const user = userEvent.setup();
    const preferences = createPreferences([{ id: "agenda", kind: "agenda" }]);
    render(
      <MyDayWidgetsSection
        apiClient={createApiClient() as never}
        userPreferences={preferences as never}
      />,
    );

    await screen.findByTestId("my-day-widget-agenda");
    await user.click(
      screen.getByRole("button", { name: "Opciones del widget Agenda" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Quitar widget" }));

    await waitFor(() =>
      expect(preferences.saveMyDayWidgets).toHaveBeenCalledWith({
        version: 1,
        widgets: [],
      }),
    );
  });

  it("shows the calendar connect notice once and keeps it dismissed", async () => {
    const user = userEvent.setup();
    const integrations = {
      listConnections: async () => [],
      listEvents: async () => [],
      createCalendarEvent: async () => {
        throw new Error("not used");
      },
    };
    const { unmount } = render(
      <MyDayWidgetsSection
        apiClient={createApiClient() as never}
        userPreferences={createPreferences() as never}
        personalIntegrations={integrations as never}
      />,
    );

    const notice = await screen.findByRole("alert", {
      name: "Conecta Google Calendar u Outlook desde Mi cuenta → Mis conexiones.",
    });
    expect(notice).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(
      screen.queryByRole("alert", {
        name: "Conecta Google Calendar u Outlook desde Mi cuenta → Mis conexiones.",
      }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(CALENDAR_CONNECT_NOTICE_KEY)).toBe("1");

    // It does not reappear on refresh or on a new visit.
    await user.click(screen.getByRole("button", { name: "Actualizar" }));
    expect(
      screen.queryByRole("alert", {
        name: "Conecta Google Calendar u Outlook desde Mi cuenta → Mis conexiones.",
      }),
    ).not.toBeInTheDocument();
    unmount();

    render(
      <MyDayWidgetsSection
        apiClient={createApiClient() as never}
        userPreferences={createPreferences() as never}
        personalIntegrations={integrations as never}
      />,
    );
    await screen.findByTestId("my-day-widgets-empty");
    expect(
      screen.queryByRole("alert", {
        name: "Conecta Google Calendar u Outlook desde Mi cuenta → Mis conexiones.",
      }),
    ).not.toBeInTheDocument();
  });
});
