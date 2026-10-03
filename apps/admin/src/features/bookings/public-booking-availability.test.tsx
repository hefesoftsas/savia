import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { StoreContextProvider, memoryStore } from "ra-core";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PublicBookingAvailability } from "./public-booking-availability";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows an inline month and the selected day's explicit time buttons together", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: {
          displayTimeZone: "America/Bogota",
          businessTimeZone: "America/Bogota",
          days: [
            {
              date: "2026-10-05",
              slots: [
                {
                  startsAt: "2026-10-05T14:00:00Z",
                  endsAt: "2026-10-05T14:30:00Z",
                },
              ],
            },
          ],
        },
      }),
    ),
  );
  const onChange = vi.fn();
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <PublicBookingAvailability
          token="personal-token"
          catalog={{
            id: "page-id",
            timeZone: "America/Bogota",
            horizonDays: 30,
            leadMinutes: 0,
          }}
          serviceId="consult"
          professionalId="pro-1"
          displayTimeZone="America/Bogota"
          onTimeZoneChange={vi.fn()}
          value={undefined}
          onChange={onChange}
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );

  expect(
    screen.getByRole("heading", { name: "Choose a day and time" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: "9:00 AM" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("grid")).toBeInTheDocument();
  expect(document.querySelector('input[type="date"]')).toBeNull();
  expect(
    document.querySelector("select:not([aria-label='Time zone'])"),
  ).toBeNull();
  await waitFor(() => expect(onChange).not.toHaveBeenCalled());
});

it("clears a previously selected UTC slot when its availability refresh fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  const onChange = vi.fn();
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <PublicBookingAvailability
          token="personal-token"
          catalog={{
            id: "page-id",
            timeZone: "America/Bogota",
            horizonDays: 30,
            leadMinutes: 0,
          }}
          serviceId="consult"
          professionalId="pro-1"
          displayTimeZone="America/Bogota"
          onTimeZoneChange={vi.fn()}
          value={{
            professionalId: "pro-1",
            serviceId: "consult",
            displayTimeZone: "America/Bogota",
            slot: {
              startsAt: "2026-10-05T14:00:00Z",
              endsAt: "2026-10-05T14:30:00Z",
            },
          }}
          onChange={onChange}
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Available times could not be loaded",
  );
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(undefined));
});

it("keeps the UTC slot identity when the display time zone changes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: {
          displayTimeZone: "America/New_York",
          businessTimeZone: "America/Bogota",
          days: [
            {
              date: "2026-10-05",
              slots: [
                {
                  startsAt: "2026-10-05T14:00:00Z",
                  endsAt: "2026-10-05T14:30:00Z",
                },
              ],
            },
          ],
        },
      }),
    ),
  );
  const onChange = vi.fn();
  const onTimeZoneChange = vi.fn();
  function ControlledAvailability() {
    const [zone, setZone] = useState("America/Bogota");
    return (
      <PublicBookingAvailability
        token="personal-token"
        catalog={{
          id: "page-id",
          timeZone: "America/Bogota",
          horizonDays: 30,
          leadMinutes: 0,
        }}
        serviceId="consult"
        professionalId="pro-1"
        displayTimeZone={zone}
        onTimeZoneChange={(nextZone) => {
          onTimeZoneChange(nextZone);
          setZone(nextZone);
        }}
        value={{
          professionalId: "pro-1",
          serviceId: "consult",
          displayTimeZone: "America/Bogota",
          slot: {
            startsAt: "2026-10-05T14:00:00Z",
            endsAt: "2026-10-05T14:30:00Z",
          },
        }}
        onChange={onChange}
      />
    );
  }
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <ControlledAvailability />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  await screen.findByRole("button", { name: "9:00 AM" });
  fireEvent.change(screen.getByLabelText("Time zone"), {
    target: { value: "America/New_York" },
  });
  expect(onTimeZoneChange).toHaveBeenCalledWith("America/New_York");
  await waitFor(() =>
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        displayTimeZone: "America/New_York",
        slot: expect.objectContaining({ startsAt: "2026-10-05T14:00:00Z" }),
      }),
    ),
  );
});
