import { AppLocaleProvider } from "@/i18n/app-locale-provider";
import { StoreContextProvider, memoryStore } from "ra-core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PublicBookingPage } from "./public-booking-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const token = "public-token-1234567890123456";
const slot = {
  startsAt: "2026-10-05T14:00:00Z",
  endsAt: "2026-10-05T14:30:00Z",
};
const catalog = {
  id: "booking-page-identity",
  title: "Book a visit",
  description: "Choose a time",
  timeZone: "America/Bogota",
  cancellationMinutes: 120,
  horizonDays: 30,
  leadMinutes: 0,
  linkScope: { kind: "professional", professionalId: "pro-1" },
  fixedProfessionalId: "pro-1",
  fixedServiceId: null,
  services: [
    {
      id: "consult",
      name: "Consultation",
      description: "First visit",
      durationMinutes: 30,
      professionalIds: ["pro-1"],
    },
  ],
  professionals: [{ id: "pro-1", name: "Ari Ramirez" }],
};

function mountPage() {
  return render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <PublicBookingPage token={token} />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

function availabilityResponse() {
  return Response.json({
    data: {
      displayTimeZone: "America/Bogota",
      businessTimeZone: "America/Bogota",
      days: [{ date: "2026-10-05", slots: [slot] }],
    },
  });
}

async function chooseAvailability() {
  await screen.findByRole("heading", { name: "Choose a day and time" });
  fireEvent.click(await screen.findByRole("button", { name: "9:00 AM" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

it("starts a personal one-service link at inline availability and never asks for a professional", async () => {
  const requested: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://savia.test");
      requested.push(url);
      if (url.pathname.endsWith("/availability")) return availabilityResponse();
      return Response.json({
        data: { ...catalog, captcha: { captchaProvider: "disabled" } },
      });
    }),
  );
  mountPage();

  expect(
    await screen.findByRole("heading", { name: "Choose a day and time" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Booking with Ari Ramirez")).toBeInTheDocument();
  expect(screen.queryByLabelText("Professional")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  expect(document.querySelector('input[type="date"]')).toBeNull();
  expect(document.querySelectorAll("select")).toHaveLength(1); // Display time zone only.
  expect(
    await screen.findByRole("button", { name: "9:00 AM" }),
  ).toBeInTheDocument();
  expect(
    requested.some(
      (url) => url.searchParams.get("from") && url.searchParams.get("to"),
    ),
  ).toBe(true);
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
});

it("uses an accurately numbered service step for a multi-service personal link", async () => {
  const multiCatalog = {
    ...catalog,
    services: [
      ...catalog.services,
      {
        id: "follow-up",
        name: "Follow-up",
        description: "Review progress and agree on next steps.",
        durationMinutes: 20,
        professionalIds: ["pro-1"],
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://savia.test");
      if (url.pathname.endsWith("/availability")) return availabilityResponse();
      return Response.json({
        data: { ...multiCatalog, captcha: { captchaProvider: "disabled" } },
      });
    }),
  );
  mountPage();

  await screen.findByRole("heading", { name: "Choose your appointment" });
  expect(screen.getByText("1 / 3")).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Service");
  expect(
    screen.getByText("Review progress and agree on next steps."),
  ).toBeInTheDocument();
  expect(screen.getByText("Booking with Ari Ramirez")).toBeInTheDocument();
  expect(screen.queryByLabelText("Professional")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /Follow-up/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(
    await screen.findByRole("heading", { name: "Choose a day and time" }),
  ).toBeInTheDocument();
  expect(screen.getByText("2 / 3")).toBeInTheDocument();
});

it("keeps the exact idempotency key and customer locale on an identical retry", async () => {
  const posts: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  let failFirst = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://savia.test");
      if (url.pathname.endsWith("/availability")) return availabilityResponse();
      if (url.pathname.endsWith("/reservations")) {
        posts.push({
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        if (failFirst) {
          failFirst = false;
          return Response.json(
            { error: { message: "Try again" } },
            { status: 503 },
          );
        }
        return Response.json({
          data: {
            reservation: {
              ...slot,
              conference: {
                provider: "google_meet",
                joinUrl: "https://meet.google.com/abc-defg-hij",
                status: "ready",
              },
            },
            managementUrl: "https://savia.test/manage/private-token",
          },
        });
      }
      return Response.json({
        data: { ...catalog, captcha: { captchaProvider: "disabled" } },
      });
    }),
  );
  mountPage();
  await screen.findByRole("heading", { name: "Book a visit" });
  await chooseAvailability();
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Casey" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "casey@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Book appointment" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Retry with the same request",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry booking" }));
  await screen.findByText("Appointment confirmed");
  expect(
    screen.getByRole("link", { name: "Join Google Meet" }),
  ).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");

  expect(posts).toHaveLength(2);
  expect(posts[0].headers.get("Idempotency-Key")).toBeTruthy();
  expect(posts[1].headers.get("Idempotency-Key")).toBe(
    posts[0].headers.get("Idempotency-Key"),
  );
  expect(posts[0].body).toEqual(
    expect.objectContaining({
      serviceId: "consult",
      professionalId: "pro-1",
      customerName: "Casey",
      customerEmail: "casey@example.test",
      customerLocale: "en",
    }),
  );
});

it("preserves contact details and reloads availability after a slot conflict", async () => {
  const captchaOptions: Array<Record<string, unknown>> = [];
  const posts: Array<Record<string, unknown>> = [];
  let rangeRequests = 0;
  let widgetId = 0;
  window.turnstile = {
    render: vi.fn((_element: HTMLElement, options: Record<string, unknown>) => {
      captchaOptions.push(options);
      widgetId += 1;
      return `widget-${widgetId}`;
    }),
    remove: vi.fn(),
    reset: vi.fn(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://savia.test");
      if (url.pathname.endsWith("/availability")) {
        rangeRequests += 1;
        return availabilityResponse();
      }
      if (url.pathname.endsWith("/reservations")) {
        posts.push(JSON.parse(String(init?.body)));
        if (posts.length === 1)
          return Response.json(
            {
              error: {
                code: "BOOKING_TIME_CONFLICT",
                message: "Slot conflicts with a meeting",
              },
            },
            { status: 409 },
          );
        return Response.json({
          data: {
            reservation: slot,
            managementUrl: "https://savia.test/manage/private-token",
          },
        });
      }
      return Response.json({
        data: {
          ...catalog,
          captcha: { captchaProvider: "turnstile", siteKey: "site-key" },
        },
      });
    }),
  );
  mountPage();
  await screen.findByRole("heading", { name: "Book a visit" });
  await chooseAvailability();
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Casey" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "casey@example.test" },
  });
  await waitFor(() => expect(captchaOptions).toHaveLength(1));
  act(() =>
    (captchaOptions[0].callback as (proof: string) => void)("first-proof"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Book appointment" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That time conflicts with another meeting or appointment. Choose another available time.",
  );
  await waitFor(() => expect(rangeRequests).toBeGreaterThan(1));
  expect(window.turnstile.remove).toHaveBeenCalledWith("widget-1");
  fireEvent.click(await screen.findByRole("button", { name: "9:00 AM" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByLabelText("Your name")).toHaveValue("Casey");
  await waitFor(() => expect(captchaOptions).toHaveLength(2));
  act(() =>
    (captchaOptions[1].callback as (proof: string) => void)("fresh-proof"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Book appointment" }));
  await screen.findByText("Appointment confirmed");
  expect(posts).toHaveLength(2);
  expect(posts[0].captchaToken).toBe("first-proof");
  expect(posts[1].captchaToken).toBe("fresh-proof");
});
