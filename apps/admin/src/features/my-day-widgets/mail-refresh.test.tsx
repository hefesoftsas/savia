import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  renderHook as renderHookBase,
  screen,
} from "@testing-library/react";
import { render } from "../studio-engine/test/locale-test-render";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMyDayMail, type PersonalMailLike } from "./use-my-day-mail";
import { ApiClientError } from "@/api/api-client";
import { MyDayWidgetsSection } from "./section";
import { MailWidgetBody } from "./mail-widget";
import { AppLocaleTestWrapper } from "./app-locale-test-wrapper";

function renderHook<Result>(callback: () => Result) {
  return renderHookBase(callback, { wrapper: AppLocaleTestWrapper });
}

const message = (id: string) => ({
  id,
  subject: `Message ${id}`,
  sender: null,
  receivedAt: null,
  webLink: null,
});
function service(): PersonalMailLike {
  return {
    listConnections: vi.fn(async () => [
      {
        provider: "gmail",
        status: "connected",
        externalAccountLabel: "me@example.com",
      },
    ]),
    listMessages: vi.fn(async () => [message("first")]),
    sendMail: vi.fn(),
  };
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("refreshes a visible inbox and announces only newly discovered messages", async () => {
  const client = service();
  function Inbox() {
    return <MailWidgetBody mail={useMyDayMail(client)} onCompose={() => {}} />;
  }
  render(<Inbox />);
  await advance(0);
  expect(screen.getByText("Message first")).toBeInTheDocument();
  expect(screen.queryByText(/Hay nuevos correos/)).not.toBeInTheDocument();
  vi.mocked(client.listMessages).mockResolvedValue([
    message("second"),
    message("first"),
  ]);
  await advance(60_000);
  expect(screen.getByText("Message second")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Hay nuevos correos");
  fireEvent.click(
    screen.getByRole("button", { name: "Descartar aviso de correos nuevos" }),
  );
  await advance(60_000);
  expect(screen.queryByText(/Hay nuevos correos/)).not.toBeInTheDocument();
});

it("pauses hidden or offline polling and refreshes when visibility or connectivity returns", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await advance(0);
  vi.mocked(client.listMessages).mockResolvedValue([message("second")]);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await advance(120_000);
  expect(result.current.messages[0]?.id).toBe("first");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await advance(0);
  expect(result.current.messages[0]?.id).toBe("second");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  act(() => window.dispatchEvent(new Event("offline")));
  vi.mocked(client.listMessages).mockResolvedValue([message("third")]);
  await advance(120_000);
  expect(result.current.messages[0]?.id).toBe("second");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  act(() => window.dispatchEvent(new Event("online")));
  await advance(0);
  expect(result.current.messages[0]?.id).toBe("third");
});

it("coalesces pending refreshes and keeps existing rows during a background read", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await advance(0);
  let resolve!: (rows: ReturnType<typeof message>[]) => void;
  vi.mocked(client.listMessages).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await advance(60_000);
  expect(result.current.messages[0]?.id).toBe("first");
  act(() => {
    void result.current.refresh();
    window.dispatchEvent(new Event("focus"));
  });
  await advance(120_000);
  expect(client.listMessages).toHaveBeenCalledTimes(2);
  await act(async () => {
    resolve([message("second")]);
  });
  expect(result.current.messages[0]?.id).toBe("second");
});

it("retains the last successful inbox on failure and backs off until recovery", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await advance(0);
  vi.mocked(client.listMessages).mockRejectedValue(
    new Error("provider unavailable"),
  );
  await advance(60_000);
  expect(result.current.messages[0]?.id).toBe("first");
  expect(result.current.errors).toHaveLength(1);
  vi.mocked(client.listMessages).mockResolvedValue([message("recovered")]);
  await advance(60_000);
  expect(result.current.messages[0]?.id).toBe("first");
  await advance(60_000);
  expect(result.current.messages[0]?.id).toBe("recovered");
  vi.mocked(client.listMessages).mockResolvedValue([message("next")]);
  await advance(60_000);
  expect(result.current.messages[0]?.id).toBe("next");
});

it("clears notices and establishes a fresh baseline after principal replacement", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await advance(0);
  vi.mocked(client.listMessages).mockResolvedValue([message("second")]);
  await advance(60_000);
  expect(result.current.newMessageCount).toBe(1);
  vi.mocked(client.listMessages).mockResolvedValue([message("other-user")]);
  act(() => window.dispatchEvent(new Event("savia:principal-changed")));
  await advance(0);
  expect(result.current.messages[0]?.id).toBe("other-user");
  expect(result.current.newMessageCount).toBe(0);
});

it("cancels scheduled reads when unmounted", async () => {
  const client = service();
  const { unmount } = renderHook(() => useMyDayMail(client));
  await advance(0);
  unmount();
  await advance(120_000);
  expect(client.listMessages).toHaveBeenCalledOnce();
});

it("removes old identity rows immediately while the replacement principal inbox is pending", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await advance(0);
  let resolve!: (rows: ReturnType<typeof message>[]) => void;
  vi.mocked(client.listMessages).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => window.dispatchEvent(new Event("savia:principal-changed")));
  await advance(0);
  expect(result.current.messages).toEqual([]);
  await act(async () => {
    resolve([message("next-user")]);
  });
  expect(result.current.messages[0]?.id).toBe("next-user");
  expect(result.current.newMessageCount).toBe(0);
});

it("continues refreshing unchanged inboxes rather than stopping after a quiet interval", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await advance(0);
  await advance(60_000);
  await advance(60_000);
  vi.mocked(client.listMessages).mockResolvedValue([message("later")]);
  await advance(60_000);
  expect(result.current.messages[0]?.id).toBe("later");
});

it("keeps the visible inbox through a transient connection lookup failure", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await advance(0);
  vi.mocked(client.listConnections).mockRejectedValue(
    new Error("network unavailable"),
  );
  await advance(60_000);
  expect(result.current.messages[0]?.id).toBe("first");
  expect(result.current.loading).toBe(false);
  expect(result.current.errors).toHaveLength(1);
});

it("preserves an open composer draft when a scheduled read finds new mail", async () => {
  const client = {
    ...service(),
    listEvents: vi.fn(async () => []),
    createCalendarEvent: vi.fn(),
  };
  render(<MyDayWidgetsSection personalIntegrations={client} />);
  await advance(0);
  fireEvent.click(screen.getByRole("button", { name: "Nuevo correo" }));
  fireEvent.change(screen.getByLabelText("Mensaje"), {
    target: { value: "My unsent draft" },
  });
  vi.mocked(client.listMessages).mockResolvedValue([message("second")]);
  await advance(60_000);
  expect(screen.getByLabelText("Mensaje")).toHaveValue("My unsent draft");
  expect(screen.getByText("Message second")).toBeInTheDocument();
  expect(client.sendMail).not.toHaveBeenCalled();
});

it("clears cached messages when connection discovery denies access", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await advance(0);
  vi.mocked(client.listConnections).mockRejectedValue(
    new ApiClientError(403, "FORBIDDEN", "Access denied"),
  );
  await advance(60_000);
  expect(result.current.messages).toEqual([]);
  expect(result.current.connections).toEqual([]);
  vi.mocked(client.listConnections).mockResolvedValue([
    {
      provider: "gmail",
      status: "connected",
      externalAccountLabel: "me@example.com",
    },
  ]);
  vi.mocked(client.listMessages).mockResolvedValue([
    message("after-access-recovery"),
  ]);
  await advance(120_000);
  expect(result.current.messages[0]?.id).toBe("after-access-recovery");
  expect(result.current.newMessageCount).toBe(0);
});

it("caps repeated failure delays and still retries after five minutes", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await advance(0);
  vi.mocked(client.listMessages).mockRejectedValue(new Error("unavailable"));
  await advance(60_000);
  await advance(120_000);
  await advance(240_000);
  vi.mocked(client.listMessages).mockResolvedValue([message("recovered")]);
  await advance(299_000);
  expect(result.current.messages[0]?.id).toBe("first");
  await advance(1_000);
  expect(result.current.messages[0]?.id).toBe("recovered");
});

it("removes a provider's cached rows when its inbox read denies access", async () => {
  const client = service();
  const { result } = renderHook(() => useMyDayMail(client));
  await advance(0);
  vi.mocked(client.listMessages).mockRejectedValue(
    new ApiClientError(403, "FORBIDDEN", "Access denied"),
  );
  await advance(60_000);
  expect(result.current.messages).toEqual([]);
  vi.mocked(client.listMessages).mockResolvedValue([message("reconnected")]);
  await advance(120_000);
  expect(result.current.messages[0]?.id).toBe("reconnected");
  expect(result.current.newMessageCount).toBe(0);
});
