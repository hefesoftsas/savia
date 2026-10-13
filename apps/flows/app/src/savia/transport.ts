const NS = "savia-flows";
const API_MARKER = "/__savia_flows_api";
const PUBLIC_API_PREFIX = "/api/public/savia-flows/";
const MAX_BYTES = 32 * 1024 * 1024;
const PUBLIC_CAPABILITIES = new Set([
  "http",
  "queues",
  "forms",
  "form-triggers",
  "feedback-forms",
]);

type PublicSaviaFlowsRequest = {
  url: string;
  authorizationAllowed: boolean;
};

type ThemeMessage = {
  mode: "light" | "dark";
  colorTheme: string;
  variables: Record<string, string>;
};

let channel: string | undefined;
let hostOrigin = "";
let initialization: Promise<void> | undefined;
let originalFetch: typeof fetch;
let resolveInitialization: (() => void) | undefined;
let initializationTimeout: number | undefined;
const pending = new Map<
  string,
  {
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
    abort?: () => void;
    timeout?: number;
  }
>();

function applyTheme(theme: ThemeMessage) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme.mode);
  root.dataset.colorTheme = theme.colorTheme;
  for (const [key, value] of Object.entries(theme.variables ?? {})) {
    if (/^--[a-z0-9-]+$/i.test(key) && typeof value === "string") {
      root.style.setProperty(`--savia${key.slice(1)}`, value);
    }
  }
}

function onMessage(event: MessageEvent) {
  if (event.source !== window.parent || event.origin !== hostOrigin) return;
  const data = event.data;
  if (!data || data.namespace !== NS) return;
  if (data.type === "init" && typeof data.channel === "string") {
    channel = data.channel;
    applyTheme(data.theme);
    resolveInitialization?.();
    return;
  }
  if (!channel || data.channel !== channel) return;
  if (data.type === "theme") {
    applyTheme(data.theme);
    return;
  }
  if (typeof data.id !== "string") return;
  const item = pending.get(data.id);
  if (!item) return;
  pending.delete(data.id);
  if (item.timeout !== undefined) window.clearTimeout(item.timeout);
  item.abort?.();
  if (data.type === "error")
    item.reject(new Error(data.message || "Savia Flows request failed."));
  else if (data.type === "response" && data.body instanceof ArrayBuffer) {
    try {
      const body =
        data.status === 204 || data.status === 304 ? null : data.body;
      item.resolve(
        new Response(body, {
          status: data.status,
          statusText: data.statusText,
          headers: data.headers,
        }),
      );
    } catch (error) {
      item.reject(
        error instanceof Error
          ? error
          : new Error("Invalid response from Savia host."),
      );
    }
  }
}

function waitForHost(): Promise<void> {
  if (initialization) return initialization;
  hostOrigin = window.location.origin;
  originalFetch = window.fetch.bind(window);
  window.addEventListener("message", onMessage);
  initialization = new Promise((resolve, reject) => {
    resolveInitialization = () => {
      if (initializationTimeout !== undefined)
        window.clearTimeout(initializationTimeout);
      initializationTimeout = undefined;
      resolveInitialization = undefined;
      resolve();
    };
    initializationTimeout = window.setTimeout(() => {
      initializationTimeout = undefined;
      resolveInitialization = undefined;
      initialization = undefined;
      reject(new Error("Savia Flows host connection timed out."));
    }, 10000);
    window.parent.postMessage({ namespace: NS, type: "ready" }, hostOrigin);
  });
  return initialization;
}

function requestHost(
  message: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  if (window.parent === window)
    return Promise.reject(
      new TypeError(
        "Private Savia Flows requests require the Savia workspace.",
      ),
    );
  let abortWaiting: (() => void) | undefined;
  const waitingForHost = signal
    ? Promise.race([
        waitForHost(),
        new Promise<void>((_resolve, reject) => {
          abortWaiting = () =>
            reject(new DOMException("The request was aborted.", "AbortError"));
          if (signal.aborted) abortWaiting();
          else signal.addEventListener("abort", abortWaiting, { once: true });
        }),
      ]).finally(() => {
        if (abortWaiting) signal.removeEventListener("abort", abortWaiting);
      })
    : waitForHost();
  return waitingForHost.then(
    () =>
      new Promise<Response>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("The request was aborted.", "AbortError"));
          return;
        }
        const id = crypto.randomUUID();
        const cleanup = () => {
          const item = pending.get(id);
          if (item?.timeout !== undefined) window.clearTimeout(item.timeout);
          pending.delete(id);
          signal?.removeEventListener("abort", abort);
        };
        const abort = () => {
          window.parent.postMessage(
            { namespace: NS, channel, type: "cancel", id },
            hostOrigin,
          );
          cleanup();
          reject(new DOMException("The request was aborted.", "AbortError"));
        };
        const timeout = window.setTimeout(() => {
          window.parent.postMessage(
            { namespace: NS, channel, type: "cancel", id },
            hostOrigin,
          );
          cleanup();
          reject(new Error("Savia Flows host request timed out."));
        }, 120000);
        pending.set(id, {
          resolve,
          reject,
          abort: () => signal?.removeEventListener("abort", abort),
          timeout,
        });
        signal?.addEventListener("abort", abort, { once: true });
        const transfer =
          message.body instanceof ArrayBuffer ? [message.body] : [];
        window.parent.postMessage(
          { namespace: NS, channel, id, ...message },
          hostOrigin,
          transfer,
        );
      }),
  );
}

function isApiRequest(url: URL): boolean {
  return (
    url.origin === window.location.origin &&
    (url.pathname === API_MARKER || url.pathname.startsWith(`${API_MARKER}/`))
  );
}

/** Resolve a public marker or gateway URL without accepting arbitrary paths. */
export function parsePublicSaviaFlowsRequest(
  value: string,
  origin: string,
): PublicSaviaFlowsRequest | null {
  try {
    const base = new URL(origin);
    const url = new URL(value, base);
    if (url.origin !== base.origin || url.username || url.password || url.hash)
      return null;
    const isMarker =
      url.pathname === API_MARKER || url.pathname.startsWith(`${API_MARKER}/`);
    const isGateway = url.pathname.startsWith(PUBLIC_API_PREFIX);
    if (!isMarker && !isGateway) return null;
    const path = (
      isMarker
        ? url.pathname.slice(API_MARKER.length)
        : url.pathname.slice("/api/public/savia-flows".length)
    ).replace(/^\//, "");
    const segments = path.split("/");
    if (segments.length !== 2) return null;
    const [capability, encodedId] = segments;
    if (!PUBLIC_CAPABILITIES.has(capability!)) return null;
    let id: string;
    try {
      id = decodeURIComponent(encodedId!);
    } catch {
      return null;
    }
    if (!/^[A-Za-z0-9._~-]{1,2048}$/.test(id) || id === "." || id === "..")
      return null;
    const target = new URL(
      `${PUBLIC_API_PREFIX}${encodeURIComponent(capability!)}/${encodeURIComponent(id)}`,
      base,
    );
    target.search = url.search;
    return {
      url: target.toString(),
      authorizationAllowed: capability === "http" || capability === "queues",
    };
  } catch {
    return null;
  }
}

function publicRequestHeaders(
  source: Headers,
  authorizationAllowed: boolean,
): Headers {
  const headers = new Headers();
  for (const name of ["accept", "content-type"]) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (authorizationAllowed) {
    const authorization = source.get("authorization");
    if (authorization !== null) headers.set("authorization", authorization);
  }
  return headers;
}

async function fetchPublicCapability(
  request: Request,
  capability: PublicSaviaFlowsRequest,
): Promise<Response> {
  const body =
    request.method === "GET" ? undefined : await request.arrayBuffer();
  if (body && body.byteLength > MAX_BYTES)
    throw new Error("Request exceeds the local Savia Flows transfer limit.");
  return originalFetch(capability.url, {
    method: request.method,
    headers: publicRequestHeaders(
      request.headers,
      capability.authorizationAllowed,
    ),
    body,
    credentials: "omit",
    redirect: "manual",
    signal: request.signal,
  });
}

export async function saviaFlowsFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (isApiRequest(url)) {
    const publicCapability = parsePublicSaviaFlowsRequest(
      `${url.pathname}${url.search}`,
      window.location.origin,
    );
    if (publicCapability)
      return fetchPublicCapability(request, publicCapability);
    const markerRemainder = url.pathname.slice(API_MARKER.length);
    if (
      /^\/(?:http|queues|forms|form-triggers|feedback-forms)(?:\/|$)/.test(
        markerRemainder,
      )
    )
      throw new TypeError("Invalid Savia Flows public capability request.");
    const path = `${url.pathname.slice(API_MARKER.length)}${url.search}` || "/";
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer();
    if (body && body.byteLength > MAX_BYTES)
      throw new Error("Request exceeds the local Savia Flows transfer limit.");
    const response = await requestHost(
      {
        type: "request",
        path: path.startsWith("/") ? path : `/${path}`,
        method: request.method,
        headers: [...request.headers],
        body,
      },
      request.signal,
    );
    return response;
  }
  const publicCapability = parsePublicSaviaFlowsRequest(
    `${url.pathname}${url.search}`,
    window.location.origin,
  );
  if (publicCapability) return fetchPublicCapability(request, publicCapability);
  if (
    url.origin === window.location.origin &&
    url.pathname.startsWith("/flows-ui/")
  )
    return originalFetch(input, init);
  throw new TypeError(
    "Savia Flows local mode blocks network requests outside its authenticated host transport.",
  );
}

export function installSaviaFlowsTransport() {
  const inFrame = window.parent !== window;
  originalFetch = window.fetch.bind(window);
  if (!inFrame && !isStandalonePublicForm(window.location.pathname))
    return "standalone" as const;
  const ready = inFrame ? waitForHost() : undefined;
  window.fetch = saviaFlowsFetch;
  void ready?.catch((error) => console.error(error));
  return inFrame ? ("embedded" as const) : ("public" as const);
}

export function isStandalonePublicForm(pathname: string): boolean {
  const match =
    /^\/flows-ui\/(?:form|forms|feedback)\/([A-Za-z0-9._~-]{1,2048})\/?$/.exec(
      pathname,
    );
  return Boolean(match && match[1] !== "." && match[1] !== "..");
}

export function isSafeSaviaFlowsSocketUrl(
  value: string,
  origin: string,
): boolean {
  try {
    const url = new URL(value);
    const host = new URL(origin);
    const expectedProtocol = host.protocol === "https:" ? "wss:" : "ws:";
    const tickets = url.searchParams.getAll("ticket");
    return (
      url.protocol === expectedProtocol &&
      url.host === host.host &&
      url.pathname === "/api/public/savia-flows/ws" &&
      tickets.length === 1 &&
      tickets[0].length > 0 &&
      tickets[0].length <= 2048 &&
      [...url.searchParams.keys()].every((key) => key === "ticket") &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export async function requestSaviaFlowsSocketTicket(
  path: string,
): Promise<string> {
  if (!/^\/tenant:\d+\/(?:ws|generate)\/[A-Za-z0-9_-]+$/.test(path))
    throw new TypeError("Invalid workflow socket path.");
  const response = await requestHost({ type: "socket-ticket", path });
  if (!response.ok)
    throw new Error(`Socket ticket request failed (${response.status}).`);
  const body = (await response.json()) as { url?: unknown };
  if (typeof body.url !== "string")
    throw new Error("The host returned an invalid socket ticket.");
  if (!isSafeSaviaFlowsSocketUrl(body.url, window.location.origin))
    throw new Error("The host returned an unsafe socket URL.");
  return body.url;
}

export function __resetTransportForTests() {
  for (const item of pending.values())
    item.reject(new Error("Transport reset"));
  pending.clear();
  channel = undefined;
  initialization = undefined;
}
