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
import { BookingPublicLinksPanel } from "./booking-public-links-panel";

afterEach(cleanup);

function renderPanel(
  apiClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    delete?: ReturnType<typeof vi.fn>;
  },
  canManageTeamLinks = true,
  currentProfessionalId: string | null = "pro-1",
) {
  return render(
    <StoreContextProvider value={memoryStore({ locale: "en" })}>
      <AppLocaleProvider>
        <BookingPublicLinksPanel
          tenantId="42"
          currentProfessionalId={currentProfessionalId}
          canManageTeamLinks={canManageTeamLinks}
          apiClient={apiClient as never}
          services={[{ id: "consult", name: "Consultation" }]}
        />
      </AppLocaleProvider>
    </StoreContextProvider>,
  );
}

it("creates a personal link with the current professional and 30-day, 25-booking defaults", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({ data: { links: [] } }),
    post: vi.fn().mockResolvedValue({
      data: {
        id: "link-1",
        scope: { kind: "professional", professionalId: "pro-1" },
        serviceId: null,
        expiresAt: "2026-11-02T00:00:00Z",
        revokedAt: null,
        dailyLimit: 25,
        version: 1,
        publicUrl: "https://savia.test/public/bookings/link-token",
      },
    }),
  };
  renderPanel(apiClient);

  fireEvent.click(
    await screen.findByRole("button", { name: "Create my booking link" }),
  );
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith(
      "/v1/tenants/42/booking/public-links",
      expect.objectContaining({
        scope: { kind: "professional", professionalId: "pro-1" },
        serviceId: null,
        dailyLimit: 25,
        expiresAt: expect.any(String),
      }),
    ),
  );
  expect(
    await screen.findByDisplayValue(
      "https://savia.test/public/bookings/link-token",
    ),
  ).toBeInTheDocument();
});

it("sends the chosen per-link booking budget and explicit no-expiry choice", async () => {
  const apiClient = {
    get: vi.fn().mockResolvedValue({ data: { links: [] } }),
    post: vi.fn().mockResolvedValue({
      data: {
        id: "link-2",
        scope: { kind: "professional", professionalId: "pro-1" },
        serviceId: null,
        expiresAt: null,
        revokedAt: null,
        dailyLimit: 64,
        version: 1,
        publicUrl: "https://savia.test/public/bookings/link-token-2",
      },
    }),
  };
  renderPanel(apiClient);
  await screen.findByRole("button", { name: "Create my booking link" });
  fireEvent.change(screen.getByLabelText("Daily booking limit"), {
    target: { value: "64" },
  });
  fireEvent.change(screen.getByLabelText("Link expiry"), {
    target: { value: "never" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Create my booking link" }),
  );
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith(
      "/v1/tenants/42/booking/public-links",
      expect.objectContaining({ dailyLimit: 64, expiresAt: null }),
    ),
  );
});

it("requires explicit team sharing and uses the selected link version when revoking", async () => {
  const link = {
    id: "link-1",
    scope: { kind: "team" as const },
    serviceId: null,
    expiresAt: null,
    revokedAt: null,
    dailyLimit: 25,
    version: 8,
    publicUrl: "https://savia.test/public/bookings/team-token",
  };
  const apiClient = {
    get: vi.fn().mockResolvedValue({ data: { links: [link] } }),
    post: vi.fn().mockResolvedValue({
      data: { ...link, revokedAt: "2026-10-03T00:00:00Z", version: 9 },
    }),
  };
  renderPanel(apiClient, true);
  expect(
    await screen.findByRole("button", { name: "Create team agenda link" }),
  ).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Revoke link" }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenCalledWith(
      "/v1/tenants/42/booking/public-links/link-1/revoke",
      { version: 8 },
    ),
  );

  cleanup();
  renderPanel(
    { get: vi.fn().mockResolvedValue({ data: { links: [] } }), post: vi.fn() },
    false,
  );
  expect(
    await screen.findByText(
      "Team booking links are available to booking administrators.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create team agenda link" }),
  ).not.toBeInTheDocument();
});

const existingLink = {
  id: "link-1",
  scope: { kind: "team" as const },
  serviceId: null,
  expiresAt: null,
  revokedAt: null,
  dailyLimit: 25,
  version: 8,
  publicUrl: "https://savia.test/public/bookings/team-token",
};

it("shows the shared loading indicator while links are being fetched", () => {
  renderPanel({ get: vi.fn(() => new Promise(() => {})), post: vi.fn() });
  expect(screen.getByRole("status")).toHaveTextContent(
    "Loading booking links…",
  );
  expect(screen.getByTestId("pwa-spinner")).toBeInTheDocument();
});

it("shows and copies a stored short URL with an accessible icon action", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  renderPanel({
    get: vi.fn().mockResolvedValue({
      data: {
        links: [
          { ...existingLink, shortUrl: "https://savia.test/s/b/short-code" },
        ],
      },
    }),
    post: vi.fn(),
  });
  const button = await screen.findByRole("button", { name: "Copy short link" });
  expect(button).toHaveTextContent("");
  expect(screen.getByLabelText("Short link address")).toHaveValue(
    "https://savia.test/s/b/short-code",
  );
  fireEvent.click(button);
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith("https://savia.test/s/b/short-code"),
  );
  expect(await screen.findByText("Link copied.")).toBeInTheDocument();
});

it("generates a missing short link and offers a retry after failure", async () => {
  renderPanel({
    get: vi.fn().mockResolvedValue({ data: { links: [existingLink] } }),
    post: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        data: { shortUrl: "https://savia.test/s/b/new-code" },
      }),
  });
  fireEvent.click(await screen.findByRole("button", { name: "Shorten URL" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Booking links could not be updated.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Shorten URL" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Short link address")).toHaveValue(
      "https://savia.test/s/b/new-code",
    ),
  );
});

it("requires confirmation before deleting an active link and removes it from the list", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  renderPanel({
    get: vi.fn().mockResolvedValue({ data: { links: [existingLink] } }),
    post: vi.fn(),
    delete: remove,
  });
  fireEvent.click(await screen.findByRole("button", { name: "Delete link" }));
  expect(remove).not.toHaveBeenCalled();
  expect(
    screen.getByText(
      "Existing appointments and their private management links will remain available.",
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel deletion" }));
  expect(
    screen.queryByRole("button", { name: "Confirm deletion" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete link" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
  await waitFor(() =>
    expect(remove).toHaveBeenCalledWith(
      "/v1/tenants/42/booking/public-links/link-1",
      {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 8 }),
      },
    ),
  );
  expect(await screen.findByText("Booking link deleted.")).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Team agenda" }),
  ).not.toBeInTheDocument();
});

it("keeps a revoked link visible if deletion fails", async () => {
  renderPanel({
    get: vi.fn().mockResolvedValue({
      data: {
        links: [{ ...existingLink, revokedAt: "2026-10-03T00:00:00Z" }],
      },
    }),
    post: vi.fn(),
    delete: vi.fn().mockRejectedValue(new Error("offline")),
  });
  fireEvent.click(await screen.findByRole("button", { name: "Delete link" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
  await screen.findByRole("alert");
  expect(
    screen.getByRole("heading", { name: "Team agenda" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Confirm deletion" }),
  ).toBeEnabled();
});

it("lets users retry loading links after a connection failure", async () => {
  renderPanel({
    get: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { links: [existingLink] } }),
    post: vi.fn(),
  });
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("heading", { name: "Team agenda" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
