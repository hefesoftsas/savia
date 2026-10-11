import PluginEditorTypeScriptWorker from "./plugin-editor-typescript-worker?worker";
import type {
  PluginEditorCompletionEntry,
  PluginEditorFileMap,
} from "./plugin-editor-typescript-service";

type Request = {
  id: number;
  files: PluginEditorFileMap;
  path: string;
  offset: number;
};

type Response =
  | { id: number; entries: PluginEditorCompletionEntry[] }
  | { id: number; error: string };

type PendingRequest = {
  resolve: (entries: PluginEditorCompletionEntry[]) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const requestTimeoutMs = 5_000;
const pending = new Map<number, PendingRequest>();
let worker: Worker | undefined;
let nextRequestId = 0;

function rejectPending(error: Error) {
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
  pending.clear();
}

function ensureWorker() {
  if (worker) return worker;
  const instance = new PluginEditorTypeScriptWorker();
  instance.addEventListener("message", (event: MessageEvent<Response>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timeout);
    if ("error" in response) request.reject(new Error(response.error));
    else request.resolve(response.entries);
  });
  instance.addEventListener("error", () => {
    rejectPending(new Error("TypeScript completion worker failed"));
    instance.terminate();
    if (worker === instance) worker = undefined;
  });
  worker = instance;
  return instance;
}

export function complete(
  files: PluginEditorFileMap,
  path: string,
  offset: number,
): Promise<PluginEditorCompletionEntry[]> {
  const id = ++nextRequestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("TypeScript completion timed out"));
    }, requestTimeoutMs);
    pending.set(id, { resolve, reject, timeout });
    try {
      const request: Request = { id, files, path, offset };
      ensureWorker().postMessage(request);
    } catch (error) {
      pending.delete(id);
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function disposePluginEditorTypeScriptClient() {
  worker?.terminate();
  worker = undefined;
  rejectPending(new Error("TypeScript completion worker was disposed"));
}

export class PluginEditorTypescriptClient {
  complete = complete;
  dispose = disposePluginEditorTypeScriptClient;
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", disposePluginEditorTypeScriptClient);
}
