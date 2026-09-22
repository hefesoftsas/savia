import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationBell } from "./notification-bell";
import { NotificationInbox } from "./notification-inbox";
import type { NotificationClient } from "./client";

afterEach(cleanup);

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
  expect(await screen.findByLabelText("savia.notificationInbox.title (3)")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "savia.notificationInbox.title (3)" }));
  expect(await screen.findByRole("dialog")).toBeVisible();
});

it("paginates filters and retries failed mutations", async () => {
  const setRead = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
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
  fireEvent.click(screen.getByRole("button", { name: "savia.notificationInbox.markRead" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("savia.notificationInbox.actionError");
  fireEvent.click(screen.getByRole("button", { name: "savia.notificationInbox.markRead" }));
  await screen.findByText("Review");
  expect(setRead).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("tab", { name: "savia.notificationInbox.pending" }));
  await screen.findByText("Review");
});
