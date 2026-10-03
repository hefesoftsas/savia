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

afterEach(cleanup);

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
) {
  return render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <MemoryRouter>
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
  expect(screen.getByLabelText("Professional")).toHaveValue("principal-1");
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
