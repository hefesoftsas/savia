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

it("mounts the configured PublicForms Turnstile adapter with booking page identity", async () => {
  const optionsSeen: Record<string, unknown>[] = [];
  const turnstile = {
    render: vi.fn((_element: HTMLElement, options: Record<string, unknown>) => {
      optionsSeen.push(options);
      return "booking-widget";
    }),
    remove: vi.fn(),
    reset: vi.fn(),
  };
  window.turnstile = turnstile;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      new URL(String(input), "https://savia.test").pathname.endsWith("/slots")
        ? Response.json({
            data: {
              slots: [
                {
                  startsAt: "2026-10-05T14:00:00Z",
                  endsAt: "2026-10-05T14:30:00Z",
                },
              ],
              timeZone: "America/Bogota",
            },
          })
        : Response.json({
            data: {
              id: "booking-page-identity",
              title: "Book a visit",
              description: "Choose a time",
              timeZone: "America/Bogota",
              cancellationMinutes: 120,
              services: [
                {
                  id: "consult",
                  name: "Consultation",
                  description: "First visit",
                  durationMinutes: 30,
                  professionalIds: ["pro-1"],
                },
              ],
              professionals: [{ id: "pro-1", name: "Ari" }],
              captcha: {
                captchaProvider: "turnstile",
                siteKey: "booking-site-key",
              },
            },
          }),
    ),
  );
  const view = render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <PublicBookingPage token="public-token-1234567890123456" />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  await screen.findByRole("heading", { name: "Book a visit" });
  fireEvent.change(screen.getByLabelText("Service"), {
    target: { value: "consult" },
  });
  fireEvent.change(screen.getByLabelText("Professional"), {
    target: { value: "pro-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Date"), {
    target: { value: "2026-10-05" },
  });
  await screen.findByRole("option", { name: /9:00 AM/ });
  fireEvent.change(screen.getByLabelText("Available time"), {
    target: { value: "2026-10-05T14:00:00Z" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(turnstile.render).toHaveBeenCalled());
  expect(optionsSeen[0]).toEqual(
    expect.objectContaining({
      action: "public_submit",
      cData: "booking-page-identity",
      sitekey: "booking-site-key",
    }),
  );
  view.unmount();
  expect(turnstile.remove).toHaveBeenCalledWith("booking-widget");
  delete window.turnstile;
});

it("loads public data without private services and retains one idempotency key for retries", async () => {
  const posts: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  let finishFirstAttempt: ((response: Response) => void) | undefined;
  let failed = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://savia.test");
      if (url.pathname === "/api/public/bookings/public-token-1234567890123456")
        return Response.json({
          data: {
            id: "page-id",
            title: "Book a visit",
            description: "Choose a time",
            timeZone: "America/Bogota",
            cancellationMinutes: 120,
            services: [
              {
                id: "consult",
                name: "Consultation",
                description: "First visit",
                durationMinutes: 30,
                professionalIds: ["pro-1"],
              },
            ],
            professionals: [{ id: "pro-1", name: "Ari" }],
            captcha: { captchaProvider: "disabled" },
          },
        });
      if (url.pathname.endsWith("/slots"))
        return Response.json({
          data: {
            slots: [
              {
                startsAt: "2026-10-05T14:00:00Z",
                endsAt: "2026-10-05T14:30:00Z",
              },
            ],
            timeZone: "America/Bogota",
          },
        });
      if (url.pathname.endsWith("/reservations")) {
        posts.push({
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        if (!failed) {
          failed = true;
          return new Promise<Response>((resolve) => {
            finishFirstAttempt = resolve;
          });
        }
        return Response.json({
          data: {
            reservation: {
              id: "r-1",
              startsAt: "2026-10-05T14:00:00Z",
              endsAt: "2026-10-05T14:30:00Z",
              status: "confirmed",
            },
            managementUrl:
              "https://savia.test/public/bookings/manage/manage-token-1234567890123456",
          },
        });
      }
      throw new Error(`Unexpected public request: ${url.pathname}`);
    }),
  );
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <PublicBookingPage token="public-token-1234567890123456" />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  await screen.findByRole("heading", { name: "Book a visit" });
  fireEvent.change(screen.getByLabelText("Service"), {
    target: { value: "consult" },
  });
  fireEvent.change(screen.getByLabelText("Professional"), {
    target: { value: "pro-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Date"), {
    target: { value: "2026-10-05" },
  });
  await screen.findByRole("option", { name: /9:00 AM/ });
  fireEvent.change(screen.getByLabelText("Available time"), {
    target: { value: "2026-10-05T14:00:00Z" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Casey" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "casey@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Book appointment" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(screen.getByLabelText("Your name")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  await act(async () => {
    finishFirstAttempt?.(
      Response.json(
        { error: { code: "TEMPORARY", message: "Try again" } },
        { status: 503 },
      ),
    );
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /Retry with the same request/,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry booking" }));
  await screen.findByText("Appointment confirmed");
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
    }),
  );
});

it("guides a customer through booking steps, preserves choices on back, and clears dependent choices", async () => {
  let slotsAvailable = true;
  let reservationRequests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://savia.test");
      if (url.pathname === "/api/public/bookings/public-token-1234567890123456")
        return Response.json({
          data: {
            id: "page-id",
            title: "Book a visit",
            description: "Choose a time",
            timeZone: "America/Bogota",
            cancellationMinutes: 120,
            services: [
              {
                id: "consult",
                name: "Consultation",
                description: "First visit",
                durationMinutes: 30,
                professionalIds: ["pro-1"],
              },
              {
                id: "follow-up",
                name: "Follow-up",
                description: "Returning visit",
                durationMinutes: 20,
                professionalIds: ["pro-2"],
              },
            ],
            professionals: [
              { id: "pro-1", name: "Ari" },
              { id: "pro-2", name: "Bo" },
            ],
            captcha: { captchaProvider: "disabled" },
          },
        });
      if (url.pathname.endsWith("/slots"))
        return Response.json({
          data: {
            slots: slotsAvailable
              ? [
                  {
                    startsAt: "2026-10-05T14:00:00Z",
                    endsAt: "2026-10-05T14:30:00Z",
                  },
                ]
              : [],
            timeZone: "America/Bogota",
          },
        });
      if (url.pathname.endsWith("/reservations")) {
        reservationRequests += 1;
        return Response.json(
          { error: { message: "Unexpected submission" } },
          { status: 400 },
        );
      }
      throw new Error(`Unexpected public request: ${url.pathname}`);
    }),
  );
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <PublicBookingPage token="public-token-1234567890123456" />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );

  await screen.findByRole("heading", { name: "Book a visit" });
  fireEvent.change(screen.getByLabelText("Service"), {
    target: { value: "consult" },
  });
  fireEvent.change(screen.getByLabelText("Professional"), {
    target: { value: "pro-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Date"), {
    target: { value: "2026-10-05" },
  });
  await screen.findByRole("option", { name: /9:00 AM/ });
  fireEvent.change(screen.getByLabelText("Available time"), {
    target: { value: "2026-10-05T14:00:00Z" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByLabelText("Your name")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Casey" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "casey@example.test" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Date")).toHaveValue("2026-10-05");
  await screen.findByRole("option", { name: /9:00 AM/ });
  expect(screen.getByLabelText("Available time")).toHaveValue(
    "2026-10-05T14:00:00Z",
  );
  fireEvent.submit(document.querySelector("form")!);
  expect(reservationRequests).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  slotsAvailable = false;
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("option", { name: "No available times" });
  expect(screen.getByLabelText("Available time")).toHaveValue("");
  fireEvent.submit(document.querySelector("form")!);
  expect(reservationRequests).toBe(0);
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Service")).toHaveValue("consult");
  expect(screen.getByLabelText("Professional")).toHaveValue("pro-1");

  fireEvent.change(screen.getByLabelText("Service"), {
    target: { value: "follow-up" },
  });
  expect(screen.getByLabelText("Professional")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
});

it("refreshes consumed captcha and stale slots after a definitive conflict", async () => {
  const captchaOptions: Array<Record<string, unknown>> = [];
  const posts: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  let widgetId = 0;
  let slotRequests = 0;
  const turnstile = {
    render: vi.fn((_element: HTMLElement, options: Record<string, unknown>) => {
      captchaOptions.push(options);
      widgetId += 1;
      return `widget-${widgetId}`;
    }),
    remove: vi.fn(),
    reset: vi.fn(),
  };
  window.turnstile = turnstile;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://savia.test");
      if (url.pathname === "/api/public/bookings/public-token-1234567890123456")
        return Response.json({
          data: {
            id: "page-id",
            title: "Book a visit",
            description: "Choose a time",
            timeZone: "America/Bogota",
            cancellationMinutes: 120,
            services: [
              {
                id: "consult",
                name: "Consultation",
                description: "First visit",
                durationMinutes: 30,
                professionalIds: ["pro-1"],
              },
            ],
            professionals: [{ id: "pro-1", name: "Ari" }],
            captcha: { captchaProvider: "turnstile", siteKey: "site-key" },
          },
        });
      if (url.pathname.endsWith("/slots")) {
        slotRequests += 1;
        return Response.json({
          data: {
            slots: [
              {
                startsAt: "2026-10-05T14:00:00Z",
                endsAt: "2026-10-05T14:30:00Z",
              },
            ],
            timeZone: "America/Bogota",
          },
        });
      }
      if (url.pathname.endsWith("/reservations")) {
        posts.push({
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        if (posts.length === 1)
          return Response.json(
            { error: { message: "Slot changed" } },
            { status: 409 },
          );
        return Response.json({
          data: {
            reservation: {
              id: "r-1",
              startsAt: "2026-10-05T14:00:00Z",
              endsAt: "2026-10-05T14:30:00Z",
              status: "confirmed",
            },
            managementUrl: "https://savia.test/manage/token",
          },
        });
      }
      throw new Error(`Unexpected public request: ${url.pathname}`);
    }),
  );
  render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <PublicBookingPage token="public-token-1234567890123456" />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
  await screen.findByRole("heading", { name: "Book a visit" });
  fireEvent.change(screen.getByLabelText("Service"), {
    target: { value: "consult" },
  });
  fireEvent.change(screen.getByLabelText("Professional"), {
    target: { value: "pro-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Date"), {
    target: { value: "2026-10-05" },
  });
  await screen.findByRole("option", { name: /9:00 AM/ });
  const initialSlotRequests = slotRequests;
  fireEvent.change(screen.getByLabelText("Available time"), {
    target: { value: "2026-10-05T14:00:00Z" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Casey" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "casey@example.test" },
  });
  await waitFor(() => expect(captchaOptions).toHaveLength(1));
  act(() =>
    (captchaOptions[0].callback as (value: string) => void)("consumed-proof"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Book appointment" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /Retry with the same request/,
  );
  await waitFor(() => expect(slotRequests).toBe(initialSlotRequests + 1));
  expect(turnstile.remove).toHaveBeenCalledWith("widget-1");
  expect(screen.getByLabelText("Available time")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Available time"), {
    target: { value: "2026-10-05T14:00:00Z" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(captchaOptions).toHaveLength(2));
  act(() =>
    (captchaOptions[1].callback as (value: string) => void)("fresh-proof"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Book appointment" }));
  await screen.findByText("Appointment confirmed");
  expect(posts).toHaveLength(2);
  expect(posts[0].body.captchaToken).toBe("consumed-proof");
  expect(posts[1].body.captchaToken).toBe("fresh-proof");
});
