import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CollectionFollow } from "./collection-follow";
import { AdminNoticeForm } from "./admin-notice-form";
import { AdminNoticeStatus } from "./admin-notice-status";
import type { NotificationClient } from "./client";

afterEach(cleanup);

function baseClient(overrides: Partial<NotificationClient> = {}): NotificationClient {
  return {
    inbox: async () => ({ items: [], nextCursor: null, cutoff: "" }),
    unreadCount: async () => 0,
    setRead: async () => {},
    archive: async () => {},
    readAll: async () => ({ updated: 0, nextCursor: null }),
    resolve: async () => {},
    follows: async () => [],
    follow: async () => {},
    unfollow: async () => {},
    sendAdminNotice: async () => ({ eventId: "e1", status: "accepted", duplicate: false }),
    adminStatus: async () => ({ status: "accepted", delivered: 0, failed: 0, pendingRetries: 0 }),
    ...overrides,
  } as NotificationClient;
}

function renderWith(client: NotificationClient, ui: React.ReactNode) {
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
  return client;
}

it("toggles collection follows and surfaces failures", async () => {
  const follow = vi.fn().mockResolvedValue(undefined);
  const followClient = baseClient({ follows: async () => [], follow });
  renderWith(followClient, <CollectionFollow collection="requests" client={followClient} />);
  const followButton = await screen.findByRole("button", { name: "savia.notificationInbox.follow" });
  await vi.waitFor(() => expect(followButton).not.toBeDisabled());
  fireEvent.click(followButton);
  expect(follow).toHaveBeenCalledWith("requests");

  cleanup();
  const failing = vi.fn().mockRejectedValue(new Error("offline"));
  const failingClient = baseClient({ follows: async () => ["requests"], unfollow: failing });
  renderWith(failingClient, <CollectionFollow collection="requests" client={failingClient} />);
  fireEvent.click(await screen.findByRole("button", { name: "savia.notificationInbox.unfollow" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("savia.notificationInbox.actionError");
});

it("hides the administrator form without permission and reports 429", async () => {
  const { container } = (() => {
    const result = render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminNoticeForm scope="agency:1" canAdminister={false} />
      </QueryClientProvider>,
    );
    return result;
  })();
  expect(container).toBeEmptyDOMElement();

  cleanup();
  const sendAdminNotice = vi.fn().mockRejectedValue(new Error("429 quota"));
  renderWith(
    baseClient({ sendAdminNotice }),
    <AdminNoticeForm scope="agency:1" canAdminister client={baseClient({ sendAdminNotice })} />,
  );
  fireEvent.change(screen.getByLabelText("savia.notificationInbox.adminSubject"), {
    target: { value: "Downtime" },
  });
  fireEvent.change(screen.getByLabelText("savia.notificationInbox.adminRecipients"), {
    target: { value: "alice" },
  });
  fireEvent.click(screen.getByRole("button", { name: "savia.notificationInbox.adminSend" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("savia.notificationInbox.quotaExceeded");
});

it("shows accepted delivery status for administrators", async () => {
  const client = baseClient({
    sendAdminNotice: async () => ({ eventId: "evt-9", status: "accepted", duplicate: true }),
    adminStatus: async () => ({ status: "processing", delivered: 4, failed: 1, pendingRetries: 2 }),
  });
  renderWith(
    client,
    <>
      <AdminNoticeForm scope="agency:1" canAdminister client={client} />
      <AdminNoticeStatus eventId="evt-9" client={client} />
    </>,
  );
  expect(await screen.findByText("processing")).toBeVisible();
  expect(await screen.findByText("4")).toBeVisible();
});
