import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { StoreContextProvider, memoryStore } from "ra-core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PublicBookingManagePage } from "./public-booking-manage-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
});

const manageToken = "manage-token-1234567890123456";
const managePath = `/api/public/bookings/manage/${manageToken}`;

function confirmedReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "reservation-1",
    serviceId: "service-1",
    professionalId: "professional-1",
    serviceName: "Consultation",
    professionalName: "Ari",
    startsAt: "2026-10-05T14:00:00Z",
    endsAt: "2026-10-05T14:30:00Z",
    customerName: "Casey",
    customerEmail: "casey@example.test",
    status: "confirmed",
    version: 7,
    deliveryStatus: "sent",
    calendarStatus: "not_configured",
    ...overrides,
  };
}

function manageData(
  reservation = confirmedReservation(),
  overrides: Record<string, unknown> = {},
) {
  return {
    reservation,
    publicUrl: "https://savia.test/public/bookings/page-token-1234567890123456",
    timeZone: "America/Bogota",
    cancellationMinutes: 120,
    horizonDays: 90,
    leadMinutes: 0,
    canReschedule: true,
    ...overrides,
  };
}

function availabilityData(startsAt = "2026-10-06T15:00:00Z") {
  return {
    displayTimeZone: "America/Bogota",
    businessTimeZone: "America/Bogota",
    days: [
      {
        date: "2026-10-06",
        slots: [
          {
            startsAt,
            endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(),
          },
        ],
      },
    ],
  };
}

function renderManagePage() {
  return render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <PublicBookingManagePage token={manageToken} />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

it("uses private inline availability, requires review, and keeps the reservation revision", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const reservation = {
    id: "reservation-1",
    serviceId: "service-1",
    professionalId: "professional-1",
    serviceName: "Consultation",
    professionalName: "Ari",
    startsAt: "2026-10-05T14:00:00Z",
    endsAt: "2026-10-05T14:30:00Z",
    customerName: "Casey",
    customerEmail: "casey@example.test",
    status: "confirmed",
    version: 7,
    deliveryStatus: "sent",
    calendarStatus: "not_configured",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "https://savia.test").pathname;
      calls.push({
        path:
          new URL(String(input), "https://savia.test").pathname +
          new URL(String(input), "https://savia.test").search,
        init,
      });
      if (path === "/api/public/bookings/manage/manage-token-1234567890123456")
        return Response.json({
          data: {
            reservation,
            publicUrl:
              "https://savia.test/public/bookings/page-token-1234567890123456",
            timeZone: "America/Bogota",
            cancellationMinutes: 120,
            horizonDays: 90,
            leadMinutes: 0,
            canReschedule: true,
          },
        });
      if (
        path ===
        "/api/public/bookings/manage/manage-token-1234567890123456/availability"
      )
        return Response.json({
          data: {
            displayTimeZone: "America/Bogota",
            businessTimeZone: "America/Bogota",
            days: [
              {
                date: "2026-10-06",
                slots: [
                  {
                    startsAt: "2026-10-06T15:00:00Z",
                    endsAt: "2026-10-06T15:30:00Z",
                  },
                ],
              },
            ],
          },
        });
      if (path.endsWith("/reschedule"))
        return Response.json({
          data: {
            ...reservation,
            startsAt: "2026-10-06T15:00:00Z",
            endsAt: "2026-10-06T15:30:00Z",
            version: 8,
          },
        });
      throw new Error(`Unexpected public path ${path}`);
    }),
  );
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <PublicBookingManagePage token="manage-token-1234567890123456" />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  expect(await screen.findByText("Consultation · Ari")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
  expect(
    screen.queryByRole("button", { name: "Reschedule" }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: "10:00 AM" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Date")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Available time")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Tuesday, October 6/ }));
  fireEvent.click(screen.getByRole("button", { name: "10:00 AM" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const reviewHeading = await screen.findByRole("heading", {
    name: "Review your change",
  });
  expect(reviewHeading).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Confirm reschedule" }));
  await screen.findByText("Confirmed");
  expect(
    calls.some((call) =>
      call.path.startsWith(
        "/api/public/bookings/manage/manage-token-1234567890123456/availability?",
      ),
    ),
  ).toBe(true);
  expect(
    calls.some((call) => call.path.includes("/public/bookings/page-token")),
  ).toBe(false);
  const update = calls.find(
    (call) =>
      call.path ===
      "/api/public/bookings/manage/manage-token-1234567890123456/reschedule",
  );
  expect(update?.init?.body).toBe(
    JSON.stringify({ version: 7, startsAt: "2026-10-06T15:00:00Z" }),
  );
});

it("cancels only the linked reservation using its current revision", async () => {
  const requests: Array<{ path: string; body?: string }> = [];
  const reservation = {
    id: "reservation-1",
    serviceId: "service-1",
    professionalId: "professional-1",
    serviceName: "Consultation",
    professionalName: "Ari",
    startsAt: "2026-10-05T14:00:00Z",
    endsAt: "2026-10-05T14:30:00Z",
    customerName: "Casey",
    customerEmail: "casey@example.test",
    status: "confirmed",
    version: 4,
    deliveryStatus: "sent",
    calendarStatus: "not_configured",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "https://savia.test").pathname;
      requests.push({ path, body: init?.body as string | undefined });
      if (path.endsWith("/manage/manage-token-1234567890123456"))
        return Response.json({
          data: {
            reservation,
            publicUrl:
              "https://savia.test/public/bookings/page-token-1234567890123456",
            timeZone: "America/Bogota",
            cancellationMinutes: 120,
          },
        });
      if (path.endsWith("/cancel"))
        return Response.json({
          data: { ...reservation, status: "cancelled", version: 5 },
        });
      throw new Error(`Unexpected public path ${path}`);
    }),
  );
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <PublicBookingManagePage token="manage-token-1234567890123456" />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  await screen.findByText("Confirmed");
  fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
  expect(await screen.findByText("Cancelled")).toBeInTheDocument();
  expect(requests).toContainEqual({
    path: "/api/public/bookings/manage/manage-token-1234567890123456/cancel",
    body: JSON.stringify({ version: 4 }),
  });
});

it.each([
  {
    name: "a version conflict",
    code: "VERSION_CONFLICT",
    message: "That time is no longer available. Choose another available time.",
  },
  {
    name: "a meeting conflict",
    code: "BOOKING_TIME_CONFLICT",
    message:
      "That time conflicts with another meeting or appointment. Choose another available time.",
  },
])(
  "refreshes the private booking revision and slots after $name",
  async ({ code, message }) => {
    const requests: Array<{ path: string; body?: string }> = [];
    let manageReads = 0;
    let reschedulePosts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "https://savia.test");
        requests.push({
          path: url.pathname + url.search,
          body: init?.body as string | undefined,
        });
        if (url.pathname === managePath) {
          manageReads += 1;
          return Response.json({
            data: manageData(
              confirmedReservation({ version: manageReads === 1 ? 7 : 8 }),
            ),
          });
        }
        if (url.pathname === `${managePath}/availability`)
          return Response.json({ data: availabilityData() });
        if (url.pathname === `${managePath}/reschedule`) {
          reschedulePosts += 1;
          if (reschedulePosts === 1)
            return Response.json(
              { error: { code, message: "Revision changed" } },
              { status: 409 },
            );
          return Response.json({
            data: confirmedReservation({
              startsAt: "2026-10-06T15:00:00Z",
              endsAt: "2026-10-06T15:30:00Z",
              version: 9,
            }),
          });
        }
        throw new Error(`Unexpected management path ${url.pathname}`);
      }),
    );
    renderManagePage();

    await screen.findByText("Confirmed");
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    await screen.findByRole("button", { name: "10:00 AM" });
    fireEvent.click(screen.getByRole("button", { name: /Tuesday, October 6/ }));
    fireEvent.click(screen.getByRole("button", { name: "10:00 AM" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm reschedule" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    await screen.findByRole("heading", { name: "Choose a new time" });
    await screen.findByRole("button", { name: "10:00 AM" });
    fireEvent.click(screen.getByRole("button", { name: /Tuesday, October 6/ }));
    fireEvent.click(screen.getByRole("button", { name: "10:00 AM" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm reschedule" }),
    );

    await screen.findByRole("heading", { name: "Updated appointment" });
    const updates = requests.filter(
      (request) => request.path === `${managePath}/reschedule`,
    );
    expect(
      updates.map((request) => JSON.parse(request.body ?? "{}").version),
    ).toEqual([7, 8]);
    expect(
      requests.filter((request) =>
        request.path.startsWith(`${managePath}/availability?`),
      ),
    ).toHaveLength(2);
    expect(
      requests.some((request) => request.path.includes("page-token")),
    ).toBe(false);
  },
);

it("shows an already completed reschedule after a lost-response conflict without posting twice", async () => {
  const requests: string[] = [];
  let manageReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://savia.test");
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === managePath) {
        manageReads += 1;
        const reservation =
          manageReads === 1
            ? confirmedReservation()
            : confirmedReservation({
                startsAt: "2026-10-06T15:00:00Z",
                endsAt: "2026-10-06T15:30:00Z",
                version: 8,
              });
        return Response.json({ data: manageData(reservation) });
      }
      if (url.pathname === `${managePath}/availability`)
        return Response.json({ data: availabilityData() });
      if (url.pathname === `${managePath}/reschedule`)
        return Response.json(
          { error: { message: "Already changed" } },
          { status: 409 },
        );
      throw new Error(`Unexpected management path ${url.pathname}`);
    }),
  );
  renderManagePage();

  await screen.findByText("Confirmed");
  fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
  await screen.findByRole("button", { name: "10:00 AM" });
  fireEvent.click(screen.getByRole("button", { name: /Tuesday, October 6/ }));
  fireEvent.click(screen.getByRole("button", { name: "10:00 AM" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm reschedule" }),
  );

  expect(
    await screen.findByRole("heading", { name: "Updated appointment" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Your appointment has been updated."),
  ).toBeInTheDocument();
  expect(
    requests.filter((request) => request === `POST ${managePath}/reschedule`),
  ).toHaveLength(1);
});

it("leaves the appointment unchanged when a reviewed change is backed out", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://savia.test");
      requests.push(url.pathname);
      if (url.pathname === managePath)
        return Response.json({ data: manageData() });
      if (url.pathname === `${managePath}/availability`)
        return Response.json({ data: availabilityData() });
      throw new Error(`Unexpected management path ${url.pathname}`);
    }),
  );
  renderManagePage();

  await screen.findByText("Confirmed");
  fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
  await screen.findByRole("button", { name: "10:00 AM" });
  fireEvent.click(screen.getByRole("button", { name: /Tuesday, October 6/ }));
  fireEvent.click(screen.getByRole("button", { name: "10:00 AM" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Review your change" });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("heading", { name: "Choose a new time" });
  fireEvent.click(screen.getByRole("button", { name: "Stop rescheduling" }));

  expect(screen.getByText(/Oct 5, 2026, 9:00 AM/)).toBeInTheDocument();
  expect(requests).not.toContain(`${managePath}/reschedule`);
});

it("keeps cancellation available when rescheduling is not permitted", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "https://savia.test").pathname;
      if (path === managePath)
        return Response.json({
          data: manageData(confirmedReservation(), { canReschedule: false }),
        });
      if (path.endsWith("/cancel"))
        return Response.json({
          data: confirmedReservation({ status: "cancelled", version: 8 }),
        });
      throw new Error(`Unexpected management path ${path}`);
    }),
  );
  renderManagePage();

  await screen.findByText("Confirmed");
  expect(
    screen.queryByRole("button", { name: "Reschedule" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "To change this appointment, contact the booking business.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Cancel reservation" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
  expect(await screen.findByText("Cancelled")).toBeInTheDocument();
});

it.each([
  {
    reason: "the professional becomes unavailable",
    status: 404,
    refreshed: () =>
      manageData(confirmedReservation(), { canReschedule: false }),
    cancelState: "enabled",
  },
  {
    reason: "permission is revoked",
    refreshed: () =>
      manageData(confirmedReservation(), { canReschedule: false }),
    cancelState: "enabled",
  },
  {
    reason: "the cancellation cutoff has passed",
    refreshed: () =>
      manageData(confirmedReservation(), { cancellationMinutes: 100_000 }),
    cancelState: "disabled",
  },
  {
    reason: "the reservation has already been cancelled",
    refreshed: () => manageData(confirmedReservation({ status: "cancelled" })),
    cancelState: "hidden",
  },
])(
  "closes rescheduling after a conflict when $reason",
  async ({ refreshed, cancelState, status = 409 }) => {
    const requests: string[] = [];
    let manageReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "https://savia.test");
        requests.push(url.pathname);
        if (url.pathname === managePath) {
          manageReads += 1;
          return Response.json({
            data: manageReads === 1 ? manageData() : refreshed(),
          });
        }
        if (url.pathname === `${managePath}/availability`)
          return Response.json({ data: availabilityData() });
        if (url.pathname === `${managePath}/reschedule`)
          return Response.json(
            { error: { message: "Revision changed" } },
            { status },
          );
        throw new Error(`Unexpected management path ${url.pathname}`);
      }),
    );
    renderManagePage();

    await screen.findByText("Confirmed");
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    await screen.findByRole("button", { name: "10:00 AM" });
    fireEvent.click(screen.getByRole("button", { name: /Tuesday, October 6/ }));
    fireEvent.click(screen.getByRole("button", { name: "10:00 AM" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm reschedule" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "To change this appointment, contact the booking business.",
    );
    expect(
      screen.queryByRole("heading", { name: "Choose a new time" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reschedule" }),
    ).not.toBeInTheDocument();
    if (cancelState === "enabled")
      expect(
        screen.getByRole("button", { name: "Cancel reservation" }),
      ).toBeEnabled();
    else if (cancelState === "disabled")
      expect(
        screen.getByRole("button", { name: "Cancel reservation" }),
      ).toBeDisabled();
    else
      expect(
        screen.queryByRole("button", { name: "Cancel reservation" }),
      ).not.toBeInTheDocument();
    expect(
      requests.filter((path) => path === `${managePath}/availability`),
    ).toHaveLength(1);
  },
);

it("does not render the public booking link when bootstrap has no public URL", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "https://savia.test").pathname;
      if (path === managePath)
        return Response.json({
          data: manageData(confirmedReservation(), { publicUrl: null }),
        });
      throw new Error(`Unexpected management path ${path}`);
    }),
  );
  renderManagePage();

  await screen.findByText("Confirmed");
  expect(
    screen.queryByText("Book another appointment"),
  ).not.toBeInTheDocument();
});

it("refreshes a pending conference link from the private management endpoint", async () => {
  let reads = 0;
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "https://savia.test").pathname;
      if (path === managePath) {
        reads += 1;
        const reservation = confirmedReservation({
          conference:
            reads === 1
              ? { provider: "google_meet", joinUrl: null, status: "pending" }
              : {
                  provider: "google_meet",
                  joinUrl: "https://meet.google.com/abc-defg-hij",
                  status: "ready",
                },
        });
        return Response.json({ data: manageData(reservation) });
      }
      throw new Error(`Unexpected management path ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  renderManagePage();

  expect(
    await screen.findByText(/link is being prepared/i),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh appointment" }));

  expect(
    await screen.findByRole("link", { name: "Join Google Meet" }),
  ).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
  expect(reads).toBe(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1]?.credentials).toBe("omit");
});

it("discards a stale refresh response after cancellation advances the reservation", async () => {
  let refreshReads = 0;
  let resolveRefresh!: (response: Response) => void;
  const delayedRefresh = new Promise<Response>((resolve) => {
    resolveRefresh = resolve;
  });
  const staleReservation = confirmedReservation({
    conference: { provider: "google_meet", joinUrl: null, status: "pending" },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "https://savia.test").pathname;
      if (path === managePath) {
        refreshReads += 1;
        return refreshReads === 1
          ? Response.json({ data: manageData(staleReservation) })
          : delayedRefresh;
      }
      if (path === `${managePath}/cancel`)
        return Response.json({
          data: {
            ...staleReservation,
            status: "cancelled",
            version: staleReservation.version + 1,
          },
        });
      throw new Error(`Unexpected management path ${path}`);
    }),
  );
  renderManagePage();

  expect(
    await screen.findByText(/link is being prepared/i),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh appointment" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
  expect(await screen.findByText("Cancelled")).toBeInTheDocument();

  await act(async () => {
    resolveRefresh(Response.json({ data: manageData(staleReservation) }));
    await delayedRefresh;
  });

  expect(screen.getByText("Cancelled")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Cancel reservation" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Join Google Meet" })).toBeNull();
});
