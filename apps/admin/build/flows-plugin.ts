import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const root = fileURLToPath(new URL("../../flows/app", import.meta.url));
const distribution = resolve(root, "dist");
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

function flowsCsp(request: import("node:http").IncomingMessage): string {
  const forwardedProtocol = request.headers["x-forwarded-proto"]
    ?.toString()
    .split(",", 1)[0]
    .trim()
    .toLowerCase();
  const secure =
    forwardedProtocol === "https" ||
    ("encrypted" in request.socket && Boolean(request.socket.encrypted));
  const websocket = secure ? "wss:" : "ws:";
  const host = request.headers.host ?? "localhost";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    `connect-src 'self' ${websocket}//${host}`,
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
  ].join("; ");
}

function buildFlows(): Promise<void> {
  return new Promise((fulfill, reject) => {
    const child = spawn("pnpm", ["exec", "vite", "build"], {
      cwd: root,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? fulfill()
        : reject(new Error("Savia Flows frontend build failed")),
    );
  });
}

/** Isolate the embedded editor's router/CSS while serving it from Savia's origin. */
export function flowsPlugin(): Plugin {
  let mode: "build" | "serve";
  return {
    name: "savia-flows-assets",
    configResolved(config) {
      mode = config.command;
    },
    async buildStart() {
      if (mode === "build") await buildFlows();
    },
    configureServer(server) {
      server.middlewares.use("/flows-ui", async (request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD")
          return next();
        let path: string;
        try {
          path = decodeURIComponent(
            new URL(request.url ?? "/", "http://local.invalid").pathname,
          );
        } catch {
          response.statusCode = 400;
          response.end("Invalid path");
          return;
        }
        if (path.includes("\\") || path.split("/").includes("..")) {
          response.statusCode = 400;
          response.end("Invalid path");
          return;
        }
        const candidate = resolve(distribution, "." + path);
        if (
          !candidate.startsWith(distribution + sep) &&
          candidate !== distribution
        )
          return next();
        let file = candidate;
        try {
          if (!(await stat(file)).isFile())
            file = resolve(distribution, "index.html");
        } catch {
          file = resolve(distribution, "index.html");
        }
        try {
          await stat(file);
          response.setHeader(
            "content-type",
            mime[extname(file)] ?? "application/octet-stream",
          );
          response.setHeader("cache-control", "no-store");
          response.setHeader("content-security-policy", flowsCsp(request));
          response.setHeader("x-content-type-options", "nosniff");
          response.setHeader(
            "referrer-policy",
            "strict-origin-when-cross-origin",
          );
          if (request.method === "HEAD") response.end();
          else createReadStream(file).pipe(response);
        } catch {
          response.statusCode = 503;
          response.setHeader("content-type", "text/plain; charset=utf-8");
          response.end(
            "Savia Flows assets are not built. Run pnpm flows:build first.",
          );
        }
      });
    },
    async generateBundle() {
      async function collect(
        directory: string,
        prefix = "",
      ): Promise<Array<{ fileName: string; source: Buffer }>> {
        const entries = await readdir(directory, { withFileTypes: true });
        const output: Array<{ fileName: string; source: Buffer }> = [];
        for (const entry of entries) {
          const name = prefix + entry.name;
          if (entry.isDirectory())
            output.push(
              ...(await collect(resolve(directory, entry.name), name + "/")),
            );
          else
            output.push({
              fileName: "flows-ui/" + name,
              source: await readFile(resolve(directory, entry.name)),
            });
        }
        return output;
      }
      for (const asset of await collect(distribution))
        this.emitFile({ type: "asset", ...asset });
    },
  };
}
