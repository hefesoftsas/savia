import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { StoreContextProvider, memoryStore } from "ra-core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BookingConference } from "./booking-conference";

afterEach(cleanup);

function renderConference(
  conference: {
    provider: "google_meet" | "teams" | "jitsi" | null;
    joinUrl: string | null;
    status: "ready" | "pending" | "unsupported" | "failed";
  } | null,
  status: "confirmed" | "cancelled" = "confirmed",
) {
  return render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <BookingConference conference={conference} status={status} />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

it.each([
  ["jitsi", "https://meet.jit.si/savia-test-room", "Join Jitsi"],
  ["google_meet", "https://meet.google.com/abc-defg-hij", "Join Google Meet"],
  ["teams", "https://teams.microsoft.com/l/meetup-join/123", "Join Teams"],
  ["teams", "https://teams.cloud.microsoft/meet/123", "Join Teams"],
  ["teams", "https://gov.teams.microsoft.us/l/meetup-join/123", "Join Teams"],
  ["teams", "https://dod.teams.microsoft.us/l/meetup-join/123", "Join Teams"],
  ["teams", "https://teams.microsoftonline.cn/l/meetup-join/123", "Join Teams"],
] as const)("renders the safe %s join link", (provider, joinUrl, label) => {
  renderConference({ provider, joinUrl, status: "ready" });
  expect(screen.getByRole("link", { name: label })).toHaveAttribute(
    "href",
    joinUrl,
  );
  expect(screen.getByRole("link", { name: label })).toHaveAttribute(
    "target",
    "_blank",
  );
});

it("explains pending, unsupported, and failed conference states", () => {
  const { rerender } = renderConference({
    provider: "google_meet",
    joinUrl: null,
    status: "pending",
  });
  expect(screen.getByText(/link is being prepared/i)).toBeInTheDocument();
  expect(screen.getByText(/refresh/i)).toBeInTheDocument();

  rerender(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <BookingConference
          conference={{ provider: null, joinUrl: null, status: "unsupported" }}
          status="confirmed"
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  expect(screen.getByText(/not available/i)).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();

  rerender(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <BookingConference
          conference={{ provider: "teams", joinUrl: null, status: "failed" }}
          status="confirmed"
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  expect(screen.getByText(/could not be created/i)).toBeInTheDocument();
});

it.each([
  "http://meet.google.com/abc-defg-hij",
  "javascript:alert(1)",
  "https://user:password@teams.microsoft.com/meet/123",
  "https://example.test/meet/123",
])("hides unsafe conference URL %s", (joinUrl) => {
  renderConference({ provider: "google_meet", joinUrl, status: "ready" });
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByText(/link is unavailable/i)).toBeInTheDocument();
});

it("hides conference details after cancellation", () => {
  renderConference(
    {
      provider: "google_meet",
      joinUrl: "https://meet.google.com/abc-defg-hij",
      status: "ready",
    },
    "cancelled",
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it.each([
  "https://evil.example/room",
  "https://meet.jit.si.evil.example/room",
  "https://meet.jit.si/",
])("hides an invalid Jitsi room %s", (joinUrl) => {
  renderConference({ provider: "jitsi", joinUrl, status: "ready" });
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
