import { afterEach, expect, it, vi } from "vitest";
import { loadOfficeEngine } from "./office-engine";
const events = { onDirty: vi.fn(), onError: vi.fn() };
afterEach(() => {
  delete window.Module;
  delete window.PThread;
  document
    .querySelectorAll('script[src*="/office/runtime/"]')
    .forEach((s) => s.remove());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("requires browser isolation before loading the runtime", async () => {
  vi.stubGlobal("crossOriginIsolated", false);
  await expect(
    loadOfficeEngine(document.createElement("canvas"), events),
  ).rejects.toThrow("navegador");
  expect(document.querySelector('script[src*="/office/runtime/"]')).toBeNull();
});
it("refuses to start a second page-global engine after an unmount", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  window.Module = { uno_main: Promise.resolve({} as MessagePort) };
  await expect(
    loadOfficeEngine(document.createElement("canvas"), events),
  ).rejects.toThrow("Recarga");
  expect(document.querySelector('script[src*="/office/runtime/"]')).toBeNull();
});
it("disposes without accessing Emscripten's unexported runtime getter", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const terminate = vi.fn();
  window.PThread = { terminateAllThreads: terminate };
  const loaded = loadOfficeEngine(document.createElement("canvas"), events);
  const module = window.Module!;
  const trap = vi.fn(() => {
    throw new Error("PThread is not exported");
  });
  Object.defineProperty(module, "PThread", { get: trap });
  const port = {
    close: vi.fn(),
    onmessage: null as ((event: { data: { cmd: string } }) => void) | null,
  };
  module.uno_main = Promise.resolve(port as unknown as MessagePort);
  document
    .querySelector('script[src*="/office/runtime/"]')!
    .dispatchEvent(new Event("load"));
  await Promise.resolve();
  port.onmessage!({ data: { cmd: "ready" } });
  const engine = await loaded;
  engine.dispose();
  expect(trap).not.toHaveBeenCalled();
  expect(port.close).toHaveBeenCalled();
  expect(terminate).toHaveBeenCalled();
});

it("terminates workers when startup fails before an engine is returned", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const terminate = vi.fn();
  window.PThread = { terminateAllThreads: terminate };
  const loaded = loadOfficeEngine(document.createElement("canvas"), events);
  const rejected = expect(loaded).rejects.toThrow("no está disponible");
  document
    .querySelector('script[src*="/office/runtime/"]')!
    .dispatchEvent(new Event("error"));
  await rejected;
  expect(terminate).toHaveBeenCalled();
  expect(document.querySelector('script[src*="/office/runtime/"]')).toBeNull();
});
