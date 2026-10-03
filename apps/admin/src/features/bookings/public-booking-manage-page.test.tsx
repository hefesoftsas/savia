import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { StoreContextProvider, memoryStore } from "ra-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PublicBookingManagePage } from "./public-booking-manage-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("reschedules through the public page token from publicUrl and keeps the reservation revision", async () => {
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
          },
        });
      if (
        path ===
        "/api/public/bookings/manage/manage-token-1234567890123456/slots"
      )
        return Response.json({
          data: {
            timeZone: "America/Bogota",
            slots: [
              {
                startsAt: "2026-10-06T15:00:00Z",
                endsAt: "2026-10-06T15:30:00Z",
              },
            ],
          },
        });
      if (path.endsWith("/reschedule"))
        return Response.json({
          data: {
            ...reservation,
            startsAt: "2026-10-06T15:00:00Z",
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
  fireEvent.change(screen.getByLabelText("Date"), {
    target: { value: "2026-10-06" },
  });
  await screen.findByRole("option", { name: /10:00 AM/ });
  fireEvent.change(screen.getByLabelText("Available time"), {
    target: { value: "2026-10-06T15:00:00Z" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save new time" }));
  await screen.findByText("Confirmed");
  expect(
    calls.some(
      (call) =>
        call.path ===
        "/api/public/bookings/manage/manage-token-1234567890123456/slots?date=2026-10-06",
    ),
  ).toBe(true);
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
