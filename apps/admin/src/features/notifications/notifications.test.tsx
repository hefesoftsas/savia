import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationBell } from "./notification-bell";
import { NotificationInbox } from "./notification-inbox";
import type { InboxFilter, NoticeItem, NotificationClient } from "./client";
import { rotateSessionScope } from "@/auth/session-scope";

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

it("reads a fresh notification count after the authenticated principal changes", async () => {
  const unreadCount = vi.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(1);
  setup({ unreadCount });
  expect(
    await screen.findByLabelText("savia.notificationInbox.title (4)"),
  ).toBeVisible();

  act(() => rotateSessionScope("principal-change"));

  expect(
    await screen.findByLabelText("savia.notificationInbox.title (1)"),
  ).toBeVisible();
  expect(unreadCount).toHaveBeenCalledTimes(2);
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

it.each(["mark-read", "archive", "read-all"] as const)(
  "refreshes cached unread notifications after %s from the all filter",
  async (mutation) => {
    const item: NoticeItem = {
      id: "n1",
      title: "Review",
      body: "Needs attention",
      createdAt: Date.now(),
      readAt: null,
      archivedAt: null,
      source: { kind: "admin-message", id: "m1" },
      actionState: "pending",
    };
    const inbox = vi.fn(async (filter: InboxFilter) => {
      const visible =
        item.archivedAt === null &&
        (filter !== "unread" || item.readAt === null) &&
        (filter !== "pending" || item.actionState === "pending");
      return {
        items: visible ? [{ ...item }] : [],
        nextCursor: null,
        cutoff: "",
      };
    });
    const unreadCount = vi.fn(async () =>
      item.readAt === null && item.archivedAt === null ? 1 : 0,
    );
    const client = {
      inbox,
      unreadCount,
      setRead: vi.fn(async (_id: string, read: boolean) => {
        item.readAt = read ? Date.now() : null;
      }),
      archive: vi.fn(async () => {
        item.archivedAt = Date.now();
      }),
      readAll: vi.fn(async () => {
        item.readAt = Date.now();
        return { updated: 1, nextCursor: null };
      }),
      resolve: vi.fn(async () => {}),
    } as unknown as NotificationClient;
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <MemoryRouter>
          <NotificationBell client={client} />
          <NotificationInbox client={client} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByLabelText("savia.notificationInbox.title (1)"),
    ).toBeVisible();
    expect(await screen.findByText("Review")).toBeVisible();
    fireEvent.click(
      screen.getByRole("tab", { name: "savia.notificationInbox.unread" }),
    );
    await waitFor(() =>
      expect(
        inbox.mock.calls.filter(([filter]) => filter === "unread"),
      ).toHaveLength(1),
    );
    expect(await screen.findByText("Review")).toBeVisible();
    fireEvent.click(
      screen.getByRole("tab", { name: "savia.notificationInbox.all" }),
    );

    if (mutation === "mark-read") {
      fireEvent.click(
        screen.getByRole("button", {
          name: "savia.notificationInbox.markRead",
        }),
      );
      await waitFor(() => expect(client.setRead).toHaveBeenCalledTimes(1));
    } else if (mutation === "archive") {
      fireEvent.click(
        screen.getByRole("button", { name: "savia.notificationInbox.archive" }),
      );
      await waitFor(() => expect(client.archive).toHaveBeenCalledTimes(1));
    } else {
      fireEvent.click(
        screen.getByRole("button", {
          name: "savia.notificationInbox.markAllRead",
        }),
      );
      await waitFor(() => expect(client.readAll).toHaveBeenCalledTimes(1));
    }

    await waitFor(() =>
      expect(
        inbox.mock.calls.filter(([filter]) => filter === "all"),
      ).toHaveLength(2),
    );
    fireEvent.click(
      screen.getByRole("tab", { name: "savia.notificationInbox.unread" }),
    );
    await waitFor(() =>
      expect(
        inbox.mock.calls.filter(([filter]) => filter === "unread"),
      ).toHaveLength(2),
    );
    await waitFor(() =>
      expect(screen.queryByText("Review")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("button", {
        name: "savia.notificationInbox.title",
      }),
    ).toBeVisible();
  },
);

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
