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
  apiClient: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> },
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
    await screen.findByText("https://savia.test/public/bookings/link-token"),
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
