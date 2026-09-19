import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AppServices } from "@/app-services";
import { MyDayPage } from "./my-day-page";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createServices(
  connected: Array<"google_calendar" | "outlook"> = ["outlook"],
) {
  const events = {
    google_calendar: [
      {
        id: "google-event-1",
        title: "Revisar renovación en Google",
        startsAt: "2026-01-03T14:00:00.000Z",
        endsAt: "2026-01-03T14:30:00.000Z",
        webLink:
          "https://calendar.google.com/calendar/event?eid=google-event-1",
      },
    ],
    outlook: [
      {
        id: "outlook-event-1",
        title: "Revisar renovación",
        startsAt: "2026-01-03T14:00:00.000Z",
        endsAt: "2026-01-03T14:30:00.000Z",
        webLink: "https://outlook.office.com/calendar/item/outlook-event-1",
      },
    ],
  } as const;

  return {
    personalIntegrations: {
      listConnections: vi.fn().mockResolvedValue(
        connected.map((provider) => ({
          id: `${provider}-connection`,
          provider,
          status: "connected",
          externalAccountLabel: null,
          scopes: [],
          lastValidatedAt: "2026-01-03T00:00:00.000Z",
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        })),
      ),
      listEvents: vi
        .fn()
        .mockImplementation(({ provider }) =>
          Promise.resolve(events[provider as keyof typeof events]),
        ),
      createCalendarEvent: vi.fn().mockImplementation(({ provider }) =>
        Promise.resolve({
          id: `${provider}-event-2`,
          title: "Preparar propuesta",
          startsAt: "2026-01-03T15:00:00.000Z",
          endsAt: "2026-01-03T15:30:00.000Z",
          webLink:
            provider === "google_calendar"
              ? "https://calendar.google.com/calendar/event?eid=google-event-2"
              : "https://outlook.office.com/calendar/item/outlook-event-2",
        }),
      ),
    },
  } as unknown as Pick<AppServices, "personalIntegrations">;
}

describe("MyDayPage", () => {
  it("shows events from every connected calendar", async () => {
    const services = createServices(["google_calendar", "outlook"]);

    render(<MyDayPage services={services} />);

    expect(
      await screen.findByText("Revisar renovación en Google"),
    ).toBeVisible();
    expect(screen.getByText("Revisar renovación")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Ver en Google Calendar" }),
    ).toHaveAttribute(
      "href",
      "https://calendar.google.com/calendar/event?eid=google-event-1",
    );
    expect(
      screen.getByRole("link", { name: "Ver en Outlook" }),
    ).toHaveAttribute(
      "href",
      "https://outlook.office.com/calendar/item/outlook-event-1",
    );
  });

  it("merges a matching task from both calendars into one row with both logos", async () => {
    const user = userEvent.setup();
    const services = createServices(["google_calendar", "outlook"]);
    const listEvents = (
      services.personalIntegrations as unknown as { listEvents: Mock }
    ).listEvents;
    listEvents.mockImplementation(
      ({ provider }: { provider: "google_calendar" | "outlook" }) =>
        Promise.resolve(
          provider === "google_calendar"
            ? [
                {
                  id: "google-shared-event",
                  title: "Seguimiento Savia",
                  startsAt: "2026-01-03T16:00:00.000Z",
                  endsAt: "2026-01-03T16:30:00.000Z",
                  webLink:
                    "https://calendar.google.com/calendar/event?eid=google-shared-event",
                },
                {
                  id: "google-only-event",
                  title: "Solo Google",
                  startsAt: "2026-01-03T17:00:00.000Z",
                  endsAt: "2026-01-03T17:30:00.000Z",
                  webLink:
                    "https://calendar.google.com/calendar/event?eid=google-only-event",
                },
              ]
            : [
                {
                  id: "outlook-shared-event",
                  title: "Seguimiento Savia",
                  startsAt: "2026-01-03T16:00:00.0000000Z",
                  endsAt: "2026-01-03T16:30:00.0000000Z",
                  webLink:
                    "https://outlook.office.com/calendar/item/outlook-shared-event",
                },
                {
                  id: "outlook-only-event",
                  title: "Solo Outlook",
                  startsAt: "2026-01-03T17:00:00.000Z",
                  endsAt: "2026-01-03T17:30:00.000Z",
                  webLink:
                    "https://outlook.office.com/calendar/item/outlook-only-event",
                },
              ],
        ),
    );

    render(<MyDayPage services={services} />);

    const sharedTask = await screen.findByText("Seguimiento Savia");
    expect(screen.getAllByText("Seguimiento Savia")).toHaveLength(1);
    const sharedRow = sharedTask.closest("li");
    expect(sharedRow).not.toBeNull();
    expect(
      within(sharedRow as HTMLElement).getByRole("img", {
        name: "Logo de Google Calendar",
      }),
    ).toBeVisible();
    expect(
      within(sharedRow as HTMLElement).getByRole("img", {
        name: "Logo de Outlook",
      }),
    ).toBeVisible();
    const googleOnlyRow = screen.getByText("Solo Google").closest("li");
    expect(googleOnlyRow).not.toBeNull();
    expect(
      within(googleOnlyRow as HTMLElement).getByRole("img", {
        name: "Logo de Google Calendar",
      }),
    ).toBeVisible();
    expect(
      within(googleOnlyRow as HTMLElement).queryByRole("img", {
        name: "Logo de Outlook",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(googleOnlyRow as HTMLElement).getByRole("link", {
        name: "Ver en Google Calendar",
      }),
    ).toHaveAttribute(
      "href",
      "https://calendar.google.com/calendar/event?eid=google-only-event",
    );

    const outlookOnlyRow = screen.getByText("Solo Outlook").closest("li");
    expect(outlookOnlyRow).not.toBeNull();
    expect(
      within(outlookOnlyRow as HTMLElement).getByRole("img", {
        name: "Logo de Outlook",
      }),
    ).toBeVisible();
    expect(
      within(outlookOnlyRow as HTMLElement).queryByRole("img", {
        name: "Logo de Google Calendar",
      }),
    ).not.toBeInTheDocument();

    const calendarChoice = within(sharedRow as HTMLElement).getByRole(
      "button",
      {
        name: "Ver en calendario",
      },
    );
    expect(calendarChoice).toHaveTextContent("Ver");
    await user.click(calendarChoice);
    expect(
      await screen.findByRole("menuitem", {
        name: "Abrir en Google Calendar",
      }),
    ).toHaveAttribute(
      "href",
      "https://calendar.google.com/calendar/event?eid=google-shared-event",
    );
    expect(
      screen.getByRole("menuitem", {
        name: "Abrir en Outlook",
      }),
    ).toHaveAttribute(
      "href",
      "https://outlook.office.com/calendar/item/outlook-shared-event",
    );
  });

  it("shows Outlook events for the day with an external calendar link", async () => {
    const services = createServices();

    render(<MyDayPage services={services} />);

    expect(
      await screen.findByRole("heading", { name: "Mi día" }),
    ).toBeVisible();
    expect(screen.getByText("Revisar renovación")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Ver en Outlook" }),
    ).toHaveAttribute(
      "href",
      "https://outlook.office.com/calendar/item/outlook-event-1",
    );
  });

  it("requires an in-app confirmation before sending a task to calendars", async () => {
    const user = userEvent.setup();
    const services = createServices(["google_calendar", "outlook"]);
    const createCalendarEvent = (
      services.personalIntegrations as unknown as {
        createCalendarEvent: Mock;
      }
    ).createCalendarEvent;

    render(<MyDayPage services={services} />);
    await screen.findByText("Revisar renovación en Google");
    await user.type(screen.getByLabelText("Tarea"), "Preparar propuesta");
    await user.clear(screen.getByLabelText("Hora"));
    await user.type(screen.getByLabelText("Hora"), "10:00");
    await user.click(screen.getByRole("button", { name: "Crear tarea" }));

    const confirmation = await screen.findByRole("dialog", {
      name: "Confirmar tarea",
    });
    expect(confirmation).toHaveTextContent("Preparar propuesta");
    expect(createCalendarEvent).not.toHaveBeenCalled();

    await user.click(
      within(confirmation).getByRole("button", { name: "Confirmar creación" }),
    );
    await waitFor(() => expect(createCalendarEvent).toHaveBeenCalledTimes(2));
  });

  it("sends a confirmed task to every connected calendar", async () => {
    const user = userEvent.setup();
    const services = createServices(["google_calendar", "outlook"]);
    const createCalendarEvent = (
      services.personalIntegrations as unknown as {
        createCalendarEvent: Mock;
      }
    ).createCalendarEvent;
    render(<MyDayPage services={services} />);
    await screen.findByText("Revisar renovación en Google");
    await user.type(screen.getByLabelText("Tarea"), "Preparar propuesta");
    await user.clear(screen.getByLabelText("Hora"));
    await user.type(screen.getByLabelText("Hora"), "10:00");
    await user.click(screen.getByRole("button", { name: "Crear tarea" }));
    await user.click(
      await screen.findByRole("button", { name: "Confirmar creación" }),
    );

    await waitFor(() => expect(createCalendarEvent).toHaveBeenCalledTimes(2));
    expect(createCalendarEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        provider: "google_calendar",
        title: "Preparar propuesta",
      }),
    );
    expect(createCalendarEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        provider: "outlook",
        title: "Preparar propuesta",
      }),
    );
  });

  it("keeps the task created in one calendar when the other calendar fails", async () => {
    const user = userEvent.setup();
    const services = createServices(["google_calendar", "outlook"]);
    const createCalendarEvent = (
      services.personalIntegrations as unknown as {
        createCalendarEvent: Mock;
      }
    ).createCalendarEvent;
    createCalendarEvent.mockImplementation(
      ({ provider }: { provider: "google_calendar" | "outlook" }) =>
        provider === "google_calendar"
          ? Promise.resolve({
              id: "google-event-2",
              title: "Preparar propuesta",
              startsAt: "2026-01-03T15:00:00.000Z",
              endsAt: "2026-01-03T15:30:00.000Z",
              webLink:
                "https://calendar.google.com/calendar/event?eid=google-event-2",
            })
          : Promise.reject(new Error("calendar unavailable")),
    );
    render(<MyDayPage services={services} />);
    await screen.findByText("Revisar renovación en Google");
    await user.type(screen.getByLabelText("Tarea"), "Preparar propuesta");
    await user.clear(screen.getByLabelText("Hora"));
    await user.type(screen.getByLabelText("Hora"), "10:00");
    await user.click(screen.getByRole("button", { name: "Crear tarea" }));
    await user.click(
      await screen.findByRole("button", { name: "Confirmar creación" }),
    );

    expect(
      await screen.findByText(
        "La tarea quedó creada en Google Calendar. No se pudo crear en Outlook.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Preparar propuesta")).toBeVisible();
  });

  it("adds a task after the user confirms it in Savia", async () => {
    const user = userEvent.setup();
    const services = createServices();

    render(<MyDayPage services={services} />);
    await screen.findByRole("heading", { name: "Mi día" });
    await user.type(screen.getByLabelText("Tarea"), "Preparar propuesta");
    await user.clear(screen.getByLabelText("Hora"));
    await user.type(screen.getByLabelText("Hora"), "10:00");
    await user.click(screen.getByRole("button", { name: "Crear tarea" }));
    await user.click(
      await screen.findByRole("button", { name: "Confirmar creación" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Preparar propuesta")).toBeVisible(),
    );
    const createdTask = screen.getByText("Preparar propuesta").closest("li");
    expect(createdTask).not.toBeNull();
    expect(
      within(createdTask as HTMLElement).getByRole("link", {
        name: "Ver en Outlook",
      }),
    ).toHaveAttribute(
      "href",
      "https://outlook.office.com/calendar/item/outlook-event-2",
    );
  });
});
