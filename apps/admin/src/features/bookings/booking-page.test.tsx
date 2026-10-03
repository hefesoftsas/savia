import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { StoreContextProvider, memoryStore } from "ra-core";
import { MemoryRouter } from "react-router-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BookingPage } from "./booking-page";
import { ApiClientError } from "@/api/api-client";

afterEach(cleanup);

it.each([
  [422, "Use an IANA time zone."],
  [403, "Organization access denied."],
  [500, "Internal server error"],
])("reports the server's rejection with HTTP %s", async (status, message) => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      data: {
        settings,
        candidates: [{ principalId: "principal-1", displayName: "Ari" }],
        canManage: true,
        principalId: "principal-1",
        publicUrl: null,
        calendar: { provider: null, status: "not_connected" },
      },
    }),
    put: vi
      .fn()
      .mockRejectedValue(new ApiClientError(status, "CRM_SYNC_ERROR", message)),
  };
  mount(apiClient);
  await screen.findByRole("heading", { name: "Appointments" });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(message);
  expect(alert).toHaveTextContent(`HTTP ${status}`);
});

it("explains missing publication requirements before submitting settings", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      data: {
        settings: { ...settings, services: [], professionals: [] },
        candidates: [],
        canManage: true,
        principalId: "principal-1",
        publicUrl: "https://savia.test/public/bookings/page-token",
        calendar: { provider: null, status: "not_connected" },
      },
    }),
    put: vi
      .fn()
      .mockRejectedValue(
        new ApiClientError(422, "CRM_SYNC_ERROR", "Invalid publication"),
      ),
  };
  mount(apiClient);
  await screen.findByRole("heading", { name: "Appointments" });
  fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
  fireEvent.click(screen.getByLabelText("Published"));
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Enable a service and an assigned professional before publishing.",
  );
  expect(apiClient.put).not.toHaveBeenCalled();
});

it("does not offer an unpublished public page even when its token exists", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      data: {
        settings,
        candidates: [],
        canManage: true,
        principalId: "principal-1",
        publicUrl: "https://savia.test/public/bookings/page-token",
        calendar: { provider: null, status: "not_connected" },
      },
    }),
    put: vi.fn(),
  };
  mount(apiClient);
  await screen.findByRole("heading", { name: "Appointments" });
  expect(
    screen.queryByRole("link", { name: "Open team booking page" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /page-token/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "Save enabled and published settings to open the public page.",
    ),
  ).toBeInTheDocument();
});

it("offers the legacy team agenda after published settings are saved", async () => {
  const bootstrap = {
    settings,
    candidates: [{ principalId: "principal-1", displayName: "Ari" }],
    canManage: true,
    principalId: "principal-1",
    publicUrl: "https://savia.test/public/bookings/page-token",
    calendar: { provider: null, status: "not_connected" },
  };
  const apiClient = {
    get: vi.fn().mockResolvedValue({ data: bootstrap }),
    put: vi.fn().mockResolvedValue({
      data: {
        ...bootstrap,
        settings: { ...settings, version: 4, published: true },
      },
    }),
  };
  mount(apiClient);
  await screen.findByRole("heading", { name: "Appointments" });
  fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
  fireEvent.click(screen.getByLabelText("Published"));
  expect(
    screen.queryByRole("link", { name: "Open team booking page" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(
    await screen.findByRole("link", { name: "Open team booking page" }),
  ).toHaveAttribute("href", bootstrap.publicUrl);
});

const settings = {
  version: 3,
  enabled: true,
  published: false,
  title: "Appointments",
  description: "Visit our team",
  timeZone: "America/Bogota",
  leadMinutes: 60,
  horizonDays: 30,
  cancellationMinutes: 240,
  reminderMinutes: 60,
  services: [
    {
      id: "consult",
      name: "Consultation",
      description: "First visit",
      durationMinutes: 30,
      bufferMinutes: 5,
      enabled: true,
      professionalIds: ["professional-1"],
    },
  ],
  professionals: [
    {
      id: "professional-1",
      principalId: "principal-1",
      enabled: true,
      weekly: [{ day: 1, start: "09:00", end: "12:00" }],
      exceptions: [],
    },
  ],
};

function mount(
  apiClient: Record<string, ReturnType<typeof vi.fn>>,
  tenantId = 42,
  initialEntry = "/bookings",
) {
  return render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <BookingPage services={{ apiClient } as never} tenantId={tenantId} />
        </MemoryRouter>
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

it("loads booking settings and candidates, then saves the edited configuration", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      data: {
        settings,
        candidates: [{ principalId: "principal-1", displayName: "Ari" }],
        canManage: true,
        principalId: "principal-1",
        publicUrl:
          "https://savia.test/public/bookings/token-12345678901234567890",
        calendar: { provider: null, status: "not_connected" },
      },
    }),
    put: vi
      .fn()
      .mockResolvedValue({ data: { settings: { ...settings, version: 4 } } }),
    post: vi.fn(),
  };
  mount(apiClient);

  expect(
    await screen.findByRole("heading", { name: "Appointments" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Team" }));
  expect(screen.getByLabelText("Professional")).toHaveValue("principal-1");
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  fireEvent.change(screen.getByLabelText("Public title"), {
    target: { value: "Savia visits" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText("Booking settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/booking",
    expect.objectContaining({ version: 3, title: "Savia visits" }),
  );
});

it("gives a recovery action after a failed bootstrap and reports version conflicts", async () => {
  const apiClient = {
    get: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        data: {
          settings,
          candidates: [{ principalId: "principal-1", displayName: "Ari" }],
          canManage: true,
          principalId: "principal-1",
          publicUrl: null,
          calendar: { provider: null, status: "not_connected" },
        },
      }),
    put: vi.fn().mockRejectedValue(
      Object.assign(new Error("stale"), {
        code: "VERSION_CONFLICT",
        status: 409,
      }),
    ),
    post: vi.fn(),
  };
  mount(apiClient);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be loaded",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("heading", { name: "Appointments" });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "changed elsewhere",
  );
});

it("ignores a slow response after switching tenants", async () => {
  let finishFirst!: (value: unknown) => void;
  const first = new Promise((resolve) => {
    finishFirst = resolve;
  });
  const apiClient = {
    get: vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({
        data: {
          settings: { ...settings, title: "Tenant B" },
          candidates: [],
          canManage: false,
          principalId: "principal-2",
          publicUrl: null,
          calendar: { provider: null, status: "not_connected" },
        },
      }),
    put: vi.fn(),
    post: vi.fn(),
  };
  const view = mount(apiClient, 41);
  view.rerender(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <MemoryRouter>
          <BookingPage services={{ apiClient } as never} tenantId={42} />
        </MemoryRouter>
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  expect(
    await screen.findByRole("heading", { name: "Tenant B" }),
  ).toBeInTheDocument();
  finishFirst({
    data: {
      settings,
      candidates: [],
      canManage: true,
      principalId: "principal-1",
      publicUrl: null,
      calendar: { provider: null, status: "not_connected" },
    },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Tenant B" }),
    ).toBeInTheDocument(),
  );
  expect(apiClient.get).toHaveBeenNthCalledWith(2, "/v1/tenants/42/booking");
});

it("keeps professional controls to the signed-in professional and saves usable weekly periods", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({
      data: {
        settings,
        candidates: [
          { principalId: "principal-1", displayName: "Ari" },
          { principalId: "principal-2", displayName: "Sam" },
        ],
        canManage: false,
        principalId: "principal-1",
        publicUrl: null,
        calendar: { provider: "google_calendar", status: "connected" },
      },
    }),
    put: vi.fn().mockResolvedValue({
      data: {
        settings: {
          ...settings,
          version: 4,
          professionals: [
            {
              ...settings.professionals[0],
              weekly: [{ day: 1, start: "10:00", end: "12:00" }],
            },
          ],
        },
        candidates: [{ principalId: "principal-1", displayName: "Ari" }],
        canManage: false,
        principalId: "principal-1",
        publicUrl: null,
        calendar: { provider: "google_calendar", status: "connected" },
      },
    }),
    post: vi.fn(),
  };
  mount(apiClient);
  await screen.findByText("Your availability");
  expect(screen.queryByLabelText("Professional")).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Availability" })[0]);
  await screen.findByLabelText("Monday start");
  expect(screen.getByLabelText("Monday start")).toHaveValue("09:00");
  fireEvent.change(screen.getByLabelText("Monday start"), {
    target: { value: "10:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save availability" }));
  await screen.findByText("Availability saved.");
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/booking/availability",
    expect.objectContaining({
      version: 3,
      weekly: [{ day: 1, start: "10:00", end: "12:00" }],
    }),
  );
  expect(screen.getByText("Google Calendar connected")).toBeInTheDocument();
});

it("shows tenant-zone reservation details and reports failed delivery before cancellation", async () => {
  const reservation = {
    id: "reservation-1",
    serviceId: "consult",
    professionalId: "professional-1",
    serviceName: "Consultation",
    professionalName: "Ari",
    startsAt: "2026-10-05T14:00:00Z",
    endsAt: "2026-10-05T14:30:00Z",
    customerName: "Casey Customer",
    customerEmail: "casey@example.test",
    status: "confirmed" as const,
    version: 8,
    deliveryStatus: "failed: SMTP unavailable",
    calendarStatus: "not_configured",
  };
  const bootstrap = {
    settings,
    candidates: [{ principalId: "principal-1", displayName: "Ari" }],
    canManage: true,
    principalId: "principal-1",
    publicUrl: null,
    calendar: { provider: null, status: "not_connected" },
  };
  const apiClient = {
    get: vi
      .fn()
      .mockResolvedValueOnce({ data: bootstrap })
      .mockResolvedValueOnce({ data: [reservation] }),
    put: vi.fn(),
    post: vi.fn().mockResolvedValue({
      data: { ...reservation, status: "cancelled", version: 9 },
    }),
  };
  mount(apiClient);
  await screen.findByRole("heading", { name: "Appointments" });
  fireEvent.click(screen.getByRole("button", { name: "Reservations" }));
  expect(await screen.findByText("Casey Customer")).toBeInTheDocument();
  expect(screen.getByText("casey@example.test")).toBeInTheDocument();
  expect(screen.getByText("failed: SMTP unavailable")).toHaveClass(
    "text-destructive",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
  expect(await screen.findByText("Reservation cancelled.")).toBeInTheDocument();
  expect(apiClient.post).toHaveBeenCalledWith(
    "/v1/tenants/42/booking/reservations/reservation-1/cancel",
    { version: 8 },
  );
  expect(apiClient.get.mock.calls[1][0]).toMatch(
    /^\/v1\/tenants\/42\/booking\/reservations\?from=/,
  );
  expect(apiClient.get.mock.calls[1][0]).toContain("&to=");
});

it("refreshes reservation conference state for the current tenant", async () => {
  const bootstrap = {
    settings,
    candidates: [],
    canManage: true,
    principalId: "principal-1",
    publicUrl: null,
    calendar: { provider: null, status: "not_connected" },
  };
  const reservation = {
    id: "reservation-2",
    serviceId: "consult",
    professionalId: "professional-1",
    serviceName: "Consultation",
    professionalName: "Ari",
    startsAt: "2026-10-05T14:00:00Z",
    endsAt: "2026-10-05T14:30:00Z",
    customerName: "Casey Customer",
    customerEmail: "casey@example.test",
    status: "confirmed" as const,
    version: 1,
    deliveryStatus: "sent",
    calendarStatus: "created",
    conference: { provider: "google_meet", joinUrl: null, status: "pending" },
  };
  const apiClient = {
    get: vi
      .fn()
      .mockResolvedValueOnce({ data: bootstrap })
      .mockResolvedValueOnce({ data: [reservation] })
      .mockResolvedValueOnce({
        data: [
          {
            ...reservation,
            conference: {
              provider: "google_meet",
              joinUrl: "https://meet.google.com/abc-defg-hij",
              status: "ready",
            },
          },
        ],
      }),
    put: vi.fn(),
    post: vi.fn(),
  };
  mount(apiClient, 42);
  await screen.findByRole("heading", { name: "Appointments" });
  fireEvent.click(screen.getByRole("button", { name: "Reservations" }));
  expect(
    await screen.findByText(/link is being prepared/i),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("link", { name: "Join Google Meet" }),
  ).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
  expect(apiClient.get.mock.calls[2][0]).toMatch(
    /^\/v1\/tenants\/42\/booking\/reservations\?from=/,
  );
});

it("edits multiple weekly periods with time controls and saves each interval", async () => {
  const bootstrap = {
    settings,
    candidates: [{ principalId: "principal-1", displayName: "Ari" }],
    canManage: false,
    principalId: "principal-1",
    publicUrl: null,
    calendar: { provider: null, status: "not_connected" },
  };
  const apiClient = {
    get: vi.fn().mockResolvedValue({ data: bootstrap }),
    put: vi.fn().mockResolvedValue({
      data: {
        ...bootstrap,
        settings: {
          ...settings,
          version: 4,
          professionals: [
            {
              ...settings.professionals[0],
              weekly: [
                { day: 1, start: "09:00", end: "12:00" },
                { day: 1, start: "13:00", end: "14:00" },
              ],
            },
          ],
        },
      },
    }),
    post: vi.fn(),
  };
  mount(apiClient);
  await screen.findByText("Your availability");
  fireEvent.click(screen.getAllByRole("button", { name: "Availability" })[0]);
  await screen.findByLabelText("Monday start");
  fireEvent.click(screen.getAllByRole("button", { name: "Add period" })[0]);
  fireEvent.change(screen.getByLabelText("Monday start 2"), {
    target: { value: "13:00" },
  });
  fireEvent.change(screen.getByLabelText("Monday end 2"), {
    target: { value: "14:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save availability" }));
  await screen.findByText("Availability saved.");
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/booking/availability",
    expect.objectContaining({
      version: 3,
      weekly: [
        { day: 1, start: "09:00", end: "12:00" },
        { day: 1, start: "13:00", end: "14:00" },
      ],
    }),
  );
});

function managementClient() {
  const bootstrap = {
    settings: structuredClone(settings),
    candidates: [{ principalId: "principal-1", displayName: "Ari" }],
    canManage: true,
    principalId: "principal-1",
    publicUrl: null,
    calendar: { provider: null, status: "not_connected" },
  };
  return {
    get: vi.fn().mockResolvedValue({ data: bootstrap }),
    put: vi.fn().mockImplementation(async (_path, value) => ({
      data: { ...bootstrap, settings: { ...value, version: 4 } },
    })),
  };
}

it("guides configuration through steps and keeps edits when going back", async () => {
  mount(managementClient());
  await screen.findByLabelText("Public title");
  expect(screen.queryByLabelText("Service name")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Public title"), {
    target: { value: "New agenda" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByLabelText("Professional")).toHaveValue("principal-1");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Public title")).toHaveValue("New agenda");
});

it("removes a service from the saved configuration", async () => {
  const apiClient = managementClient();
  mount(apiClient);
  await screen.findByLabelText("Public title");
  fireEvent.click(screen.getByRole("button", { name: "Services" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Remove service Consultation" }),
  );
  expect(screen.queryByLabelText("Service name")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Booking settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/booking",
    expect.objectContaining({ services: [], published: false }),
  );
});

it("removes a professional and cleans service assignments", async () => {
  const apiClient = managementClient();
  mount(apiClient);
  await screen.findByLabelText("Public title");
  fireEvent.click(screen.getByRole("button", { name: "Team" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Remove professional Ari" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Booking settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/booking",
    expect.objectContaining({
      professionals: [],
      services: [expect.objectContaining({ professionalIds: [] })],
    }),
  );
});

it("edits weekly availability inside the setup wizard", async () => {
  const apiClient = managementClient();
  mount(apiClient);
  await screen.findByLabelText("Public title");
  fireEvent.click(screen.getByRole("button", { name: "Hours" }));
  fireEvent.change(screen.getByLabelText("Monday start"), {
    target: { value: "10:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText("Booking settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/booking",
    expect.objectContaining({
      professionals: [
        expect.objectContaining({
          weekly: [{ day: 1, start: "10:00", end: "12:00" }],
        }),
      ],
    }),
  );
});

it("blocks saving overlapping weekly periods and opens the hours step", async () => {
  const apiClient = managementClient();
  const data = await apiClient.get();
  data.data.settings.professionals[0].weekly.push({
    day: 1,
    start: "11:00",
    end: "14:00",
  });
  mount(apiClient);
  await screen.findByLabelText("Public title");
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "non-overlapping periods",
  );
  expect(screen.getByRole("heading", { name: "Hours" })).toBeInTheDocument();
  expect(apiClient.put).not.toHaveBeenCalled();
});

it("saves deleting the last published service as an unpublished draft", async () => {
  const apiClient = managementClient();
  const data = await apiClient.get();
  data.data.settings.published = true;
  mount(apiClient);
  await screen.findByLabelText("Public title");
  fireEvent.click(screen.getByRole("button", { name: "Services" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Remove service Consultation" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Booking settings saved.");
  expect(apiClient.put).toHaveBeenCalledWith(
    "/v1/tenants/42/booking",
    expect.objectContaining({ published: false, services: [] }),
  );
});

it("restores a removed service when discarding unsaved changes", async () => {
  mount(managementClient());
  await screen.findByLabelText("Public title");
  fireEvent.click(screen.getByRole("button", { name: "Services" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Remove service Consultation" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByLabelText("Service name")).toHaveValue("Consultation");
});

it("opens authenticated reservations for the appointment date from My Day", async () => {
  const apiClient = {
    get: vi.fn(async (path: string) => ({
      data: path.includes("/reservations?")
        ? []
        : {
            settings,
            candidates: [],
            canManage: true,
            principalId: "principal-1",
            publicUrl: null,
            calendar: { provider: null, status: "not_connected" },
          },
    })),
  };
  mount(apiClient, 42, "/bookings?tab=reservations&date=2025-03-09");
  await screen.findByText("No reservations in this period.");
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith(
      expect.stringContaining("/reservations?"),
    ),
  );
  expect(screen.getByRole("button", { name: "Reservations" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const path = apiClient.get.mock.calls.find(([path]) =>
    path.includes("/reservations?"),
  )![0];
  const query = new URL(path, "https://example.test").searchParams;
  expect(query.get("from")).toBe(new Date("2025-03-09T00:00:00").toISOString());
  expect(query.get("to")).toBe(new Date("2025-03-10T00:00:00").toISOString());
  expect(screen.getByText("Reservations for March 9, 2025")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Show upcoming reservations" }),
  );
  await waitFor(() =>
    expect(
      apiClient.get.mock.calls.filter(([path]) =>
        path.includes("/reservations?"),
      ).length,
    ).toBe(2),
  );
  expect(
    screen.queryByText("Reservations for March 9, 2025"),
  ).not.toBeInTheDocument();
});

it("ignores an invalid appointment date without sending an invalid range", async () => {
  const apiClient = {
    get: vi.fn(async (path: string) => ({
      data: path.includes("/reservations?")
        ? []
        : {
            settings,
            candidates: [],
            canManage: true,
            principalId: "principal-1",
            publicUrl: null,
            calendar: { provider: null, status: "not_connected" },
          },
    })),
  };
  mount(apiClient, 42, "/bookings?tab=reservations&date=2025-02-30");
  await screen.findByText("No reservations in this period.");
  await waitFor(() =>
    expect(apiClient.get).toHaveBeenCalledWith(
      expect.stringContaining("/reservations?"),
    ),
  );
  const path = apiClient.get.mock.calls.find(([path]) =>
    path.includes("/reservations?"),
  )![0];
  const query = new URL(path, "https://example.test").searchParams;
  expect(Number.isFinite(Date.parse(query.get("from")!))).toBe(true);
  expect(query.get("from")).not.toBe("2025-03-02T00:00:00.000Z");
});

it("uses the shared route loading layout while booking settings are fetched", () => {
  mount({ get: vi.fn(() => new Promise(() => {})), put: vi.fn() });
  expect(screen.getByRole("status")).toHaveTextContent(
    "Loading booking settings…",
  );
  expect(
    screen.getByRole("status").querySelector('[data-slot="skeleton"]'),
  ).toBeInTheDocument();
});
