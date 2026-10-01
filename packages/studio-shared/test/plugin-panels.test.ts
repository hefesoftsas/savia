import { expect, it } from "vitest";
import { parsePanelRequest } from "../src/plugin-panels";
it("accepts a bounded editor request", () => {
  const request = {
    view: "record-editor",
    title: "Account",
    params: { recordId: "123", mode: "payment" },
  };
  expect(parsePanelRequest(request)).toEqual(request);
});
it.each([
  { view: "unknown", title: "Account", params: {} },
  {
    view: "record-editor",
    title: "Account",
    params: {},
    url: "https://evil.test",
  },
  { view: "record-editor", title: "Account", params: { tenantId: 8 } },
  { view: "record-editor", title: "x".repeat(161), params: {} },
  {
    view: "record-editor",
    title: "Account",
    params: { recordId: "x".repeat(257) },
  },
  { view: "record-editor", title: "Account", params: { mode: "delete" } },
  null,
])("rejects invalid or scope-overriding panel requests", (value) => {
  expect(parsePanelRequest(value)).toBeNull();
});

import { afterEach, vi } from "vitest";
import { connectPluginPanelHost } from "../src/plugin-panels";
afterEach(() => vi.useRealTimers());
function frame() {
  const listeners = new Map<string, (event: any) => void>();
  const parent = { postMessage: vi.fn() };
  const win = {
    parent,
    crypto: { randomUUID: () => "nonce" },
    setTimeout,
    clearTimeout,
    addEventListener: (type: string, fn: (event: any) => void) =>
      listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    document: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      querySelectorAll: () => [],
    },
  } as unknown as Window;
  const send = (data: Record<string, unknown>, source: unknown = parent) =>
    listeners.get("message")?.({
      source,
      data: { ns: "savia-plugin-ui", version: 1, session: "session", ...data },
    });
  return { win, send, parent };
}
it("ignores forged initialization, correlates results and rejects pending requests on disposal", async () => {
  const f = frame();
  const connected = connectPluginPanelHost(f.win, false);
  f.send({ type: "init", nonce: "nonce" }, {});
  f.send({ type: "init", nonce: "wrong" });
  f.send({ type: "init", nonce: "nonce", panel: null });
  const api = (await connected)!;
  const result = api.openPanel({
    view: "record-editor",
    title: "Account",
    params: {},
  });
  f.send({ type: "result", id: "wrong", result: { status: "saved" } });
  f.send({ type: "result", id: "nonce", result: { status: "saved" } });
  await expect(result).resolves.toEqual({ status: "saved" });
  const pending = api.openPanel({
    view: "record-editor",
    title: "Account",
    params: {},
  });
  const rejected = expect(pending).rejects.toThrow("session ended");
  f.send({ type: "dispose" });
  await rejected;
});
it("falls back on old hosts but never renders a list for an unconnected editor", async () => {
  vi.useFakeTimers();
  const ordinary = connectPluginPanelHost(frame().win, false);
  const editor = connectPluginPanelHost(frame().win, true);
  const failed = expect(editor).rejects.toThrow("could not connect");
  await vi.advanceTimersByTimeAsync(2000);
  await expect(ordinary).resolves.toBeUndefined();
  await failed;
});
it("runs its serialized shell implementation without module dependencies", async () => {
  const connect = new Function(
    `return (${connectPluginPanelHost.toString()})`,
  )() as typeof connectPluginPanelHost;
  const f = frame();
  const panel = {
    panelId: "p1",
    request: { view: "record-editor", title: "Account", params: {} },
  };
  const ready = connect(f.win, true);
  f.send({ type: "init", nonce: "nonce", panel });
  const api = (await ready)!;
  expect(api.panel).toEqual(panel);
  await expect(api.openPanel(panel.request as any)).rejects.toThrow(
    "already open",
  );
  f.send({ type: "dispose" });
});
