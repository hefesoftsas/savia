import { StoreContextProvider, memoryStore } from "ra-core";
import userEvent from "@testing-library/user-event";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event("savia:session-cleared"));
  vi.restoreAllMocks();
});

describe("My Day video calls", () => {
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

    await user.click(await screen.findByRole("button", { name: /Planning/ }));
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

  it("keeps the safe Join action in day, week, month, and event details", async () => {
    const meeting: PersonalCalendarEvent = {
      id: "meeting-ready",
      title: "Planning",
      startsAt: "2026-10-04T15:00:00.000Z",
      endsAt: "2026-10-04T15:30:00.000Z",
      webLink: null,
      conference: {
        provider: "jitsi",
        joinUrl: "https://meet.jit.si/savia-test-room",
        status: "ready",
      },
    };
    const user = userEvent.setup();
    const client = createClient([meeting], "outlook");
    renderApp(client);

    expect(
      await screen.findByRole("link", { name: "Join Jitsi" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(
      await screen.findByRole("link", { name: "Join Jitsi" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Planning.*Outlook/ }));
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(
      screen.getByRole("dialog").querySelector('a[aria-label="Join Jitsi"]'),
    ).toHaveAttribute("href", meeting.conference!.joinUrl);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Month" }));
    expect(
      await screen.findByRole("link", { name: "Join Jitsi" }),
    ).toBeVisible();
  });
});
