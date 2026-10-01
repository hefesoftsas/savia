// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomPluginFrame } from "../custom-plugin-frame";
import { setStudioRuntime } from "../runtime";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setStudioRuntime({ embedded: false });
});

it("passes the selected store screen to the plugin shell", () => {
  render(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Cotizador por pasos"
      screen={{ object: "cotizador_por_pasos", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Cotizador por pasos") as HTMLIFrameElement;
  expect(new URL(frame.src).searchParams.get("screen")).toBe(
    "cotizador_por_pasos",
  );
  expect(new URL(frame.src).searchParams.get("view")).toBe("records");
});

it("passes the active theme before the plugin shell loads", () => {
  document.documentElement.classList.add("dark");
  render(<CustomPluginFrame pluginId="insurance.quotes" title="Dark plugin" />);
  expect(
    new URL(
      (screen.getByTitle("Dark plugin") as HTMLIFrameElement).src,
    ).searchParams.get("theme"),
  ).toBe("dark");
  cleanup();
  document.documentElement.classList.remove("dark");
  render(
    <CustomPluginFrame pluginId="insurance.quotes" title="Light plugin" />,
  );
  expect(
    new URL(
      (screen.getByTitle("Light plugin") as HTMLIFrameElement).src,
    ).searchParams.get("theme"),
  ).toBe("light");
});

it("covers the iframe with the host background until the shell loads", () => {
  const { rerender } = render(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Loading plugin"
      screen={{ object: "quotes", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Loading plugin") as HTMLIFrameElement;
  expect(frame.parentElement).toHaveClass("bg-background");
  expect(frame).toHaveClass("invisible");
  fireEvent.load(frame);
  expect(frame).not.toHaveClass("invisible");
  rerender(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Loading plugin"
      screen={{ object: "quotes", view: "admin" }}
    />,
  );
  expect(screen.getByTitle("Loading plugin")).toHaveClass("invisible");
});

it("allows a plugin to download a generated PDF while keeping its origin isolated", () => {
  render(<CustomPluginFrame pluginId="insurance.quotes" title="Cotizador" />);
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const permissions = (frame.getAttribute("sandbox") ?? "").split(/\s+/);
  expect(permissions).toContain("allow-downloads");
  expect(permissions).not.toContain("allow-same-origin");
});

it("loads the plugin shell through the selected tenant", () => {
  setStudioRuntime({
    embedded: false,
    apiBasePath: "/v1/studio/0",
  });
  render(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Cotizador por pasos"
      screen={{ object: "cotizador_por_pasos", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Cotizador por pasos") as HTMLIFrameElement;
  expect(new URL(frame.src).pathname).toBe(
    "/v1/studio/0/api/plugin-store/insurance.quotes/shell",
  );
});

it("prefetches screen settings while the plugin iframe starts and reuses them", async () => {
  let resolveSettings!: (response: Response) => void;
  const transport = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        resolveSettings = resolve;
      }),
  );
  setStudioRuntime({
    embedded: false,
    apiBasePath: "/v1/studio/42",
    transport,
  });
  render(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Cotizador"
      screen={{ object: "cotizador_por_pasos", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");

  await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  expect(transport).toHaveBeenCalledWith(
    "/api/extensions/insurance.quotes/settings",
    expect.objectContaining({ method: "GET" }),
  );

  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "quote-settings",
        path: "/extensions/insurance.quotes/settings",
      },
    }),
  );
  await act(async () =>
    resolveSettings(
      Response.json({
        data: { value: { products: [{ id: "tenant-product" }] }, version: 7 },
      }),
    ),
  );

  expect(transport).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "response",
      id: "quote-settings",
      ok: true,
      data: {
        data: { value: { products: [{ id: "tenant-product" }] }, version: 7 },
      },
    }),
    "*",
  );
});

it("drops a pending settings prefetch when the authenticated identity changes", async () => {
  let resolvePrevious!: (response: Response) => void;
  const transport = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolvePrevious = resolve;
        }),
    )
    .mockResolvedValueOnce(
      Response.json({ data: { value: { owner: "current" }, version: 2 } }),
    );
  setStudioRuntime({ embedded: false, transport });
  render(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Cotizador"
      screen={{ object: "cotizador", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));

  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "old-settings",
        path: "/extensions/insurance.quotes/settings",
      },
    }),
  );
  fireEvent(window, new Event("savia:identity-changed"));
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  await act(async () =>
    resolvePrevious(
      Response.json({ data: { value: { owner: "previous" }, version: 1 } }),
    ),
  );
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "response", id: "old-settings" }),
    "*",
  );
  const currentFrame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  expect(currentFrame).not.toBe(frame);
  const currentSend = vi.spyOn(currentFrame.contentWindow!, "postMessage");

  fireEvent(
    window,
    new MessageEvent("message", {
      source: currentFrame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "current-settings",
        path: "/extensions/insurance.quotes/settings",
      },
    }),
  );
  await waitFor(() =>
    expect(currentSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "response",
        id: "current-settings",
        ok: true,
        data: { data: { value: { owner: "current" }, version: 2 } },
      }),
      "*",
    ),
  );
  expect(transport).toHaveBeenCalledTimes(2);
});

it("does not reuse prefetched settings after a settings write", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ data: { value: { enabled: true }, version: 1 } }),
    )
    .mockResolvedValueOnce(Response.json({ data: { version: 2 } }))
    .mockResolvedValueOnce(
      Response.json({ data: { value: { enabled: false }, version: 2 } }),
    );
  setStudioRuntime({ embedded: false, transport });
  render(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Cotizador"
      screen={{ object: "cotizador", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));

  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "write-settings",
        path: "/extensions/insurance.quotes/settings",
        method: "PUT",
        body: { value: { enabled: false }, version: 1 },
      },
    }),
  );
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "read-settings-again",
        path: "/extensions/insurance.quotes/settings",
      },
    }),
  );

  await waitFor(() => expect(transport).toHaveBeenCalledTimes(3));
  expect(transport).toHaveBeenNthCalledWith(
    3,
    "/api/extensions/insurance.quotes/settings",
    expect.objectContaining({ method: "GET" }),
  );
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ id: "read-settings-again", ok: true }),
      "*",
    ),
  );
});

it("uses fresh settings on reads after the startup prefetch has been consumed", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ data: { value: { revision: 1 }, version: 1 } }),
    )
    .mockResolvedValueOnce(
      Response.json({ data: { value: { revision: 2 }, version: 2 } }),
    );
  setStudioRuntime({ embedded: false, transport });
  render(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Cotizador"
      screen={{ object: "cotizador", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));

  for (const id of ["startup-settings", "fresh-settings"]) {
    fireEvent(
      window,
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          ns: "savia-plugin",
          type: "request",
          id,
          path: "/extensions/insurance.quotes/settings",
        },
      }),
    );
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ id, ok: true }),
        "*",
      ),
    );
  }

  expect(transport).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "fresh-settings",
      data: { data: { value: { revision: 2 }, version: 2 } },
    }),
    "*",
  );
});

it("retries settings through the host after the prefetched request fails", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ error: "Unavailable" }, { status: 503 }),
    )
    .mockResolvedValueOnce(
      Response.json({ data: { value: { revision: 2 }, version: 2 } }),
    );
  setStudioRuntime({ embedded: false, transport });
  render(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Cotizador"
      screen={{ object: "cotizador", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));

  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "failed-settings",
        path: "/extensions/insurance.quotes/settings",
      },
    }),
  );
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ id: "failed-settings", ok: false }),
      "*",
    ),
  );
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "retry-settings",
        path: "/extensions/insurance.quotes/settings",
      },
    }),
  );

  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ id: "retry-settings", ok: true }),
      "*",
    ),
  );
  expect(transport).toHaveBeenCalledTimes(2);
});

it("does not prefetch again after the session is cleared", async () => {
  const transport = vi.fn(async () =>
    Response.json({ data: { value: { revision: 1 }, version: 1 } }),
  );
  setStudioRuntime({ embedded: false, transport });
  render(
    <CustomPluginFrame
      pluginId="insurance.quotes"
      title="Cotizador"
      screen={{ object: "cotizador", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  fireEvent(window, new Event("savia:session-cleared"));
  await act(async () => Promise.resolve());
  expect(transport).toHaveBeenCalledTimes(1);

  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "session-read",
        path: "/extensions/insurance.quotes/settings",
      },
    }),
  );
  await act(async () => Promise.resolve());
  expect(transport).toHaveBeenCalledTimes(1);
});

it("sends the current host theme when the plugin becomes ready", () => {
  document.documentElement.style.setProperty("--foreground", "rgb(20 30 40)");
  render(<CustomPluginFrame pluginId="insurance.quotes" title="Cotizador" />);
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { ns: "savia-plugin", type: "ready" },
    }),
  );
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      ns: "savia-plugin",
      type: "theme",
      vars: expect.objectContaining({ "--foreground": "rgb(20 30 40)" }),
    }),
    "*",
  );
  document.documentElement.style.removeProperty("--foreground");
});

it("shows a ready plugin without waiting for the iframe load event", () => {
  render(
    <CustomPluginFrame pluginId="insurance.quotes" title="Ready plugin" />,
  );
  const frame = screen.getByTitle("Ready plugin") as HTMLIFrameElement;
  expect(screen.getByRole("status")).toBeVisible();
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { ns: "savia-plugin", type: "ready" },
    }),
  );
  expect(frame).not.toHaveClass("invisible");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("offers a fresh iframe after a plugin startup failure", () => {
  render(
    <CustomPluginFrame pluginId="insurance.quotes" title="Failed plugin" />,
  );
  const frame = screen.getByTitle("Failed plugin") as HTMLIFrameElement;
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { ns: "savia-plugin", type: "error", error: "Module unavailable" },
    }),
  );
  expect(screen.getByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByTitle("Failed plugin")).not.toBe(frame);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toBeVisible();
});

it("offers retry when a frame never announces readiness", () => {
  vi.useFakeTimers();
  render(
    <CustomPluginFrame pluginId="custom.stalled" title="Stalled plugin" />,
  );
  act(() => vi.advanceTimersByTime(30_000));
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

it("does not send a previous screen's pending response to a replacement frame", async () => {
  let resolve!: (value: Response) => void;
  const transport = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  setStudioRuntime({ embedded: false, transport });
  const { rerender } = render(
    <CustomPluginFrame pluginId="custom.first" title="Plugin" />,
  );
  const first = screen.getByTitle("Plugin") as HTMLIFrameElement;
  fireEvent(
    window,
    new MessageEvent("message", {
      source: first.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "pending",
        path: "/objects",
      },
    }),
  );
  rerender(<CustomPluginFrame pluginId="custom.second" title="Plugin" />);
  const second = screen.getByTitle("Plugin") as HTMLIFrameElement;
  const send = vi.spyOn(second.contentWindow!, "postMessage");
  await act(async () => resolve(Response.json({ data: ["private"] })));
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ id: "pending" }),
    "*",
  );
});

it("forwards any workspace API route with the current user's transport", async () => {
  const transport = vi.fn(async () => Response.json({ ok: true }));
  setStudioRuntime({ embedded: false, transport });
  render(<CustomPluginFrame pluginId="insurance.quotes" title="Cotizador" />);
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");

  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "read-settings",
        path: "/settings/geocoding",
      },
    }),
  );
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "write-notification",
        path: "/notifications/admin/send",
        method: "POST",
        body: { subject: "Test" },
      },
    }),
  );

  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  expect(transport).toHaveBeenCalledWith(
    "/api/settings/geocoding",
    expect.objectContaining({ method: "GET" }),
  );
  expect(transport).toHaveBeenCalledWith(
    "/api/notifications/admin/send",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ subject: "Test" }),
    }),
  );
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "response",
        id: "write-notification",
        ok: true,
      }),
      "*",
    ),
  );
});

it("returns a backend permission failure to the plugin", async () => {
  const transport = vi.fn(async () =>
    Response.json({ error: "Forbidden" }, { status: 403 }),
  );
  setStudioRuntime({ embedded: false, transport });
  render(<CustomPluginFrame pluginId="insurance.quotes" title="Cotizador" />);
  const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");

  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "denied",
        path: "/notifications/admin/send",
        method: "POST",
      },
    }),
  );

  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "response",
        id: "denied",
        ok: false,
        error: "Forbidden",
      }),
      "*",
    ),
  );
});

it.each(["https://example.com/api/users", "//example.com", "/%2e%2e/users"])(
  "rejects a path that can leave the workspace API: %s",
  (path) => {
    const transport = vi.fn();
    setStudioRuntime({ embedded: false, transport });
    render(<CustomPluginFrame pluginId="insurance.quotes" title="Cotizador" />);
    const frame = screen.getByTitle("Cotizador") as HTMLIFrameElement;
    const send = vi.spyOn(frame.contentWindow!, "postMessage");

    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          ns: "savia-plugin",
          type: "request",
          id: "bad-path",
          path,
        },
      }),
    );

    expect(transport).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "response", id: "bad-path", ok: false }),
      "*",
    );
  },
);

function uiMessage(frame: HTMLIFrameElement, data: Record<string, unknown>) {
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { ns: "savia-plugin-ui", version: 1, ...data },
    }),
  );
}
function handshake(frame: HTMLIFrameElement) {
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  uiMessage(frame, { type: "hello", nonce: "test" });
  const init = send.mock.calls.find(([message]) => message.type === "init")![0];
  return { send, session: init.session, panelId: init.panel?.panelId };
}
it("hosts only verified owner requests, keeps the list mounted and confirms dirty closes", () => {
  render(
    <CustomPluginFrame
      pluginId="insurance.collections"
      title="List"
      screen={{ object: "accounts", view: "records" }}
    />,
  );
  const owner = screen.getByTitle("List") as HTMLIFrameElement;
  const host = handshake(owner);
  const request = {
    view: "record-editor",
    title: "Edit account",
    params: { recordId: "r1" },
  };
  uiMessage(owner, { type: "open", id: "request1", session: "stale", request });
  expect(screen.queryByRole("dialog")).toBeNull();
  uiMessage(owner, {
    type: "open",
    id: "request1",
    session: host.session,
    request,
  });
  const editor = screen.getByTitle("Edit account") as HTMLIFrameElement;
  expect(new URL(editor.src).searchParams.get("panel")).toBe("1");
  expect(screen.getByTitle("List")).toBe(owner);
  const child = handshake(editor);
  uiMessage(editor, {
    type: "state",
    session: child.session,
    panelId: child.panelId,
    state: { dirty: true, busy: false },
  });
  uiMessage(editor, {
    type: "close",
    session: child.session,
    panelId: child.panelId,
  });
  expect(screen.getByText("Discard changes?")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Keep editing"));
  uiMessage(editor, {
    type: "state",
    session: child.session,
    panelId: child.panelId,
    state: { dirty: true, busy: true },
  });
  uiMessage(editor, {
    type: "close",
    session: child.session,
    panelId: child.panelId,
  });
  expect(screen.queryByText("Discard changes?")).toBeNull();
  uiMessage(editor, {
    type: "complete",
    session: child.session,
    panelId: child.panelId,
    result: { status: "saved" },
  });
  expect(screen.queryByTitle("Edit account")).toBeNull();
  expect(host.send).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "result",
      id: "request1",
      result: { status: "saved" },
    }),
    "*",
  );
});
it("allows closing failed editors and removes panels when identity changes", () => {
  render(
    <CustomPluginFrame
      pluginId="insurance.collections"
      title="List"
      screen={{ object: "accounts", view: "records" }}
    />,
  );
  const owner = screen.getByTitle("List") as HTMLIFrameElement;
  const host = handshake(owner);
  uiMessage(owner, {
    type: "open",
    id: "request1",
    session: host.session,
    request: { view: "record-editor", title: "Editor", params: {} },
  });
  fireEvent(
    window,
    new MessageEvent("message", {
      source: (screen.getByTitle("Editor") as HTMLIFrameElement).contentWindow,
      data: { ns: "savia-plugin", type: "error" },
    }),
  );
  expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  fireEvent(window, new Event("savia:identity-changed"));
  expect(screen.queryByTitle("Editor")).toBeNull();
});
it("opens a host editor from the store viewer without a selected screen", () => {
  render(
    <CustomPluginFrame pluginId="insurance.collections" title="Store viewer" />,
  );
  const owner = screen.getByTitle("Store viewer") as HTMLIFrameElement;
  const host = handshake(owner);
  uiMessage(owner, {
    type: "open",
    id: "store-editor",
    session: host.session,
    request: { view: "record-editor", title: "Store editor", params: {} },
  });
  const editor = screen.getByTitle("Store editor") as HTMLIFrameElement;
  expect(new URL(editor.src).pathname).toBe(new URL(owner.src).pathname);
  expect(new URL(editor.src).searchParams.get("panel")).toBe("1");
});

it("retains an inert prepared frame across cancellable loading and fresh activations", () => {
  render(<CustomPluginFrame pluginId="custom.editor" title="List" />);
  const list = screen.getByTitle("List") as HTMLIFrameElement;
  const main = handshake(list);
  uiMessage(list, { type: "prepare", session: main.session });
  const editor = document.querySelector(
    'iframe[src*="standby=1"]',
  ) as HTMLIFrameElement;
  expect(editor).not.toBeNull();
  expect(editor.closest("[inert]")).not.toBeNull();
  const child = handshake(editor);
  const request = { view: "record-editor", title: "Editor", params: {} };
  uiMessage(list, {
    type: "open",
    id: "first",
    request,
    session: main.session,
  });
  expect(screen.getByRole("dialog")).toBeVisible();
  const activation = child.send.mock.calls.find(
    ([m]) => m.type === "activate",
  )![0];
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.querySelector('iframe[src*="standby=1"]')).toBe(editor);
  uiMessage(list, {
    type: "open",
    id: "second",
    request,
    session: main.session,
  });
  expect(document.querySelector('iframe[src*="standby=1"]')).toBe(editor);
  const activations = child.send.mock.calls.filter(
    ([m]) => m.type === "activate",
  );
  expect(activations).toHaveLength(2);
  expect(activations[1][0].panel.panelId).not.toBe(activation.panel.panelId);
});
it("blocks new requests from a disposed frame after logout", async () => {
  const transport = vi.fn().mockResolvedValue(Response.json({ data: [] }));
  setStudioRuntime({ embedded: false, pluginTransport: transport });
  render(<CustomPluginFrame pluginId="custom.editor" title="List" />);
  const frame = screen.getByTitle("List") as HTMLIFrameElement;
  handshake(frame);
  fireEvent(window, new Event("savia:session-cleared"));
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "late",
        path: "/records/contacts",
        method: "POST",
        body: {},
      },
    }),
  );
  await act(async () => {});
  expect(transport).not.toHaveBeenCalled();
});
it("drops an old activation's delayed reply when the retained iframe is reopened", async () => {
  let respond!: (response: Response) => void;
  setStudioRuntime({
    embedded: false,
    pluginTransport: () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  });
  render(<CustomPluginFrame pluginId="custom.editor" title="List" />);
  const list = screen.getByTitle("List") as HTMLIFrameElement;
  const main = handshake(list);
  uiMessage(list, { type: "prepare", session: main.session });
  const editor = document.querySelector(
    'iframe[src*="standby=1"]',
  ) as HTMLIFrameElement;
  const child = handshake(editor);
  const request = { view: "record-editor", title: "Editor", params: {} };
  uiMessage(list, { type: "open", id: "a", request, session: main.session });
  const first = child.send.mock.calls.find(([m]) => m.type === "activate")![0]
    .panel.panelId;
  fireEvent(
    window,
    new MessageEvent("message", {
      source: editor.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "old-read",
        path: "/records/contacts/a",
        panelId: first,
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  uiMessage(list, { type: "open", id: "b", request, session: main.session });
  await act(async () => respond(Response.json({ data: { id: "a" } })));
  expect(
    child.send.mock.calls.some(
      ([m]) => m.type === "response" && m.id === "old-read",
    ),
  ).toBe(false);
  expect(screen.getByRole("dialog")).toBeVisible();
});
it("disposes both frames when the installed plugin version changes", () => {
  const { rerender } = render(
    <CustomPluginFrame
      pluginId="custom.editor"
      title="List"
      installationVersion="1.0.0"
    />,
  );
  const first = screen.getByTitle("List") as HTMLIFrameElement;
  const main = handshake(first);
  uiMessage(first, { type: "prepare", session: main.session });
  expect(document.querySelectorAll("iframe")).toHaveLength(2);
  rerender(
    <CustomPluginFrame
      pluginId="custom.editor"
      title="List"
      installationVersion="1.0.1"
    />,
  );
  expect(screen.getByTitle("List")).not.toBe(first);
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
});
it("offers retry immediately when a prepared shell fails before activation", () => {
  render(<CustomPluginFrame pluginId="custom.editor" title="List" />);
  const list = screen.getByTitle("List") as HTMLIFrameElement;
  const main = handshake(list);
  uiMessage(list, { type: "prepare", session: main.session });
  const editor = document.querySelector(
    'iframe[src*="standby=1"]',
  ) as HTMLIFrameElement;
  handshake(editor);
  fireEvent(
    window,
    new MessageEvent("message", {
      source: editor.contentWindow,
      data: { ns: "savia-plugin", type: "error", error: "Import unavailable" },
    }),
  );
  uiMessage(list, {
    type: "open",
    id: "a",
    session: main.session,
    request: { view: "record-editor", title: "Editor", params: {} },
  });
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(document.querySelector('iframe[src*="standby=1"]')).not.toBe(editor);
});
it("removes both frames and cached rendered content on workspace authorization revocation", () => {
  let change!: (event: any) => void;
  setStudioRuntime({
    embedded: false,
    pluginTransport: vi.fn(),
    localWorkspace: {
      store: {
        subscribe: () => () => {},
        subscribeQueryChanges: (listener: typeof change) => {
          change = listener;
          return () => {};
        },
      },
    } as never,
  });
  render(<CustomPluginFrame pluginId="custom.editor" title="List" />);
  const list = screen.getByTitle("List") as HTMLIFrameElement;
  const main = handshake(list);
  uiMessage(list, { type: "prepare", session: main.session });
  expect(document.querySelectorAll("iframe")).toHaveLength(2);
  act(() =>
    change({
      authorizationError: "Denied",
      changed: new Set(),
      metadataChanged: false,
    }),
  );
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
  expect(screen.getByRole("alert")).toBeVisible();
});
it("forwards outbox-only conflicts even when no record revision changes", async () => {
  let notify!: () => void;
  const status = { pending: 0, conflicts: 1, errors: 0 };
  setStudioRuntime({
    embedded: false,
    pluginTransport: vi.fn(),
    localWorkspace: {
      store: {
        subscribeQueryChanges: () => () => {},
        subscribe: (listener: () => void) => {
          notify = listener;
          return () => {};
        },
        status: async () => status,
      },
    } as never,
  });
  render(<CustomPluginFrame pluginId="custom.editor" title="List" />);
  const list = screen.getByTitle("List") as HTMLIFrameElement;
  const main = handshake(list);
  await act(async () => notify());
  expect(main.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: "records-changed", status }),
    "*",
  );
});
