import { StoreContextProvider, memoryStore } from "ra-core";
import userEvent from "@testing-library/user-event";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonalCalendarEvent } from "@/api/personal-integrations-client";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import {
  AgendaWidgetBody,
  QuickTaskWidgetBody,
  useMyDayAgenda,
  type PersonalIntegrationsLike,
} from "./agenda-widget";

const range = {
  from: "2026-10-04T00:00:00.000Z",
  to: "2026-10-06T00:00:00.000Z",
};

function createClient(
  events: PersonalCalendarEvent[] = [],
  eventProvider: "google_calendar" | "outlook" = "google_calendar",
) {
  return {
    listConnections: vi.fn().mockResolvedValue([
      {
        id: "google-connection",
        status: "connected",
        provider: "google_calendar",
      },
      { id: "outlook-connection", status: "connected", provider: "outlook" },
    ]),
    listEvents: vi.fn(({ provider }) =>
      Promise.resolve(provider === eventProvider ? events : []),
    ),
    createCalendarEvent: vi.fn().mockResolvedValue({
      id: "created-1",
      connectionId: "outlook-connection",
      title: "Planning",
      startsAt: "2026-10-04T15:00:00.000Z",
      endsAt: "2026-10-04T15:30:00.000Z",
      webLink: null,
      conference: {
        provider: "teams",
        joinUrl: "https://teams.microsoft.com/l/meetup-join/abc",
        status: "ready",
      },
    }),
    deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
    listBookingAgenda: vi.fn().mockResolvedValue([]),
  } as unknown as PersonalIntegrationsLike;
}

function App({ client }: { client: PersonalIntegrationsLike }) {
  const agenda = useMyDayAgenda(client, range);
  return (
    <>
      <AgendaWidgetBody agenda={agenda} />
      <QuickTaskWidgetBody agenda={agenda} personalIntegrations={client} />
    </>
  );
}

function renderApp(client: PersonalIntegrationsLike) {
  return render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <App client={client} />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

beforeEach(() => {
  // Keep the selected day aligned with the fixed calendar event fixtures.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event("savia:session-cleared"));
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("My Day video calls", () => {
  it("creates Zoom in the selected calendar with a stable request key on retry", async () => {
    const user = userEvent.setup();
    const client = createClient();
    vi.mocked(client.listConnections).mockResolvedValue([
      {
        id: "google-connection",
        provider: "google_calendar",
        status: "connected",
      },
      { id: "zoom-connection", provider: "zoom", status: "connected" },
    ]);
    vi.mocked(client.createCalendarEvent).mockRejectedValueOnce(
      new Error("Unavailable"),
    );
    renderApp(client);
    await user.type(screen.getByLabelText("Task"), "Zoom planning");
    await user.click(screen.getByLabelText("Create a video call"));
    await user.selectOptions(
      screen.getByLabelText("Video meeting provider"),
      "zoom",
    );
    await user.click(screen.getByRole("button", { name: "Create task" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Zoom");
    await user.click(screen.getByRole("button", { name: "Confirm creation" }));
    await waitFor(() =>
      expect(client.createCalendarEvent).toHaveBeenCalledTimes(1),
    );
    await user.click(screen.getByRole("button", { name: "Confirm creation" }));
    await waitFor(() =>
      expect(client.createCalendarEvent).toHaveBeenCalledTimes(2),
    );
    const first = vi.mocked(client.createCalendarEvent).mock.calls[0][0];
    expect(first).toEqual(
      expect.objectContaining({
        provider: "google_calendar",
        videoCall: true,
        conferenceProvider: "zoom",
        requestId: expect.any(String),
      }),
    );
    expect(vi.mocked(client.createCalendarEvent).mock.calls[1][0]).toEqual(
      first,
    );
  });

  it("requires a connected Zoom account before offering Zoom", async () => {
    renderApp(createClient());
    await userEvent.click(screen.getByLabelText("Create a video call"));
    expect(screen.getByRole("option", { name: "Zoom" })).toBeDisabled();
  });

  it("shows a native booking Jitsi room without an external calendar", async () => {
    const user = userEvent.setup();
    const client = createClient();
    vi.mocked(client.listConnections).mockResolvedValue([]);
    const booking = {
      id: "00000000-0000-4000-8000-000000000001",
      tenantId: 7,
      tenantSlug: "team",
      tenantName: "Team",
      serviceName: "Consultation",
      professionalName: "Ari",
      customerName: "Ana",
      customerEmail: "ana@example.com",
      startsAt: "2026-10-04T15:00:00.000Z",
      endsAt: "2026-10-04T15:30:00.000Z",
      timeZone: "UTC",
      status: "confirmed" as const,
      version: 1,
      externalEvent: null,
      conference: {
        provider: "jitsi" as const,
        status: "ready" as const,
        joinUrl: "https://meet.jit.si/savia-native-room",
      },
    };
    vi.mocked(client.listBookingAgenda!).mockResolvedValue([booking]);
    renderApp(client);
    expect(
      await screen.findByRole("link", { name: "Join Jitsi" }),
    ).toHaveAttribute("href", booking.conference.joinUrl);
    await user.click(
      screen.getByRole("button", { name: /Consultation.*Team/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector('a[aria-label="Join Jitsi"]')).toHaveAttribute(
      "href",
      booking.conference.joinUrl,
    );
  });

  it("confirms Jitsi and attendees before sending a single calendar invitation", async () => {
    const user = userEvent.setup();
    const client = createClient();
    renderApp(client);
    await user.type(screen.getByLabelText("Task"), "Client call");
    await user.click(screen.getByLabelText("Create a video call"));
    await user.selectOptions(
      screen.getByLabelText("Video meeting provider"),
      "jitsi",
    );
    await user.type(
      screen.getByLabelText("Guest emails"),
      "ana@example.com, bob@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Create task" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Jitsi");
    expect(dialog).toHaveTextContent("ana@example.com, bob@example.com");
    expect(client.createCalendarEvent).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm creation" }));
    await waitFor(() =>
      expect(client.createCalendarEvent).toHaveBeenCalledTimes(1),
    );
    expect(client.createCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google_calendar",
        videoCall: true,
        conferenceProvider: "jitsi",
        attendees: ["ana@example.com", "bob@example.com"],
      }),
    );
  });

  it("does not submit an invalid guest email", async () => {
    const user = userEvent.setup();
    const client = createClient();
    renderApp(client);
    await user.type(screen.getByLabelText("Task"), "Client call");
    await user.click(screen.getByLabelText("Create a video call"));
    await user.type(screen.getByLabelText("Guest emails"), "invalid-address");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(client.createCalendarEvent).not.toHaveBeenCalled();
  });

  it("can delete a newly created event immediately using its originating connection", async () => {
    const user = userEvent.setup();
    const client = createClient();
    renderApp(client);

    await user.type(screen.getByLabelText("Task"), "Planning");
    await user.click(screen.getByLabelText("Create a video call"));
    await user.selectOptions(
      screen.getByLabelText("Calendar for the video call"),
      "outlook",
    );
    await user.click(screen.getByRole("button", { name: "Create task" }));
    await user.click(screen.getByRole("button", { name: "Confirm creation" }));

    await user.click(
      await screen.findByRole("button", {
        name: /^Planning,.*Outlook$/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Delete event" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(client.deleteCalendarEvent).toHaveBeenCalledWith({
        provider: "outlook",
        eventId: "created-1",
        connectionId: "outlook-connection",
      }),
    );
  });

  it("confirms and creates one call in the selected calendar", async () => {
    const user = userEvent.setup();
    const client = createClient();
    renderApp(client);

    await user.type(screen.getByLabelText("Task"), "Planning");
    await user.click(screen.getByLabelText("Create a video call"));
    fireEvent.change(screen.getByLabelText("Video call date"), {
      target: { value: "2026-10-06" },
    });
    await user.selectOptions(
      screen.getByLabelText("Calendar for the video call"),
      "outlook",
    );
    await user.click(screen.getByRole("button", { name: "Create task" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Date: Tuesday, October 6",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Microsoft Teams");
    await user.click(screen.getByRole("button", { name: "Confirm creation" }));

    await waitFor(() =>
      expect(client.createCalendarEvent).toHaveBeenCalledTimes(1),
    );
    expect(client.createCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "outlook",
        videoCall: true,
        startsAt: expect.stringMatching(/^2026-10-06T/),
      }),
    );
  });

  it("shows a safe ready join link and updates a pending meeting after refresh", async () => {
    const pending: PersonalCalendarEvent = {
      id: "meeting-1",
      title: "Planning",
      startsAt: "2026-10-04T15:00:00.000Z",
      endsAt: "2026-10-04T15:30:00.000Z",
      webLink: null,
      conference: { provider: "teams", joinUrl: null, status: "pending" },
    };
    const ready = {
      ...pending,
      conference: {
        provider: "teams" as const,
        joinUrl: "https://teams.microsoft.com/l/meetup-join/abc",
        status: "ready" as const,
      },
    };
    const user = userEvent.setup();
    const client = createClient([pending], "outlook");
    renderApp(client);
    expect(
      await screen.findByText("Meeting link is being prepared."),
    ).toBeVisible();

    vi.mocked(client.listEvents).mockImplementation(({ provider }) =>
      Promise.resolve(provider === "outlook" ? [ready] : []),
    );
    await user.click(screen.getByRole("button", { name: "Refresh agenda" }));

    const join = await screen.findByRole("link", {
      name: "Join Microsoft Teams",
    });
    expect(join).toHaveAttribute("href", ready.conference.joinUrl);
    expect(join).toHaveAttribute("rel", "noreferrer");
  });

  it("identifies each calendar copy with its accessible provider icon", async () => {
    const event: PersonalCalendarEvent = {
      id: "shared-event",
      title: "Planning",
      startsAt: "2026-10-04T15:00:00.000Z",
      endsAt: "2026-10-04T15:30:00.000Z",
      webLink: null,
    };
    const client = createClient([event]);
    vi.mocked(client.listEvents).mockImplementation(({ provider }) =>
      Promise.resolve(provider === "outlook" ? [event] : [event]),
    );
    renderApp(client);

    const googleEvent = await screen.findByRole("button", {
      name: /^Planning,.*Google Calendar$/,
    });
    const outlookEvent = await screen.findByRole("button", {
      name: /^Planning,.*Outlook$/,
    });
    expect(
      within(googleEvent).getByRole("img", { name: "Google Calendar" }),
    ).toHaveAttribute("title", "Google Calendar");
    expect(
      within(outlookEvent).getByRole("img", { name: "Outlook" }),
    ).toHaveAttribute("title", "Outlook");
    expect(
      screen.queryByText("Scheduled in Google Calendar"),
    ).not.toBeInTheDocument();
  });

  it("deletes only the selected calendar copy from a grouped event", async () => {
    const user = userEvent.setup();
    const event: PersonalCalendarEvent = {
      id: "shared-event",
      title: "Planning",
      startsAt: "2026-10-04T15:00:00.000Z",
      endsAt: "2026-10-04T15:30:00.000Z",
      webLink: null,
    };
    const client = createClient([event]);
    vi.mocked(client.listEvents).mockResolvedValue([event]);
    renderApp(client);

    await user.click(
      await screen.findByRole("button", {
        name: /^Planning,.*Google Calendar$/,
      }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Google Calendar",
    );
    await user.click(screen.getByRole("button", { name: "Delete event" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(client.deleteCalendarEvent).toHaveBeenCalledWith({
        provider: "google_calendar",
        eventId: "shared-event",
        connectionId: "google-connection",
      }),
    );
    expect(client.deleteCalendarEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed agenda deletion open so the user can retry", async () => {
    const user = userEvent.setup();
    const event: PersonalCalendarEvent = {
      id: "retry-event",
      title: "Planning",
      startsAt: "2026-10-04T15:00:00.000Z",
      endsAt: "2026-10-04T15:30:00.000Z",
      webLink: null,
    };
    const client = createClient([event]);
    vi.mocked(client.deleteCalendarEvent!)
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValueOnce(undefined);
    renderApp(client);

    await user.click(
      await screen.findByRole("button", {
        name: /^Planning,.*Google Calendar$/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Delete event" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not delete this event. Try again.",
    );
    expect(screen.getByRole("dialog")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() =>
      expect(client.deleteCalendarEvent).toHaveBeenCalledTimes(2),
    );
  });

  it("does not offer personal-calendar deletion for a booking record", async () => {
    const booking = {
      id: "00000000-0000-4000-8000-000000000001",
      tenantId: 7,
      tenantSlug: "team",
      tenantName: "Team",
      serviceName: "Consultation",
      professionalName: "Ari",
      customerName: "Ana",
      customerEmail: "ana@example.com",
      startsAt: "2026-10-04T15:00:00.000Z",
      endsAt: "2026-10-04T15:30:00.000Z",
      timeZone: "UTC",
      status: "confirmed" as const,
      version: 1,
      externalEvent: {
        provider: "google_calendar" as const,
        id: "booking-external",
      },
      conference: null,
    };
    const client = createClient();
    vi.mocked(client.listBookingAgenda!).mockResolvedValue([booking]);
    renderApp(client);

    expect(
      await screen.findByRole("button", { name: /Consultation.*Team/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: /Delete event from Google Calendar/,
      }),
    ).not.toBeInTheDocument();
    expect(client.deleteCalendarEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["unsupported", "Video calls are not supported by this calendar account."],
    ["failed", "The meeting link could not be created."],
  ] as const)(
    "shows the explicit %s conference state",
    async (status, label) => {
      const client = createClient(
        [
          {
            id: `meeting-${status}`,
            title: "Planning",
            startsAt: "2026-10-04T15:00:00.000Z",
            endsAt: "2026-10-04T15:30:00.000Z",
            webLink: null,
            conference: { provider: null, joinUrl: null, status },
          },
        ],
        "outlook",
      );
      renderApp(client);

      expect(await screen.findByText(label)).toBeVisible();
      expect(
        screen.queryByRole("link", { name: /Join/ }),
      ).not.toBeInTheDocument();
    },
  );

  it("does not expose a ready meeting link with embedded credentials", async () => {
    const client = createClient(
      [
        {
          id: "meeting-unsafe",
          title: "Planning",
          startsAt: "2026-10-04T15:00:00.000Z",
          endsAt: "2026-10-04T15:30:00.000Z",
          webLink: null,
          conference: {
            provider: "google_meet",
            joinUrl: "https://user:secret@meet.google.com/abc-defg-hij",
            status: "ready",
          },
        },
      ],
      "outlook",
    );
    renderApp(client);

    await screen.findByText("Meeting link is unavailable.");
    expect(
      screen.queryByRole("link", { name: /Join/ }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText("Meeting link is unavailable."),
    ).toBeVisible();
  });

  it.each([
    ["google_meet", "https://meet.google.com/abc-defg-hij", "Join Google Meet"],
    [
      "teams",
      "https://teams.cloud.microsoft/l/meetup-join/abc",
      "Join Microsoft Teams",
    ],
    ["jitsi", "https://meet.jit.si/savia-planning", "Join Jitsi"],
    ["zoom", "https://us02web.zoom.us/j/123456789?pwd=secret", "Join Zoom"],
  ] as const)(
    "keeps the safe %s join action in day, week, month, and event details",
    async (provider, joinUrl, label) => {
      const meeting: PersonalCalendarEvent = {
        id: "meeting-ready",
        title: "Planning",
        startsAt: "2026-10-04T15:00:00.000Z",
        endsAt: "2026-10-04T15:30:00.000Z",
        webLink: null,
        conference: {
          provider,
          joinUrl,
          status: "ready",
        },
      };
      const user = userEvent.setup();
      const client = createClient([meeting], "outlook");
      renderApp(client);

      expect(await screen.findByRole("link", { name: label })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Week" }));
      expect(await screen.findByRole("link", { name: label })).toBeVisible();
      await user.click(
        screen.getByRole("button", { name: /Planning.*Outlook/ }),
      );
      expect(await screen.findByRole("dialog")).toBeVisible();
      expect(
        screen.getByRole("dialog").querySelector(`a[aria-label="${label}"]`),
      ).toHaveAttribute("href", joinUrl);
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "Month" }));
      expect(await screen.findByRole("link", { name: label })).toBeVisible();
    },
  );
});
