import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { StoreContextProvider, memoryStore } from "ra-core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BookingConference } from "./booking-conference";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderConference(
  conference: {
    provider: "google_meet" | "teams" | "jitsi" | "zoom" | null;
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
  ["zoom", "https://us02web.zoom.us/j/123?pwd=abc", "Join Zoom"],
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

it("rejects a deceptive Zoom hostname", () => {
  renderConference({
    provider: "zoom",
    joinUrl: "https://zoom.us.evil.test/j/123",
    status: "ready",
  });
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it.each([
  "https://evil.example/room",
  "https://meet.jit.si.evil.example/room",
  "https://meet.jit.si/",
  "https://meet.jit.si/room/extra",
])("hides an invalid Jitsi room %s", (joinUrl) => {
  renderConference({ provider: "jitsi", joinUrl, status: "ready" });
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

const meetingUrl = "https://us02web.zoom.us/j/123?pwd=abc";
function readyConference() {
  return renderConference({
    provider: "zoom",
    joinUrl: meetingUrl,
    status: "ready",
  });
}
it("copies the participant link, including its passcode, with success feedback", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  readyConference();
  fireEvent.click(screen.getByRole("button", { name: "Copy meeting link" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Link copied.");
  expect(writeText).toHaveBeenCalledWith(meetingUrl);
});
it("shares the participant URL with the system share sheet", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { share });
  readyConference();
  fireEvent.click(screen.getByRole("button", { name: "Share meeting link" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Link shared.");
  expect(share).toHaveBeenCalledWith({ url: meetingUrl });
});
it("copies when native sharing is unavailable", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  readyConference();
  fireEvent.click(screen.getByRole("button", { name: "Share meeting link" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Link copied.");
  expect(writeText).toHaveBeenCalledWith(meetingUrl);
});
it("keeps a selectable link when clipboard access fails", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  readyConference();
  fireEvent.click(screen.getByRole("button", { name: "Copy meeting link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Select the link and copy it manually.",
  );
  expect(screen.getByRole("textbox", { name: "Meeting link" })).toHaveValue(
    meetingUrl,
  );
  expect(screen.getByRole("textbox", { name: "Meeting link" })).toHaveAttribute(
    "readonly",
  );
});
it("does not report failure when the user dismisses sharing", async () => {
  vi.stubGlobal("navigator", {
    share: vi
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "AbortError")),
  });
  readyConference();
  fireEvent.click(screen.getByRole("button", { name: "Share meeting link" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Share meeting link" }),
    ).toBeEnabled(),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("never exposes sharing controls for cancelled or unsafe meetings", () => {
  renderConference(
    { provider: "zoom", joinUrl: meetingUrl, status: "ready" },
    "cancelled",
  );
  expect(
    screen.queryByRole("button", { name: "Copy meeting link" }),
  ).not.toBeInTheDocument();
  cleanup();
  renderConference({
    provider: "zoom",
    joinUrl: "https://zoom.us.evil.test/j/1",
    status: "ready",
  });
  expect(
    screen.queryByRole("button", { name: "Share meeting link" }),
  ).not.toBeInTheDocument();
});
