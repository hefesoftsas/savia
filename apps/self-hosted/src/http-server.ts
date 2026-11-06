import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createReadStream } from "node:fs";
import { isIP } from "node:net";
import { realpath, stat } from "node:fs/promises";
import { resolve, relative, extname, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gatewayFetch } from "../../admin/src/edge-gateway";
import {
  normalizeCanonicalHost,
  parseTenantSlugFromHostname,
} from "@savia/tenant-host/tenant-host";
import type { createNodeRealtimeHub } from "./realtime";

export type NodeRealtimeHub = ReturnType<typeof createNodeRealtimeHub>;
type Options = {
  host: string;
  port: number;
  publicOrigin: string;
  canonicalHost: string;
  adminDirectory: string;
  fetchApi(request: Request): Promise<Response>;
  realtime: NodeRealtimeHub;
  /** Exact peer IPs only. The proxy must overwrite or append the client IP to X-Forwarded-For. */
  trustedProxyAddresses?: string[];
};
const INTERNAL_UPGRADE = "x-savia-internal-realtime-upgrade";
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};
function safePath(path: string): string {
  const decoded = decodeURIComponent(path);
  if (
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.split("/").some((part) => part === ".." || part === ".")
  )
    throw new Error("Invalid path");
  return decoded;
}
/** Native HTTP owner. Proxy identity headers are untrusted; IP is the socket peer. */
export async function startHttpServer(options: Options) {
  const trustedProxies = new Set(options.trustedProxyAddresses ?? []);
  if ([...trustedProxies].some((address) => !isIP(address)))
    throw new Error("Trusted proxy addresses must be exact IP addresses.");
  const origin = new URL(options.publicOrigin);
  const canonical = normalizeCanonicalHost(options.canonicalHost);
  const root = await realpath(options.adminDirectory);
  const file = async (path: string) => {
    try {
      const candidate = await realpath(resolve(root, `.${path}`));
      const subpath = relative(root, candidate);
      if (
        subpath === ".." ||
        subpath.startsWith(`..${sep}`) ||
        subpath.startsWith(sep)
      )
        return null;
      const metadata = await stat(candidate);
      return metadata.isFile() ? { candidate, size: metadata.size } : null;
    } catch {
      return null;
    }
  };
  const body = (path: string) =>
    Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  const assets = async (request: Request) => {
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    let path: string;
    try {
      path = safePath(new URL(request.url).pathname);
    } catch {
      return new Response("Invalid path", { status: 400 });
    }
    if (path.split("/").some((part) => part.startsWith(".")))
      return new Response("Not found", { status: 404 });
    let found = await file(path);
    if (
      !found &&
      !extname(path) &&
      !path.startsWith("/assets/") &&
      !path.startsWith("/office/runtime/")
    ) {
      path =
        path === "/office" || path.startsWith("/office/")
          ? "/office/index.html"
          : "/index.html";
      found = await file(path);
    }
    if (!found)
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    let encoding: string | undefined;
    const accepted = new Map(
      (request.headers.get("Accept-Encoding") ?? "").split(",").map((entry) => {
        const [name, ...parameters] = entry.trim().toLowerCase().split(";");
        const quality = parameters.find((value) =>
          value.trim().startsWith("q="),
        );
        return [name, quality ? Number(quality.trim().slice(2)) : 1] as const;
      }),
    );
    if (
      [".js", ".mjs", ".css", ".json", ".svg", ".html", ".wasm"].includes(
        extname(path),
      )
    ) {
      const preferences = (["br", "gzip"] as const)
        .map((name) => ({
          name,
          quality: accepted.get(name) ?? accepted.get("*") ?? 0,
        }))
        .filter((item) => item.quality > 0)
        .sort((a, b) => b.quality - a.quality);
      for (const preference of preferences) {
        const compressed = await file(
          `${path}.${preference.name === "br" ? "br" : "gz"}`,
        );
        if (compressed) {
          found = compressed;
          encoding = preference.name;
          break;
        }
      }
    }
    const cache =
      extname(path) === ".html" ||
      path === "/sw.js" ||
      extname(path) === ".webmanifest"
        ? "no-store"
        : /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(path)
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600";
    return new Response(
      request.method === "HEAD" ? null : body(found.candidate),
      {
        headers: {
          "Content-Type": mime[extname(path)] ?? "application/octet-stream",
          "Content-Length": String(found.size),
          "Cache-Control": cache,
          "X-Content-Type-Options": "nosniff",
          Vary: "Accept-Encoding",
          ...(encoding ? { "Content-Encoding": encoding } : {}),
        },
      },
    );
  };
  const dispatch = async (
    incoming: IncomingMessage,
    upgrade = false,
  ): Promise<Response> => {
    const target = incoming.url ?? "/";
    if (!target.startsWith("/") || target.startsWith("//"))
      return new Response("Invalid request target", { status: 400 });
    try {
      safePath(target.split("?")[0]);
    } catch {
      return new Response("Invalid path", { status: 400 });
    }
    const pathname = target.split("?")[0];
    let hostname = canonical;
    try {
      const host = incoming.headers.host;
      if (!host || /[\s\\/@?#]/.test(host)) throw new Error("Invalid host");
      const parsed = new URL(`${origin.protocol}//${host}`);
      hostname = normalizeCanonicalHost(parsed.hostname);
      if (
        (hostname !== canonical &&
          !parseTenantSlugFromHostname(hostname, canonical)) ||
        parsed.port !== origin.port
      )
        throw new Error("Unexpected host");
    } catch {
      if (pathname !== "/health")
        return new Response("Unexpected host", { status: 421 });
      hostname = canonical;
    }
    const url = new URL(origin);
    url.hostname = hostname;
    const requestUrl = new URL(target, url);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (
        value === undefined ||
        name.startsWith("x-forwarded") ||
        [
          "forwarded",
          "cf-connecting-ip",
          "true-client-ip",
          "x-real-ip",
          "x-savia-tenant-slug",
          "x-savia-tenant-branding",
          INTERNAL_UPGRADE,
          "host",
          "connection",
          "transfer-encoding",
        ].includes(name)
      )
        continue;
      if (!upgrade && name === "upgrade") continue;
      if (Array.isArray(value))
        for (const item of value) headers.append(name, item);
      else headers.set(name, value);
    }
    headers.set("host", url.host);
    const peer = incoming.socket.remoteAddress ?? "unknown";
    const forwarded = incoming.headers["x-forwarded-for"];
    const finalHop =
      typeof forwarded === "string"
        ? forwarded.split(",").at(-1)?.trim()
        : undefined;
    const clientIp =
      trustedProxies.has(peer) && finalHop && isIP(finalHop) ? finalHop : peer;
    headers.set("cf-connecting-ip", clientIp);
    if (!upgrade && incoming.headers.upgrade)
      return new Response("WebSocket upgrade required", { status: 426 });
    const controller = new AbortController();
    incoming.once("aborted", () => controller.abort());
    const init: RequestInit & { duplex?: "half" } = {
      method: incoming.method,
      headers,
      signal: controller.signal,
    };
    if (!upgrade && !["GET", "HEAD"].includes(incoming.method ?? "GET")) {
      init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      init.duplex = "half";
    }
    return gatewayFetch(new Request(requestUrl, init), {
      API: { fetch: options.fetchApi },
      ASSETS: { fetch: assets },
      CANONICAL_HOST: canonical,
      OFFICE_RUNTIME: {
        async get(key) {
          const found = await file(
            `/office/runtime/${key.replace(/^office-runtime\//, "")}`,
          );
          return found
            ? {
                body:
                  incoming.method === "HEAD"
                    ? new ReadableStream({
                        start(controller) {
                          controller.close();
                        },
                      })
                    : body(found.candidate),
                size: found.size,
              }
            : null;
        },
      },
    });
  };
  const send = async (
    incoming: IncomingMessage,
    response: ServerResponse,
    result: Response,
  ) => {
    response.statusCode = result.status;
    for (const [name, value] of result.headers) {
      if (
        [
          INTERNAL_UPGRADE,
          "set-cookie",
          "connection",
          "transfer-encoding",
        ].includes(name)
      )
        continue;
      response.setHeader(name, value);
    }
    const cookies = result.headers.getSetCookie();
    if (cookies.length) response.setHeader("set-cookie", cookies);
    if (!result.body || incoming.method === "HEAD") {
      await result.body?.cancel();
      response.end();
      return;
    }
    await pipeline(Readable.fromWeb(result.body as never), response);
  };
  const server = createServer((req, res) => {
    void dispatch(req)
      .then((result) => send(req, res, result))
      .catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Internal server error");
        } else res.destroy();
      });
  });
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {});
    void (async () => {
      if (
        new URL(req.url ?? "/", origin).pathname !== "/v1/realtime/subscribe"
      ) {
        socket.end(
          "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
        return;
      }
      const response = await dispatch(req, true);
      if (!options.realtime.handleUpgrade(req, socket, head, response)) {
        const status = response.status >= 400 ? response.status : 400;
        await response.body?.cancel();
        socket.end(
          `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        );
      }
    })().catch(() => socket.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    server,
    address: () => server.address(),
    close: () =>
      new Promise<void>((resolve, reject) => {
        options.realtime.close();
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}
