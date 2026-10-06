import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { render } from "../studio-engine/test/locale-test-render";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgendaWidgetBody,
  useMyDayAgenda,
  type PersonalIntegrationsLike,
} from "./agenda-widget";
import type { CalendarSourcesClient } from "@/api/personal-integrations-client";
import type {
  CalendarOccurrence,
  CalendarSource,
} from "@savia/studio-shared/calendar-contracts";
import { tenantBookingsLink } from "./calendar-view";

const source: CalendarSource = {
  id: "team",
  kind: "import",
  name: "Equipo",
  color: "violet",
  visible: true,
  timeZone: "UTC",
  hostname: null,
  lastSyncedAt: null,
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
};
function service(count = 1) {
  const events: CalendarOccurrence[] = Array.from(
    { length: count },
    (_, i) => ({
      id: `event-${i}`,
      sourceId: "team",
      title: `Reunión ${i + 1}`,
      startsAt: "2026-10-03",
      endsAt: "2026-10-04",
      allDay: true,
      timeZone: "UTC",
      webLink: null,
    }),
  );
  return {
    listConnections: vi.fn(async () => []),
    listEvents: vi.fn(async () => []),
    createCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn(async () => {}),
    listCalendarSources: vi.fn(async () => [source]),
    listCalendarSourceEvents: vi.fn(async () => ({
      data: events,
      stale: false,
      error: null,
      lastSyncedAt: null,
    })),
    getCalendarPreferences: vi.fn(async () => ({
      google_calendar: true,
      outlook: true,
    })),
    saveCalendarPreferences: vi.fn(),
    createCalendarSource: vi.fn(async () => source),
    updateCalendarSource: vi.fn(async (_id, input) => ({
      ...source,
      ...input,
    })),
    deleteCalendarSource: vi.fn(async () => {}),
    refreshCalendarSource: vi.fn(async () => source),
  } as PersonalIntegrationsLike & CalendarSourcesClient;
}
function Harness({
  client,
}: {
  client: PersonalIntegrationsLike & CalendarSourcesClient;
}) {
  const agenda = useMyDayAgenda(client);
  useEffect(() => agenda.setSelectedDay(new Date(2026, 9, 3)), []);
  return <AgendaWidgetBody agenda={agenda} />;
}
beforeEach(() => {
  // The fixture selects October 3; keep "today" independent of the CI clock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 3, 12));
});
afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event("savia:session-cleared"));
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("My Day calendar views", () => {
  it("requires a second confirmation before deleting a personal provider event and refreshes the agenda", async () => {
    const user = userEvent.setup(),
      client = service();
    vi.mocked(client.listConnections).mockResolvedValue([
      {
        id: "calendar-connection-1",
        status: "connected",
        provider: "google_calendar",
      },
    ]);
    vi.mocked(client.listEvents)
      .mockResolvedValueOnce([
        {
          id: "google-event-1",
          title: "Planning",
          startsAt: "2026-10-03T14:00:00.000Z",
          endsAt: "2026-10-03T14:30:00.000Z",
          webLink: null,
        },
      ])
      .mockResolvedValue([]);
    render(<Harness client={client} />);

    const event = await screen.findByRole("button", { name: /^Planning,/ });
    expect(
      screen.queryByRole("button", { name: /Eliminar evento de/ }),
    ).not.toBeInTheDocument();
    await user.click(event);
    await user.click(screen.getByRole("button", { name: "Eliminar evento" }));
    expect(client.deleteCalendarEvent).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Confirmar eliminación" }),
    );

    await waitFor(() =>
      expect(client.deleteCalendarEvent).toHaveBeenCalledWith({
        provider: "google_calendar",
        eventId: "google-event-1",
        connectionId: "calendar-connection-1",
      }),
    );
    await waitFor(() => expect(client.listEvents).toHaveBeenCalledTimes(2));
  });

  it("keeps a provider event visible and reports the error when deletion fails", async () => {
    const user = userEvent.setup(),
      client = service();
    vi.mocked(client.listConnections).mockResolvedValue([
      {
        id: "calendar-connection-1",
        status: "connected",
        provider: "google_calendar",
      },
    ]);
    vi.mocked(client.listEvents).mockResolvedValue([
      {
        id: "google-event-1",
        title: "Planning",
        startsAt: "2026-10-03T14:00:00.000Z",
        endsAt: "2026-10-03T14:30:00.000Z",
        webLink: null,
      },
    ]);
    vi.mocked(client.deleteCalendarEvent!).mockRejectedValueOnce(
      new Error("Provider rejected deletion"),
    );
    render(<Harness client={client} />);

    await user.click(await screen.findByRole("button", { name: /^Planning,/ }));
    await user.click(screen.getByRole("button", { name: "Eliminar evento" }));
    await user.click(
      screen.getByRole("button", { name: "Confirmar eliminación" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo eliminar el evento. Inténtalo de nuevo.",
    );
    expect(screen.getByRole("dialog", { name: "Planning" })).toBeVisible();
    expect(client.listEvents).toHaveBeenCalledTimes(1);
  });

  it("does not offer deletion for imported calendar events", async () => {
    const user = userEvent.setup(),
      client = service();
    render(<Harness client={client} />);

    await user.click(await screen.findByRole("button", { name: /Reunión 1/ }));

    expect(
      screen.queryByRole("button", { name: "Eliminar evento" }),
    ).toBeNull();
  });

  it("links to a confirmed canonical tenant booking route and omits unknown hosts", () => {
    expect(
      tenantBookingsLink(
        "centro-medico",
        "2026-10-03T14:00:00.000Z",
        "savia.app.hefesoft.com",
      ),
    ).toBe(
      "https://centro-medico.savia.app.hefesoft.com/#/bookings?tab=reservations&date=2026-10-03",
    );
    expect(
      tenantBookingsLink(
        "centro-medico",
        "2026-10-03T14:00:00.000Z",
        "localhost",
      ),
    ).toBeNull();
  });

  it("adds a WebCal subscription with its name and source time zone", async () => {
    const user = userEvent.setup(),
      client = service();
    render(<Harness client={client} />);
    await user.click(
      await screen.findByRole("button", { name: "Gestionar calendarios" }),
    );
    await user.type(
      screen.getByLabelText("Nombre del calendario"),
      "Compartido",
    );
    await user.type(
      screen.getByLabelText("Enlace HTTPS o WebCal"),
      "webcal://calendar.example.org/private.ics",
    );
    await user.clear(screen.getByLabelText("Zona horaria de origen"));
    await user.type(
      screen.getByLabelText("Zona horaria de origen"),
      "America/Bogota",
    );
    await user.click(screen.getByRole("button", { name: "Añadir calendario" }));
    expect(await screen.findByText("Calendario añadido.")).toBeVisible();
    expect(client.createCalendarSource).toHaveBeenCalledWith({
      kind: "subscription",
      name: "Compartido",
      url: "webcal://calendar.example.org/private.ics",
      timeZone: "America/Bogota",
      color: "blue",
    });
  });
  it("saves connected provider visibility independently of feed visibility", async () => {
    const user = userEvent.setup(),
      client = service();
    vi.mocked(client.listConnections).mockResolvedValue([
      { status: "connected", provider: "google_calendar" },
    ]);
    vi.mocked(client.saveCalendarPreferences).mockResolvedValue({
      google_calendar: false,
      outlook: true,
    });
    render(<Harness client={client} />);
    await user.click(
      await screen.findByRole("button", { name: "Gestionar calendarios" }),
    );
    await user.click(
      await screen.findByRole("checkbox", { name: "Google Calendar" }),
    );
    await waitFor(() =>
      expect(client.saveCalendarPreferences).toHaveBeenCalledWith({
        google_calendar: false,
        outlook: true,
      }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Mostrar Equipo" }),
    ).toBeChecked();
  });
  it("imports an ICS copy and keeps its draft when saving fails", async () => {
    const user = userEvent.setup(),
      client = service();
    vi.mocked(client.createCalendarSource).mockRejectedValueOnce(
      new Error("Invalid file"),
    );
    render(<Harness client={client} />);
    await user.click(
      await screen.findByRole("button", { name: "Gestionar calendarios" }),
    );
    await user.click(screen.getByRole("button", { name: "Archivo .ics" }));
    await user.type(
      screen.getByLabelText("Nombre del calendario"),
      "Vacaciones",
    );
    const content = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR";
    await user.upload(
      screen.getByLabelText("Archivo de calendario"),
      new File([content], "holidays.ics", { type: "text/calendar" }),
    );
    const upload = screen.getByLabelText(
      "Archivo de calendario",
    ) as HTMLInputElement;
    expect(upload.files).toHaveLength(1);
    // jsdom's native required check does not recognize userEvent's uploaded FileList.
    fireEvent.submit(upload.form!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /No pudimos guardar/,
    );
    expect(screen.getByLabelText("Nombre del calendario")).toHaveValue(
      "Vacaciones",
    );
    expect(client.createCalendarSource).toHaveBeenCalledWith({
      kind: "import",
      name: "Vacaciones",
      content,
      timeZone: expect.any(String),
      color: "blue",
    });
    fireEvent.submit(upload.form!);
    expect(await screen.findByText("Calendario añadido.")).toBeVisible();
    expect(screen.getByLabelText("Nombre del calendario")).toHaveValue("");
  });
  it("edits source metadata and removes its displayed events after deletion", async () => {
    const user = userEvent.setup(),
      client = service();
    render(<Harness client={client} />);
    await user.click(
      await screen.findByRole("button", { name: "Gestionar calendarios" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Editar Equipo" }),
    );
    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), "Equipo nuevo");
    await user.selectOptions(screen.getAllByLabelText("Color")[0], "amber");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(client.updateCalendarSource).toHaveBeenCalledWith("team", {
        name: "Equipo nuevo",
        color: "amber",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Eliminar Equipo" }));
    await waitFor(() =>
      expect(client.deleteCalendarSource).toHaveBeenCalledWith("team"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Eliminar Equipo" }),
      ).not.toBeInTheDocument(),
    );
  });
  it("does not claim the day is free when its calendars could not be read", async () => {
    const client = service();
    vi.mocked(client.listCalendarSourceEvents).mockRejectedValue(
      new Error("Unavailable"),
    );
    render(<Harness client={client} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
    expect(screen.queryByText(/Tu agenda está libre/)).not.toBeInTheDocument();
    expect(screen.getByText(/No pudimos comprobar todos/)).toBeVisible();
  });
  it("retries failed provider reads from the agenda notice", async () => {
    const user = userEvent.setup(),
      client = service(0);
    vi.mocked(client.listCalendarSources).mockResolvedValue([]);
    vi.mocked(client.listConnections).mockResolvedValue([
      { status: "connected", provider: "google_calendar" },
    ]);
    vi.mocked(client.listEvents).mockRejectedValue(new Error("Unavailable"));
    render(<Harness client={client} />);
    await screen.findByText(/No pudimos comprobar todos/);
    vi.mocked(client.listEvents).mockResolvedValue([]);
    await user.click(
      screen.getByRole("button", { name: "Sincronizar calendarios" }),
    );
    expect(await screen.findByText("Sin eventos para este día.")).toBeVisible();
    expect(
      screen.queryByText(/No pudimos comprobar todos/),
    ).not.toBeInTheDocument();
  });
  it("opens internal details for provider events without a native link", async () => {
    const client = service(0);
    vi.mocked(client.listConnections).mockResolvedValue([
      { status: "connected", provider: "google_calendar" },
    ]);
    vi.mocked(client.listEvents).mockResolvedValue([
      {
        id: "provider",
        title: "Private meeting",
        startsAt: "2026-10-03T09:00:00Z",
        endsAt: "2026-10-03T10:00:00Z",
        webLink: null,
      },
    ]);
    render(<Harness client={client} />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /Private meeting/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Private meeting" }),
    ).toBeVisible();
  });
  it("shows shared copies without an OAuth provider and opens event details", async () => {
    const user = userEvent.setup();
    render(<Harness client={service()} />);
    await user.click(await screen.findByRole("button", { name: /Reunión 1/ }));
    expect(
      await screen.findByRole("dialog", { name: "Reunión 1" }),
    ).toBeVisible();
    expect(screen.getAllByText("Todo el día").length).toBeGreaterThan(0);
  });
  it("shows the all-day label only once in compact imported events", async () => {
    const user = userEvent.setup();
    render(<Harness client={service()} />);
    await user.click(await screen.findByRole("button", { name: "Mes" }));

    const event = await screen.findByRole("button", { name: /Reunión 1/ });
    expect(within(event).getByText("Todo el día · Reunión 1")).toBeVisible();
    expect(within(event).queryByText("Todo el día · Equipo")).toBeNull();
    expect(within(event).getByText("Equipo")).toBeVisible();
  });
  it("switches to seven Monday-first days and keeps provider queries range-aware", async () => {
    const user = userEvent.setup(),
      client = service();
    render(<Harness client={client} />);
    await user.click(await screen.findByRole("button", { name: "Semana" }));
    await waitFor(() =>
      expect(screen.getAllByTestId("calendar-week-day")).toHaveLength(7),
    );
    expect(screen.getAllByTestId("calendar-week-day")[0]).toHaveTextContent(
      /lunes/i,
    );
    await user.click(screen.getByRole("button", { name: "Periodo siguiente" }));
    expect(screen.getByRole("button", { name: "Semana" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("opens every event when a month cell overflows", async () => {
    const user = userEvent.setup();
    render(<Harness client={service(5)} />);
    await user.click(await screen.findByRole("button", { name: "Mes" }));
    await user.click(
      await screen.findByRole("button", { name: /Ver 2 eventos más/ }),
    );
    expect(
      await screen.findByRole("button", { name: /Reunión 5/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Día" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("manages imported copies and hides a source only after a successful save", async () => {
    const user = userEvent.setup(),
      client = service();
    render(<Harness client={client} />);
    await user.click(
      await screen.findByRole("button", { name: "Gestionar calendarios" }),
    );
    expect(await screen.findByText("Copia importada")).toBeVisible();
    const checkbox = screen.getByRole("checkbox", { name: "Mostrar Equipo" });
    await user.click(checkbox);
    await waitFor(() =>
      expect(client.updateCalendarSource).toHaveBeenCalledWith("team", {
        visible: false,
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Actualizar Equipo" }),
    ).not.toBeInTheDocument();
  });
});
