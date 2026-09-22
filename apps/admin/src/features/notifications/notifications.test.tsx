import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationBell } from "./notification-bell";
import { NotificationInbox } from "./notification-inbox";
import type { NotificationClient } from "./client";

afterEach(cleanup);

function setupNoRetry(client: Partial<NotificationClient>) {
  const full = {
    inbox: async () => ({ items: [], nextCursor: null, cutoff: "" }),
    unreadCount: async () => 0,
    setRead: async () => {},
    archive: async () => {},
    readAll: async () => ({ updated: 0, nextCursor: null }),
    resolve: async () => {},
    ...client,
  } as NotificationClient;
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <MemoryRouter>
        <NotificationInbox client={full} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return full;
}

function setup(client: Partial<NotificationClient>) {
  const full = {
    inbox: async () => ({ items: [], nextCursor: null, cutoff: "" }),
    unreadCount: async () => 0,
    setRead: async () => {},
    archive: async () => {},
    readAll: async () => ({ updated: 0, nextCursor: null }),
    resolve: async () => {},
    ...client,
  } as NotificationClient;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <NotificationBell client={full} />
        <NotificationInbox client={full} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return full;
}

it("shows the unread badge and opens the inbox dialog", async () => {
  setup({ unreadCount: async () => 3 });
  expect(
    await screen.findByLabelText("savia.notificationInbox.title (3)"),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "savia.notificationInbox.title (3)" }),
  );
  expect(await screen.findByRole("dialog")).toBeVisible();
});

it("paginates filters and retries failed mutations", async () => {
  const setRead = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  setup({
    inbox: async () => ({
      items: [
        {
          id: "n1",
          title: "Review",
          body: "",
          createdAt: Date.now(),
          readAt: null,
          archivedAt: null,
          source: { kind: "admin-message", id: "m1" },
          actionState: "pending",
        },
      ],
      nextCursor: null,
      cutoff: "",
    }),
    setRead,
  });
  await screen.findByText("Review");
  fireEvent.click(
    screen.getByRole("button", { name: "savia.notificationInbox.markRead" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "savia.notificationInbox.actionError",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "savia.notificationInbox.markRead" }),
  );
  await screen.findByText("Review");
  expect(setRead).toHaveBeenCalledTimes(2);
  fireEvent.click(
    screen.getByRole("tab", { name: "savia.notificationInbox.pending" }),
  );
  await screen.findByText("Review");
});

it("shows an empty state without the load error when the inbox is empty", async () => {
  setup({});
  expect(await screen.findByTestId("notifications-empty")).toBeVisible();
  expect(screen.getByText("savia.notificationInbox.empty")).toBeVisible();
  expect(
    screen.queryByText("savia.notificationInbox.loadError"),
  ).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("tab", { name: "savia.notificationInbox.unread" }),
  );
  expect(
    await screen.findByRole("button", {
      name: "savia.notificationInbox.showAll",
    }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "savia.notificationInbox.showAll" }),
  );
  expect(
    screen.getByRole("tab", { name: "savia.notificationInbox.all" }),
  ).toHaveAttribute("aria-selected", "true");
});

it("shows a retryable error without the empty state when loading fails", async () => {
  const inbox = vi.fn().mockRejectedValue(new Error("offline"));
  setupNoRetry({ inbox });
  expect(
    await screen.findByText("savia.notificationInbox.loadError"),
  ).toBeVisible();
  expect(screen.queryByTestId("notifications-empty")).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "savia.notificationInbox.retry" }),
  );
  await vi.waitFor(() => expect(inbox.mock.calls.length).toBeGreaterThan(1));
});
