import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { memoryStore, StoreContextProvider } from "ra-core";
import { CalendarView } from "./calendar-view";
import type { AgendaState } from "./agenda-widget";
import { AppLocaleProvider } from "@/i18n/app-locale-provider";

afterEach(cleanup);

function Harness() {
  const agenda = {
    selectedDay: new Date(2026, 9, 3),
    setSelectedDay: () => {},
    view: "month",
    setView: () => {},
    bounds: { start: new Date(2026, 8, 28), end: new Date(2026, 11, 2) },
    sources: {
      sources: [],
      events: [],
      preferences: { google_calendar: true, outlook: true },
      errors: {},
      loading: false,
      available: true,
      refresh: async () => {},
      addSource: async () => {},
      updateSource: async () => {},
      removeSource: async () => {},
      savePreferences: async () => {},
    },
    events: [],
    bookings: {
      entries: [],
      loading: false,
      error: false,
      refresh: async () => {},
    },
    calendarProviders: [],
    loading: false,
    syncError: null,
    timeZone: "UTC",
    personalIntegrations: {},
    refresh: async () => {},
  } as unknown as AgendaState;
  return <CalendarView agenda={agenda} legacyDay={<div />} />;
}

describe("calendar localization", () => {
  it("updates calendar controls and date labels when the locale changes", async () => {
    const store = memoryStore({ locale: "es" });
    render(
      <StoreContextProvider value={store}>
        <AppLocaleProvider>
          <Harness />
        </AppLocaleProvider>
      </StoreContextProvider>,
    );

    expect(screen.getByRole("button", { name: "Día" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /octubre de 2026/i }),
    ).toBeVisible();
    act(() => store.setItem("locale", "en"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Day" })).toBeVisible(),
    );
    expect(
      screen.getByRole("heading", { name: /October 2026/i }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Manage calendars" }));
    expect(screen.getByRole("heading", { name: "Add calendar" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Calendar name"), {
      target: { value: "Personal" },
    });
    fireEvent.change(screen.getByLabelText("HTTPS or WebCal link"), {
      target: { value: "https://calendar.example.test/feed.ics" },
    });
    fireEvent.change(screen.getByLabelText("Source time zone"), {
      target: { value: "Not/AZone" },
    });
    fireEvent.submit(screen.getByLabelText("Calendar name").closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid time zone",
    );
    act(() => store.setItem("locale", "pt"));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Adicionar calendário" }),
      ).toBeVisible(),
    );
    expect(
      screen.getByRole("heading", { name: /outubro de 2026/i }),
    ).toBeVisible();
    expect(screen.getByLabelText("Nome do calendário")).toHaveValue("Personal");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Informe um fuso horário válido",
    );
  });
});
