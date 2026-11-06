import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadOfficeEngine } from "./office-engine";
vi.mock("@savia/studio-shared/office", () => ({
  officeFormat: () => "docx",
  validateOfficePackage: async () => {},
}));
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

it("passes read-only mode to the worker open request", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const port = {
    close: vi.fn(),
    postMessage: vi.fn(),
    onmessage: null as
      ((event: { data: { cmd: string; id?: number } }) => void) | null,
  };
  const fileSystem = {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(() => new Uint8Array([1, 2])),
  };
  window.FS = fileSystem;
  const loaded = loadOfficeEngine(document.createElement("canvas"), events);
  const module = window.Module!;
  module.uno_main = Promise.resolve(port as unknown as MessagePort);
  document
    .querySelector('script[src*="/office/runtime/"]')!
    .dispatchEvent(new Event("load"));
  await Promise.resolve();
  port.onmessage!({ data: { cmd: "ready" } });
  const engine = await loaded;
  const opening = engine.open(new Uint8Array([1, 2]), "policy.docx", {
    readOnly: true,
  });
  await Promise.resolve();
  const request = port.postMessage.mock.calls[0][0] as Record<string, unknown>;
  expect(request).toMatchObject({
    cmd: "open",
    filename: "document.docx",
    readOnly: true,
  });
  port.onmessage!({ data: { cmd: "opened", id: request.id as number } });
  await opening;
  engine.dispose();
});

it("does not expose native or bridge saves for a read-only worker document", async () => {
  const makeProperty = class {
    constructor(readonly fields: Record<string, unknown>) {}
  };
  let interceptor: Record<string, (...args: any[]) => unknown> | undefined;
  const dispatched: Record<string, unknown>[] = [];
  const port = {
    onmessage: null as
      ((event: { data: Record<string, unknown> }) => void) | null,
    postMessage: vi.fn((message: Record<string, unknown>) =>
      dispatched.push(message),
    ),
  };
  const model = {
    getCurrentController: () => ({
      getFrame: () => ({
        getContainerWindow: () => ({}),
        registerDispatchProviderInterceptor: (
          value: Record<string, (...args: any[]) => unknown>,
        ) => {
          interceptor = value;
        },
      }),
    }),
    addModifyListener: vi.fn(),
    getURL: () => "file:///tmp/savia-office/document.docx",
    store: vi.fn(),
    isModified: () => false,
  };
  const desktop = {
    loadComponentFromURL: vi.fn(
      (
        _path,
        _target,
        _flags,
        properties: { fields: Record<string, unknown> }[],
      ) => {
        dispatched.push({ cmd: "load-properties", properties });
        return model;
      },
    ),
  };
  const css = {
    frame: {
      Desktop: { create: () => desktop },
      XDispatch: {},
      XDispatchProviderInterceptor: {},
      FeatureStateEvent: makeProperty,
    },
    beans: { PropertyValue: makeProperty },
    util: { XModifyListener: {} },
  };
  const workerModule = {
    zetajs: Promise.resolve({
      uno: { com: { sun: { star: css } } },
      getUnoComponentContext: () => ({}),
      mainPort: port,
      unoObject: (
        _interfaces: unknown[],
        implementation: Record<string, (...args: any[]) => unknown>,
      ) => implementation,
      Any: class {
        constructor(
          readonly type: unknown,
          readonly value: unknown,
        ) {}
      },
      type: { short: "short", boolean: "boolean" },
    }),
  };
  const source = readFileSync(
    resolve(process.cwd(), "public/office/office-worker.js"),
    "utf8",
  );
  new Function("Module", source)(workerModule);
  await Promise.resolve();
  await Promise.resolve();
  port.onmessage!({
    data: { cmd: "open", id: 1, filename: "document.docx", readOnly: true },
  });
  const loadProperties = dispatched.find(
    (item) => item.cmd === "load-properties",
  )!.properties as { fields: Record<string, unknown> }[];
  expect(loadProperties).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        fields: { Name: "ReadOnly", Value: expect.anything() },
      }),
    ]),
  );
  const readOnly = loadProperties.find(
    (property) => property.fields.Name === "ReadOnly",
  )!;
  expect(readOnly.fields.Value).toMatchObject({ type: "boolean", value: true });
  const delegatedDispatch = vi.fn(() => ({ command: "edit" }));
  interceptor!.setSlaveDispatchProvider({ queryDispatch: delegatedDispatch });
  expect(
    interceptor!.queryDispatch({ Complete: ".uno:Save" }, "", 0),
  ).toBeNull();
  expect(
    interceptor!.queryDispatch({ Complete: ".uno:EditDoc" }, "", 0),
  ).toBeNull();
  expect(delegatedDispatch).not.toHaveBeenCalled();
  port.onmessage!({ data: { cmd: "save", id: 2 } });
  expect(model.store).not.toHaveBeenCalled();
  expect(port.postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({ cmd: "error", id: 2 }),
  );
});
