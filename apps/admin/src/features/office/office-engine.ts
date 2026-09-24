import manifest from "../../../office-runtime.json";
import {
  officeFormat,
  validateOfficePackage,
} from "@savia/studio-shared/office";
export type OfficeEngine = {
  open(bytes: Uint8Array, name: string): Promise<void>;
  save(): Promise<Uint8Array>;
  dispose(): void;
};
type Events = { onDirty(): void; onError(error: Error): void; onSave?(): void };
type RuntimeFS = {
  mkdir(path: string): void;
  writeFile(path: string, bytes: Uint8Array): void;
  readFile(path: string): Uint8Array;
};
type RuntimeModule = {
  uno_main: Promise<MessagePort>;
  PThread?: { terminateAllThreads(): void };
  [key: string]: unknown;
};
declare global {
  interface Window {
    Module?: RuntimeModule;
    FS?: RuntimeFS;
    PThread?: { terminateAllThreads(): void };
  }
}
export async function loadOfficeEngine(
  canvas: HTMLCanvasElement,
  events: Events,
): Promise<OfficeEngine> {
  if (!window.crossOriginIsolated || typeof SharedArrayBuffer === "undefined")
    throw new Error(
      "Este navegador no puede iniciar el editor. Ábrelo en una ventana de Chrome, Edge o Firefox actualizada.",
    );
  // Emscripten owns page-level event handlers; a second runtime is unsafe even
  // after React unmounts (for example, development hot reload).
  if (window.Module)
    throw new Error(
      "El editor ya se inició en esta ventana. Recarga la página para volver a abrir el documento.",
    );
  let rejectStartup: ((error: Error) => void) | undefined;
  const base = new URL(
    "/office/runtime/" + manifest.build + "/",
    location.origin,
  ).href;
  const script = document.createElement("script");
  let port: MessagePort | undefined,
    filename = "",
    disposed = false,
    sequence = 0;
  const pending = new Map<
    number,
    {
      resolve(data: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function cleanup(error: Error) {
    disposed = true;
    port?.close();
    script.remove();
    // The pinned classic Emscripten script exposes PThread on window, while
    // Module.PThread is an aborting unexported-symbol getter.
    window.PThread?.terminateAllThreads();
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  }
  const fail = (error: Error) => {
    if (rejectStartup) rejectStartup(error);
    else cleanup(error);
    events.onError(error);
  };
  function send(
    cmd: string,
    extra: Record<string, unknown> = {},
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (disposed || !port)
        return reject(
          new Error("El editor se cerró. Vuelve a abrir el documento."),
        );
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            "El editor tardó demasiado. Conserva esta ventana y vuelve a intentarlo.",
          ),
        );
      }, 45000);
      pending.set(id, { resolve, reject, timer });
      port.postMessage({ cmd, id, ...extra });
    });
  }
  const module: RuntimeModule = {
    canvas,
    uno_scripts: [
      base + "zeta.js",
      new URL("/office/office-worker.js", location.origin).href,
    ],
    locateFile: (path: string) => base + path,
    mainScriptUrlOrBlob: new Blob(
      ["importScripts(" + JSON.stringify(base + "soffice.js") + ");"],
      { type: "text/javascript" },
    ),
    onAbort: (reason: unknown) =>
      fail(
        new Error(
          "No se pudo ejecutar el editor: " + String(reason).slice(0, 180),
        ),
      ),
    uno_main: undefined as unknown as Promise<MessagePort>,
  };
  window.Module = module;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        stop(
          new Error(
            "No se pudo cargar el editor. Comprueba la conexión y vuelve a abrir el documento.",
          ),
        ),
      120000,
    );
    const stop = (e: Error) => {
      clearTimeout(timeout);
      rejectStartup = undefined;
      cleanup(e);
      reject(e);
    };
    rejectStartup = stop;
    script.onerror = () =>
      stop(
        new Error(
          "El editor no está instalado o no está disponible. Contacta al administrador.",
        ),
      );
    script.onload = () => {
      if (disposed) {
        window.PThread?.terminateAllThreads();
        return;
      }
      if (!module.uno_main)
        return stop(new Error("El motor del editor no es compatible."));
      module.uno_main
        .then((p) => {
          if (disposed) {
            p.close();
            window.PThread?.terminateAllThreads();
            return;
          }
          port = p;
          port.onmessage = ({ data }) => {
            if (data.cmd === "ready") {
              clearTimeout(timeout);
              rejectStartup = undefined;
              resolve();
              return;
            }
            if (data.cmd === "dirty") {
              events.onDirty();
              return;
            }
            if (data.cmd === "save-request") {
              events.onSave?.();
              return;
            }
            const item = pending.get(data.id);
            if (item) {
              pending.delete(data.id);
              clearTimeout(item.timer);
              data.cmd === "error"
                ? item.reject(new Error(data.message))
                : item.resolve(data);
            } else if (data.cmd === "error") {
              const error = new Error(data.message);
              stop(error);
              fail(error);
            }
          };
        })
        .catch(stop);
    };
    script.src = base + "soffice.js";
    document.body.appendChild(script);
  });
  return {
    async open(bytes, name) {
      const format = officeFormat(name);
      if (!format)
        throw new Error("El formato del documento no está admitido.");
      await validateOfficePackage(bytes, format);
      filename = "document." + format;
      try {
        window.FS!.mkdir("/tmp/savia-office");
      } catch {
        /* directory may exist */
      }
      window.FS!.writeFile("/tmp/savia-office/" + filename, bytes);
      await send("open", { filename });
      window.dispatchEvent(new Event("resize"));
    },
    async save() {
      await send("save");
      return window.FS!.readFile("/tmp/savia-office/" + filename).slice();
    },
    dispose() {
      cleanup(new Error("Editor cerrado."));
    },
  };
}
