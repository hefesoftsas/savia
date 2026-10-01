import { expect, it, vi } from "vitest";
import { shellBootstrapJs } from "../src/plugin-store";

it("preloads without business rendering, cleans each activation, and rejects stale SDK calls", async () => {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const postMessage = vi.fn();
  const parent = { postMessage };
  const send = (data: unknown) =>
    listeners.get("message")?.forEach((fn) => fn({ source: parent, data }));
  const ui = (data: object) =>
    send({ ns: "savia-plugin-ui", version: 1, session: "s", ...data });
  const root = { innerHTML: "" };
  const document = {
    getElementById: () => root,
    documentElement: { style: { setProperty() {} } },
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    parent,
    document,
    crypto: { randomUUID: () => "n" },
    fetch: vi.fn(),
    setTimeout,
    clearTimeout,
    addEventListener(type: string, fn: any) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: any) {
      listeners.get(type)?.delete(fn);
    },
  };
  const cleanup = vi.fn();
  const module = { render: vi.fn(), renderPanel: vi.fn(() => cleanup) };
  const code = shellBootstrapJs()
    .replaceAll(
      "import.meta.url",
      JSON.stringify(
        "https://host/api/plugin-store/shell-bootstrap.js?plugin=test&entry=https://host/api/plugin-store/test/entry&panel=1&standby=1",
      ),
    )
    .replace("import(ENTRY_URL)", "Promise.resolve(importedModule)");
  const run = new Function(
    "window",
    "parent",
    "document",
    "addEventListener",
    "importedModule",
    `return (async () => { ${code} })()`,
  );
  const ready = run(
    window,
    parent,
    document,
    window.addEventListener.bind(window),
    module,
  );
  ui({ type: "init", nonce: "n", panel: null });
  await ready;
  expect(module.render).not.toHaveBeenCalled();
  expect(module.renderPanel).not.toHaveBeenCalled();
  const panel = {
    panelId: "a",
    request: { view: "record-editor", title: "A", params: {} },
  };
  ui({ type: "activate", panel });
  expect(module.renderPanel).toHaveBeenCalledTimes(1);
  const old = (module.renderPanel.mock.calls as any)[0][1];
  ui({ type: "deactivate", panelId: "a" });
  ui({ type: "deactivate", panelId: "a" });
  expect(cleanup).toHaveBeenCalledTimes(1);
  ui({ type: "activate", panel: { ...panel, panelId: "b" } });
  await expect(
    old.collections.collection("items").create({ name: "stale" }),
  ).rejects.toThrow("activation");
  expect(
    postMessage.mock.calls.filter(([m]) => m.type === "request"),
  ).toHaveLength(0);
  ui({ type: "dispose" });
  expect(cleanup).toHaveBeenCalledTimes(2);
});
