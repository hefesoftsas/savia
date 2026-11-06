import {
  act,
  cleanup,
  renderHook as renderHookBase,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { memoryStore } from "ra-core";
import { ApiClientError } from "@/api/api-client";
import { useMyDayMail, type PersonalMailLike } from "./use-my-day-mail";
import {
  AppLocaleTestWrapper,
  appLocaleWrapperFor,
} from "./app-locale-test-wrapper";

function renderHook<Props, Result>(
  callback: (props: Props) => Result,
  options?: { initialProps?: Props },
) {
  return renderHookBase(callback, {
    ...options,
    wrapper: AppLocaleTestWrapper,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const message = (id: string) => ({
  id,
  subject: id,
  sender: null,
  receivedAt: null,
  webLink: null,
});
function service() {
  return {
    listConnections: vi.fn(async () => [
      {
        provider: "gmail",
        status: "connected",
        externalAccountLabel: "me@example.com",
      },
    ]),
    listMessages: vi.fn(async () => []),
    listMessagePage: vi.fn(async ({ cursor }: { cursor?: string }) =>
      cursor
        ? { messages: [message("first"), message("older")], nextCursor: null }
        : { messages: [message("first")], nextCursor: "next" },
    ),
    sendMail: vi.fn(),
  };
}
it("loads and deduplicates older pages without announcing them as new mail, retaining history on refresh", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  expect(result.current.hasMore?.gmail).toBe(true);
  await act(() => result.current.loadMore!(["gmail"]));
  expect(result.current.messages.map((row) => row.id)).toEqual([
    "first",
    "older",
  ]);
  expect(result.current.hasMore?.gmail).toBe(false);
  expect(result.current.newMessageCount).toBe(0);
  vi.mocked(client.listMessagePage).mockResolvedValue({
    messages: [message("new"), message("first")],
    nextCursor: "head-next",
  });
  await act(() => result.current.refresh());
  expect(result.current.messages.map((row) => row.id)).toContain("older");
  expect(result.current.newMessageCount).toBe(1);
  expect(result.current.hasMore?.gmail).toBe(false);
});
it("keeps a failed continuation retryable without erasing the current page", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  client.listMessagePage.mockRejectedValueOnce(new Error("offline"));
  await act(() => result.current.loadMore!());
  expect(result.current.messages.map((row) => row.id)).toEqual(["first"]);
  expect(result.current.hasMore?.gmail).toBe(true);
  await act(() => result.current.loadMore!());
  expect(result.current.messages).toHaveLength(2);
  expect(client.listMessagePage).toHaveBeenLastCalledWith({
    provider: "gmail",
    cursor: "next",
  });
});
it("clears unreadable history on denied pagination", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  client.listMessagePage.mockRejectedValueOnce(
    new ApiClientError(403, "FORBIDDEN", "Access denied"),
  );
  await act(() => result.current.loadMore!());
  expect(result.current.messages).toEqual([]);
  expect(result.current.hasMore?.gmail).toBe(false);
});
it("coalesces pagination and ignores a previous principal's pending response", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client as PersonalMailLike));
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  let resolve!: (page: {
    messages: ReturnType<typeof message>[];
    nextCursor: null;
  }) => void;
  client.listMessagePage.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  let first!: Promise<void>;
  act(() => {
    first = result.current.loadMore!();
    void result.current.loadMore!();
  });
  expect(client.listMessagePage).toHaveBeenCalledTimes(2);
  act(() => window.dispatchEvent(new Event("savia:principal-changed")));
  await act(async () => {
    resolve({ messages: [message("old-identity")], nextCursor: null });
    await first;
  });
  expect(result.current.messages.map((row) => row.id)).not.toContain(
    "old-identity",
  );
});

it("translates cached provider errors when the mounted locale changes", async () => {
  const client = service();
  vi.mocked(client.listMessagePage).mockRejectedValue(new Error("offline"));
  const store = memoryStore({ locale: "es" });
  const wrapper = appLocaleWrapperFor(store);
  const { result } = renderHookBase(() => useMyDayMail(client), { wrapper });
  await waitFor(() => expect(result.current.errors).toHaveLength(1));
  expect(result.current.errors[0]).toContain("No pudimos cargar Gmail.");
  act(() => store.setItem("locale", "en"));
  await waitFor(() =>
    expect(result.current.errors[0]).toContain("Could not load Gmail."),
  );
  expect(client.listMessagePage).toHaveBeenCalledTimes(1);
});
