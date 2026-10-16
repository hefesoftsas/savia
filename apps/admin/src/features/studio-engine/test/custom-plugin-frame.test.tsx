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
import { getPluginAssistantProvider } from "@savia/studio-shared/plugin-assistant";
import { HashRouter, useSearchParams } from "react-router-dom";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setStudioRuntime({ embedded: false });
  getPluginAssistantProvider()?.close();
  delete (navigator as Navigator & { userActivation?: unknown }).userActivation;
});

it("keeps plugin URL state scoped to the current screen and broadcasts back navigation", async () => {
  window.history.replaceState(
    null,
    "",
    "/#/studio?tenantId=12&object=tenders&plugin.demo.tab=documents",
  );
  const navigate = vi.fn((query: string) =>
    window.history.pushState(null, "", "/#/studio?" + query),
  );
  const transport = vi.fn(async () => Response.json({ data: null }));
  setStudioRuntime({ embedded: true, navigate, transport });
  render(
    <CustomPluginFrame
      pluginId="demo"
      title="Route demo"
      screen={{ object: "tenders", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Route demo") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  const request = (method: string, body?: unknown) =>
    fireEvent(
      window,
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          ns: "savia-plugin",
          type: "request",
          id: method,
          path: "/extensions/demo/route",
          method,
          body,
        },
      }),
    );
  request("GET");
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "GET",
        ok: true,
        data: { tab: "documents" },
      }),
      "*",
    ),
  );
  request("PUT", {
    state: { tender: "CO1.REQ.1", tab: "chat" },
    replace: false,
  });
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith(
      expect.stringContaining("tenantId=12&object=tenders"),
      false,
    ),
  );
  expect(window.location.hash).toContain("plugin.demo.tender=CO1.REQ.1");
  window.history.replaceState(
    null,
    "",
    "/#/studio?tenantId=12&object=tenders&plugin.demo.tab=summary",
  );
  fireEvent(window, new PopStateEvent("popstate"));
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "route-changed",
      state: { tab: "summary" },
    }),
    "*",
  );
  const notifications = send.mock.calls.filter(
    ([data]) => data.type === "route-changed",
  ).length;
  fireEvent(window, new HashChangeEvent("hashchange"));
  expect(
    send.mock.calls.filter(([data]) => data.type === "route-changed"),
  ).toHaveLength(notifications);
  expect(transport).not.toHaveBeenCalledWith(
    expect.stringContaining("/route"),
    expect.anything(),
  );
  window.history.replaceState(null, "", "/");
});

it("round trips actual HashRouter history, preserving scope and replace semantics", async () => {
  window.history.replaceState(
    null,
    "",
    "/#/studio?tenantId=12&object=tenders&plugin.other.tab=keep",
  );
  function Host() {
    const [, setParams] = useSearchParams();
    setStudioRuntime({
      embedded: true,
      navigate: (query, replace) =>
        setParams(new URLSearchParams(query), { replace }),
    });
    return (
      <CustomPluginFrame
        pluginId="demo"
        title="History demo"
        screen={{ object: "tenders", view: "records" }}
      />
    );
  }
  render(
    <HashRouter>
      <Host />
    </HashRouter>,
  );
  const frame = screen.getByTitle("History demo") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  const setRoute = (tab: string, replace = false) =>
    fireEvent(
      window,
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          ns: "savia-plugin",
          type: "request",
          id: tab,
          path: "/extensions/demo/route",
          method: "PUT",
          body: { state: { tender: "CO1.REQ.1", tab }, replace },
        },
      }),
    );
  const initialLength = window.history.length;
  setRoute("documents");
  await waitFor(() =>
    expect(window.location.hash).toContain("plugin.demo.tab=documents"),
  );
  expect(window.history.length).toBe(initialLength + 1);
  setRoute("chat", true);
  await waitFor(() =>
    expect(window.location.hash).toContain("plugin.demo.tab=chat"),
  );
  expect(window.history.length).toBe(initialLength + 1);
  expect(window.location.hash).toContain(
    "tenantId=12&object=tenders&plugin.other.tab=keep",
  );
  const beforeBack = send.mock.calls.filter(
    ([data]) => data.type === "route-changed",
  ).length;
  await act(async () => {
    window.history.back();
  });
  await waitFor(() =>
    expect(window.location.hash).not.toContain("plugin.demo.tab"),
  );
  await waitFor(() =>
    expect(
      send.mock.calls.filter(([data]) => data.type === "route-changed"),
    ).toHaveLength(beforeBack + 1),
  );
  await act(async () => {
    window.history.forward();
  });
  await waitFor(() =>
    expect(window.location.hash).toContain("plugin.demo.tab=chat"),
  );
  await waitFor(() =>
    expect(
      send.mock.calls.filter(([data]) => data.type === "route-changed"),
    ).toHaveLength(beforeBack + 2),
  );
  window.history.replaceState(null, "", "/");
});

it("opens only its own extension assistant and invokes its declared action through the host API", async () => {
  const transport = vi.fn(async (_path: string, _init?: RequestInit) =>
    Response.json({
      data: {
        run: { runId: "run-1", status: "succeeded" },
        output: {
          data: {
            data: {
              conversationId: "conversation-1",
              revision: 1,
              messages: [],
            },
          },
        },
      },
    }),
  );
  setStudioRuntime({ embedded: false, transport });
  render(<CustomPluginFrame pluginId="procurement.secop" title="SECOP" />);
  const frame = screen.getByTitle("SECOP") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  const request = (path: string, id: string) =>
    fireEvent(
      window,
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          ns: "savia-plugin",
          type: "request",
          id,
          path,
          method: "POST",
          body: {
            title: "Tender dossier",
            actionId: "assistant-chat",
            context: { dossierId: "dossier-1" },
          },
        },
      }),
    );

  request("/extensions/other.plugin/assistant/open", "foreign");
  expect(getPluginAssistantProvider()).toBeNull();
  request("/extensions/procurement.secop/assistant/open", "own");
  expect(getPluginAssistantProvider()?.title).toBe("Tender dossier");
  await act(async () => {
    await getPluginAssistantProvider()!.invoke({ method: "load" });
  });
  expect(transport).toHaveBeenCalledWith(
    "/api/extensions/procurement.secop/actions/assistant-chat",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        input: {
          context: { dossierId: "dossier-1" },
          request: { method: "load" },
        },
      }),
    }),
  );
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ id: "own", ok: true, data: null }),
    "*",
  );
});

it("revokes an external assistant callback when the authenticated session clears", async () => {
  const transport = vi.fn();
  setStudioRuntime({ embedded: false, transport });
  render(<CustomPluginFrame pluginId="example.provider" title="Provider" />);
  const frame = screen.getByTitle("Provider") as HTMLIFrameElement;
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "open",
        path: "/extensions/example.provider/assistant/open",
        method: "POST",
        body: {
          title: "External assistant",
          actionId: "chat",
          context: { itemId: "item-1" },
        },
      },
    }),
  );
  const provider = getPluginAssistantProvider()!;
  fireEvent(window, new Event("savia:session-cleared"));
  await expect(provider.invoke({ method: "load" })).rejects.toThrow(
    "session has ended",
  );
  expect(transport).not.toHaveBeenCalled();
});

it("requires the active reusable panel owner before opening its assistant", async () => {
  render(<CustomPluginFrame pluginId="custom.editor" title="List" />);
  const list = screen.getByTitle("List") as HTMLIFrameElement;
  const main = handshake(list);
  uiMessage(list, { type: "prepare", session: main.session });
  const editor = document.querySelector(
    'iframe[src*="standby=1"]',
  ) as HTMLIFrameElement;
  const child = handshake(editor);
  const request = { view: "record-editor", title: "Editor", params: {} };
  uiMessage(list, {
    type: "open",
    id: "open-editor",
    request,
    session: main.session,
  });
  const activation = child.send.mock.calls.find(
    ([message]) => message.type === "activate",
  )![0];
  const panelId = activation.panel.panelId as string;
  const assistantRequest = (requestedPanelId: string) =>
    fireEvent(
      window,
      new MessageEvent("message", {
        source: editor.contentWindow,
        data: {
          ns: "savia-plugin",
          type: "request",
          id: "assistant-open",
          path: "/extensions/custom.editor/assistant/open",
          method: "POST",
          panelId: requestedPanelId,
          body: {
            title: "Editor assistant",
            actionId: "chat",
            context: { itemId: "item-1" },
          },
        },
      }),
    );

  assistantRequest("another-panel");
  expect(getPluginAssistantProvider()).toBeNull();
  fireEvent(
    window,
    new MessageEvent("message", {
      source: editor.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "ready",
        id: "wrong-type",
        path: "/extensions/custom.editor/assistant/open",
        method: "POST",
        panelId,
        body: {
          title: "Editor assistant",
          actionId: "chat",
          context: { itemId: "item-1" },
        },
      },
    }),
  );
  expect(getPluginAssistantProvider()).toBeNull();
  assistantRequest(panelId);
  const provider = getPluginAssistantProvider()!;
  expect(provider.title).toBe("Editor assistant");

  uiMessage(editor, {
    type: "state",
    session: child.session,
    panelId,
    state: { dirty: false, busy: false },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(getPluginAssistantProvider()).toBeNull();
  await expect(provider.invoke({ method: "load" })).rejects.toThrow(
    "session has ended",
  );
  assistantRequest(panelId);
  expect(getPluginAssistantProvider()).toBeNull();
});

it("accepts assistant requests from a directly bound panel with the SDK null panel ID", () => {
  render(<CustomPluginFrame pluginId="custom.editor" title="List" />);
  const list = screen.getByTitle("List") as HTMLIFrameElement;
  const main = handshake(list);
  uiMessage(list, {
    type: "open",
    id: "open-editor",
    request: { view: "record-editor", title: "Editor", params: {} },
    session: main.session,
  });
  const editor = screen.getByTitle("Editor") as HTMLIFrameElement;
  const child = handshake(editor);
  expect(child.panelId).toBeTruthy();
  fireEvent(
    window,
    new MessageEvent("message", {
      source: editor.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "assistant-open",
        path: "/extensions/custom.editor/assistant/open",
        method: "POST",
        panelId: null,
        body: {
          title: "Editor assistant",
          actionId: "chat",
          context: { itemId: "item-1" },
        },
      },
    }),
  );
  expect(getPluginAssistantProvider()?.title).toBe("Editor assistant");
  uiMessage(editor, {
    type: "state",
    session: child.session,
    panelId: child.panelId,
    state: { dirty: false, busy: false },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(getPluginAssistantProvider()).toBeNull();
});

it("closes the assistant provider when its iframe is replaced", () => {
  const { rerender } = render(
    <CustomPluginFrame
      pluginId="custom.editor"
      title="List"
      installationVersion="v1"
    />,
  );
  const list = screen.getByTitle("List") as HTMLIFrameElement;
  const main = handshake(list);
  uiMessage(list, { type: "prepare", session: main.session });
  const editor = document.querySelector(
    'iframe[src*="standby=1"]',
  ) as HTMLIFrameElement;
  const child = handshake(editor);
  uiMessage(list, {
    type: "open",
    id: "open-editor",
    request: { view: "record-editor", title: "Editor", params: {} },
    session: main.session,
  });
  const panelId = child.send.mock.calls.find(
    ([message]) => message.type === "activate",
  )![0].panel.panelId as string;
  fireEvent(
    window,
    new MessageEvent("message", {
      source: editor.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "assistant-open",
        path: "/extensions/custom.editor/assistant/open",
        method: "POST",
        panelId,
        body: {
          title: "Editor assistant",
          actionId: "chat",
          context: { itemId: "item-1" },
        },
      },
    }),
  );
  expect(getPluginAssistantProvider()).not.toBeNull();

  rerender(
    <CustomPluginFrame
      pluginId="custom.editor"
      title="List"
      installationVersion="v2"
    />,
  );
  expect(getPluginAssistantProvider()).toBeNull();
});

it("sizes plugin screens to their content and resets on navigation", () => {
  const { rerender } = render(
    <CustomPluginFrame
      pluginId="custom.demo"
      title="Plugin"
      screen={{ object: "demo", view: "records" }}
    />,
  );
  const frame = screen.getByTitle("Plugin") as HTMLIFrameElement;
  const resize = (
    height: unknown,
    source: Window | null = frame.contentWindow,
  ) =>
    fireEvent(
      window,
      new MessageEvent("message", {
        source,
        data: { ns: "savia-plugin", type: "resize", height },
      }),
    );
  resize(1250);
  expect(frame).toHaveStyle({ height: "1250px" });
  resize(480);
  expect(frame).toHaveStyle({ height: "480px" });
  resize(1_000_000);
  expect(frame).toHaveStyle({ height: "100000px" });
  resize(480);
  for (const invalid of [-1, 0, "900", Number.NaN, Number.POSITIVE_INFINITY])
    resize(invalid);
  resize(900, window);
  expect(frame).toHaveStyle({ height: "480px" });
  rerender(
    <CustomPluginFrame
      pluginId="custom.demo"
      title="Plugin"
      screen={{ object: "other", view: "records" }}
    />,
  );
  expect(screen.getByTitle("Plugin")).toHaveStyle({ height: "512px" });
});

it("keeps widget frames at their configured height", () => {
  render(
    <CustomPluginFrame
      pluginId="custom.demo"
      title="Widget"
      heightClassName="h-[320px]"
    />,
  );
  const frame = screen.getByTitle("Widget") as HTMLIFrameElement;
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { ns: "savia-plugin", type: "resize", height: 1500 },
    }),
  );
  expect(frame.style.height).toBe("");
  expect(frame.parentElement).toHaveClass("h-[320px]");
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
  expect(permissions).not.toContain("allow-popups");
});

it.each([
  "https://www.colombiacompra.gov.co/secop",
  `${window.location.origin}/v1/studio/12/api/file/test/download`,
])("opens safe navigation URL %s during a user gesture", (url) => {
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { isActive: true },
  });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(<CustomPluginFrame pluginId="custom.demo" title="Plugin" />);
  const frame = screen.getByTitle("Plugin") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");

  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "open-secops",
        path: "/navigation/external",
        method: "POST",
        body: { url },
        panelId: "panel-1",
      },
    }),
  );

  expect(open).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      ns: "savia-plugin",
      type: "response",
      id: "open-secops",
      panelId: "panel-1",
      ok: true,
      data: null,
    }),
    "*",
  );
});

it("rejects invalid external navigation requests without opening a window", () => {
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { isActive: true },
  });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(<CustomPluginFrame pluginId="custom.demo" title="Plugin" />);
  const frame = screen.getByTitle("Plugin") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  const requests = [
    { id: "http", body: { url: "http://example.com" } },
    { id: "javascript", body: { url: "javascript:alert(1)" } },
    { id: "data", body: { url: "data:text/html,hello" } },
    { id: "file", body: { url: "file:///etc/passwd" } },
    { id: "credentials", body: { url: "https://user:secret@example.com" } },
    { id: "relative", body: { url: "/secop" } },
    { id: "control", body: { url: "https://example.com/\nnext" } },
    {
      id: "too-long",
      body: { url: `https://example.com/${"a".repeat(2048)}` },
    },
    { id: "method", method: "GET", body: { url: "https://example.com" } },
  ];
  for (const request of requests) {
    fireEvent(
      window,
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          ns: "savia-plugin",
          type: "request",
          path: "/navigation/external",
          method: "POST",
          ...request,
        },
      }),
    );
  }

  expect(open).not.toHaveBeenCalled();
  for (const request of requests)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: request.id,
        ok: false,
        error: expect.any(String),
      }),
      "*",
    );
});

it("requires an active gesture and the current authorized frame for external navigation", () => {
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { isActive: false },
  });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(<CustomPluginFrame pluginId="custom.demo" title="Plugin" />);
  const frame = screen.getByTitle("Plugin") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  const request = {
    ns: "savia-plugin",
    type: "request",
    id: "gesture-required",
    path: "/navigation/external",
    method: "POST",
    body: { url: "https://example.com" },
  };

  fireEvent(
    window,
    new MessageEvent("message", {
      source: window,
      data: { ...request, id: "unauthorized-frame" },
    }),
  );
  fireEvent(
    window,
    new MessageEvent("message", { source: frame.contentWindow, data: request }),
  );
  expect(open).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ id: "gesture-required", ok: false }),
    "*",
  );
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ id: "unauthorized-frame" }),
    "*",
  );

  fireEvent(window, new Event("savia:session-cleared"));
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { ...request, id: "revoked-session" },
    }),
  );
  expect(open).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalledWith(
    expect.objectContaining({ id: "revoked-session" }),
    "*",
  );
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

it("drops a pending settings prefetch when the authenticated principal changes", async () => {
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
  fireEvent(window, new Event("savia:principal-changed"));
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

it("forwards only safe API error status and code through the iframe bridge", async () => {
  const transport = vi.fn(async () =>
    Response.json(
      {
        error: {
          message: "Record version conflict",
          code: "VERSION_CONFLICT",
          fileId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
      { status: 409 },
    ),
  );
  setStudioRuntime({ embedded: false, transport });
  render(<CustomPluginFrame pluginId="custom.demo" title="Plugin" />);
  const frame = screen.getByTitle("Plugin") as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");

  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "update-record",
        path: "/records/items/record-1",
        method: "PATCH",
        body: { name: "Updated" },
      },
    }),
  );

  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "response",
        id: "update-record",
        ok: false,
        error: "Record version conflict",
        errorStatus: 409,
        errorCode: "VERSION_CONFLICT",
        errorFileId: "550e8400-e29b-41d4-a716-446655440000",
      }),
      "*",
    ),
  );
  const response = send.mock.calls.find(
    ([message]) => (message as { id?: string }).id === "update-record",
  )?.[0] as Record<string, unknown>;
  expect(response).not.toHaveProperty("detail");
  expect(response).not.toHaveProperty("context");
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
it("allows closing failed editors and removes panels when the principal changes", () => {
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
  fireEvent(window, new Event("savia:principal-changed"));
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

it("binds task writes and source resolution to the current assistant session", async () => {
  const transport = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/api/records/assistant_tasks?"))
      return Response.json({ data: [], total: 0, page: 1, perPage: 2 });
    if (path === "/api/records/assistant_tasks" && init?.method === "POST")
      return Response.json({ data: { id: "task-1" } });
    return Response.json({
      data: {
        run: { status: "succeeded" },
        output: {
          data: {
            data: {
              revision: 1,
              messages: [],
              source: {
                url: "https://secop.example/private/source/ticket#page=4",
                page: 4,
              },
            },
          },
        },
      },
    });
  });
  setStudioRuntime({ embedded: false, transport });
  render(<CustomPluginFrame pluginId="example.provider" title="Provider" />);
  const frame = screen.getByTitle("Provider") as HTMLIFrameElement;
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: {
        ns: "savia-plugin",
        type: "request",
        id: "open",
        path: "/extensions/example.provider/assistant/open",
        method: "POST",
        body: {
          title: "Tender",
          actionId: "chat",
          context: { dossierId: "tender-1" },
          taskCollection: "assistant_tasks",
        },
      },
    }),
  );
  const provider = getPluginAssistantProvider()!;
  expect(
    (
      await provider.invoke({
        method: "open-source",
        messageId: "answer-1",
        citationId: "S001",
      })
    ).source?.page,
  ).toBe(4);
  const draft = {
    suggestion: {
      id: "R1",
      title: "Verify",
      description: "Two certificates",
      citationIds: [],
    },
    title: "Collect certificates",
    assignee: "José",
    dueDate: "2026-10-20",
    sourceReference: "Terms page 4",
  };
  expect(await provider.createTask!(draft)).toEqual({
    id: "task-1",
    created: true,
  });
  const post = transport.mock.calls.find(
    ([path, init]) =>
      path === "/api/records/assistant_tasks" && init?.method === "POST",
  );
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
    name: "Collect certificates",
    assignee: "José",
    status: "open",
  });
  fireEvent(window, new Event("savia:session-cleared"));
  const count = transport.mock.calls.length;
  await expect(provider.createTask!(draft)).rejects.toThrow(
    "session has ended",
  );
  expect(transport.mock.calls.length).toBe(count);
});
