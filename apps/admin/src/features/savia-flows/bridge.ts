import type { ApiClient } from "@/api/api-client";

const NS = "savia-flows";
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PATH = 4096;
const MAX_IN_FLIGHT = 64;

export type FlowsTheme = {
  mode: "light" | "dark";
  colorTheme: string;
  variables: Record<string, string>;
};

export function saviaFlowsGateState(input: {
  isPending: boolean;
  canAccess: boolean;
  loading: boolean;
}): "loading" | "denied" | "ready" {
  if (input.isPending) return "loading";
  if (!input.canAccess) return "denied";
  return input.loading ? "loading" : "ready";
}

type BridgeMessage = {
  namespace: typeof NS;
  channel: string;
  id?: string;
  type: string;
  path?: string;
  method?: string;
  headers?: [string, string][];
  body?: ArrayBuffer;
  theme?: FlowsTheme;
};

export function isSafeFlowsPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.length > MAX_PATH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("#") ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return false;
  try {
    let rawPath = value.split("?", 1)[0];
    for (let i = 0; i < 3; i++) {
      rawPath = decodeURIComponent(rawPath);
      if (
        rawPath.includes("\\") ||
        rawPath.split("/").some((part) => part === ".." || part === ".")
      )
        return false;
    }
    const url = new URL(value, "https://savia.invalid");
    if (url.origin !== "https://savia.invalid") return false;
    if (url.searchParams.has("tenant")) return false;
    let path = url.pathname;
    for (let i = 0; i < 3; i++) {
      path = decodeURIComponent(path);
      if (path.split("/").some((part) => part === ".." || part === "."))
        return false;
    }
    return !path.startsWith("//");
  } catch {
    return false;
  }
}

function safeHeaders(entries: unknown): Headers {
  const headers = new Headers();
  if (!Array.isArray(entries) || entries.length > 64) return headers;
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [key, value] = entry;
    if (typeof key !== "string" || typeof value !== "string") continue;
    if (
      /^(authorization|cookie|host|origin|referer|connection|content-length)$/i.test(
        key,
      )
    )
      continue;
    try {
      headers.set(key, value);
    } catch {
      /* invalid untrusted header */
    }
  }
  return headers;
}

function tenantPath(path: string, tenantId: number): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}tenant=${encodeURIComponent(`tenant:${tenantId}`)}`;
}

export function createSaviaFlowsHostBridge(options: {
  frame: HTMLIFrameElement;
  api: ApiClient;
  tenantId: number;
  origin: string;
  theme?: FlowsTheme;
}) {
  const channel = crypto.randomUUID();
  const pending = new Map<string, AbortController>();
  let started = false;
  let disposed = false;
  let theme = options.theme;
  const child = options.frame.contentWindow;

  const post = (
    message: Record<string, unknown>,
    transfer?: Transferable[],
  ) => {
    if (child && !disposed)
      child.postMessage(
        { namespace: NS, channel, ...message },
        options.origin,
        transfer ?? [],
      );
  };
  const reply = async (id: string, response: Response) => {
    try {
      const body = await (async () => {
        const reader = response.body?.getReader();
        if (!reader) return new ArrayBuffer(0);
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_BYTES) {
              await reader.cancel();
              throw new Error("Response exceeds the allowed transfer size.");
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        const body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return body.buffer;
      })();
      if (disposed) return;
      const headers = [
        "content-type",
        "content-disposition",
        "cache-control",
        "etag",
      ]
        .map((key) => [key, response.headers.get(key)] as const)
        .filter((row): row is readonly [string, string] => Boolean(row[1]));
      post(
        {
          id,
          type: "response",
          status: response.status,
          statusText: response.statusText,
          headers,
          body,
        },
        [body],
      );
    } catch (error) {
      post({
        id,
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "The response could not be transferred.",
      });
    }
  };

  const onMessage = (event: MessageEvent) => {
    if (disposed || event.origin !== options.origin || event.source !== child)
      return;
    const data = event.data as Partial<BridgeMessage> | null;
    if (!data || data.namespace !== NS) return;
    if (data.type === "ready") {
      started = true;
      post({ type: "init", theme });
      return;
    }
    if (data.channel !== channel) return;
    if (data.type === "cancel" && typeof data.id === "string") {
      pending.get(data.id)?.abort();
      pending.delete(data.id);
      return;
    }
    if (
      (data.type !== "request" && data.type !== "socket-ticket") ||
      typeof data.id !== "string" ||
      data.id.length > 128
    )
      return;
    const id = data.id;
    const path = data.path;
    if (!isSafeFlowsPath(path)) {
      post({ id, type: "error", message: "Invalid Savia Flows request path." });
      return;
    }
    if (data.method !== undefined && typeof data.method !== "string") {
      post({ id, type: "error", message: "Invalid request method." });
      return;
    }
    const socket = data.type === "socket-ticket";
    const tenantPathMatch = path.match(/^\/tenant:(\d+)(?:\/|$)/);
    if (
      pending.has(id) ||
      (tenantPathMatch && Number(tenantPathMatch[1]) !== options.tenantId)
    ) {
      post({
        id,
        type: "error",
        message: "Invalid or duplicate Savia Flows request.",
      });
      return;
    }
    const method = (data.method ?? "GET").toUpperCase();
    if (
      !socket &&
      !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)
    ) {
      post({ id, type: "error", message: "Unsupported request method." });
      return;
    }
    if (
      (!socket &&
        (/^\/admin(?:\/|$)/.test(path) ||
          /^\/auth\/(?:login|refresh|logout)(?:\/|$)/.test(path) ||
          (/\/integrations(?:\/|$)/.test(path) &&
            !["GET", "HEAD"].includes(method)))) ||
      (socket && /\/generate\//.test(path))
    ) {
      post({
        id,
        type: "error",
        message: "This action is disabled in local Savia Flows.",
      });
      return;
    }
    if (
      data.body &&
      (!(data.body instanceof ArrayBuffer) || data.body.byteLength > MAX_BYTES)
    ) {
      post({
        id,
        type: "error",
        message: "Request body exceeds the allowed size.",
      });
      return;
    }
    if (pending.size >= MAX_IN_FLIGHT) {
      post({
        id,
        type: "error",
        message: "Too many Savia Flows requests are in progress.",
      });
      return;
    }
    const controller = new AbortController();
    pending.set(id, controller);
    const requestPath = socket
      ? "/v1/savia-flows/ws-ticket"
      : `/v1/savia-flows${tenantPath(path, options.tenantId)}`;
    const requestInit: RequestInit = socket
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
          signal: controller.signal,
        }
      : {
          method,
          headers: safeHeaders(data.headers),
          body: data.body,
          signal: controller.signal,
          redirect: "manual",
        };
    if (!socket) requestInit.headers = safeHeaders(data.headers);
    void options.api
      .requestResponse(
        socket
          ? `${requestPath}?tenant=${encodeURIComponent(`tenant:${options.tenantId}`)}`
          : requestPath,
        requestInit,
      )
      .then((response) => reply(id, response))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          post({
            id,
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Savia Flows request failed.",
          });
      })
      .finally(() => pending.delete(id));
  };

  return {
    channel,
    start() {
      if (started || disposed) return;
      window.addEventListener("message", onMessage);
      started = true;
      post({ type: "init", theme });
    },
    setTheme(value: FlowsTheme) {
      theme = value;
      if (started) post({ type: "theme", theme: value });
    },
    dispose() {
      disposed = true;
      window.removeEventListener("message", onMessage);
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    },
  };
}
