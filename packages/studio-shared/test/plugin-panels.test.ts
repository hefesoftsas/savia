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

it("keeps the serialized client self-contained after the Worker production transform", async () => {
  const { execFileSync } = await import("node:child_process");
  const { readFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { runInNewContext } = await import("node:vm");
  const dir = mkdtempSync(join(tmpdir(), "panel-client-build-"));
  try {
    const output = join(dir, "client.cjs");
    execFileSync(
      resolve("../../apps/admin/node_modules/.bin/esbuild"),
      [
        "src/plugin-panels.ts",
        "--bundle",
        "--platform=node",
        "--format=cjs",
        "--keep-names",
        "--minify",
        `--outfile=${output}`,
      ],
      { stdio: "pipe" },
    );
    const module = {
      exports: {} as { connectPluginPanelHost: typeof connectPluginPanelHost },
    };
    runInNewContext(readFileSync(output, "utf8"), {
      module,
      exports: module.exports,
    });
    const connect = new Function(
      `return (${module.exports.connectPluginPanelHost.toString()})`,
    )() as typeof connectPluginPanelHost;
    const f = frame();
    const ready = connect(f.win, false);
    f.send({ type: "init", nonce: "nonce", panel: null });
    expect(await ready).toBeDefined();
    f.send({ type: "dispose" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps standby inert and gives each activation a revocable API", async () => {
  const f = frame();
  const changed = vi.fn();
  const connected = connectPluginPanelHost(f.win, true, { standby: true, onChange: changed });
  f.send({ type: "init", nonce: "nonce", panel: null });
  const api = (await connected)!;
  expect(api.panel).toBeNull();
  expect(changed).not.toHaveBeenCalled();
  const panel = { panelId: "a", request: { view: "record-editor", title: "Account", params: {} } };
  f.send({ type: "activate", panel }, {});
  f.send({ type: "activate", panel, session: "foreign" });
  expect(changed).not.toHaveBeenCalled();
  f.send({ type: "activate", panel });
  const first = changed.mock.calls[0][0];
  expect(first.panel).toEqual(panel);
  f.send({ type: "deactivate", panelId: "wrong" });
  expect(changed).toHaveBeenCalledTimes(1);
  f.send({ type: "deactivate", panelId: "a" });
  expect(changed).toHaveBeenLastCalledWith(null);
  f.send({ type: "deactivate", panelId: "a" });
  expect(changed).toHaveBeenCalledTimes(2);
  f.send({ type: "activate", panel: { ...panel, panelId: "b" } });
  f.parent.postMessage.mockClear();
  first.setPanelState({ dirty: true, busy: true });
  first.completePanel({ status: "saved" });
  expect(f.parent.postMessage).not.toHaveBeenCalled();
  changed.mock.calls[2][0].setPanelState({ dirty: false, busy: false });
  expect(f.parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state", panelId: "b" }), "*");
  f.send({ type: "dispose" });
  expect(changed).toHaveBeenLastCalledWith(null);
});
