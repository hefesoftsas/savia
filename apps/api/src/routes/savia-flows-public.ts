import type { OpenAPIHono } from "@hono/zod-openapi";
import { jwtVerify } from "jose";
import { bodyLimit } from "hono/body-limit";
import { streamingRequest } from "../lib/streaming-request";
import type { SaviaFlowsOptions } from "./savia-flows";

const INTERNAL_ORIGIN = "https://savia-flows.internal";
const PUBLIC_PREFIX = "/api/public/savia-flows/";
const MAX_PUBLIC_BODY_BYTES = 32 * 1024 * 1024;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._~-]{1,2048}$/;
const CAPABILITIES = new Set([
  "http",
  "queues",
  "forms",
  "form-triggers",
  "feedback-forms",
]);

function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json({ error: { code, message } }, { status });
}

function parseCapabilityPath(pathname: string) {
  if (!pathname.startsWith(PUBLIC_PREFIX)) return null;
  const segments = pathname.slice(PUBLIC_PREFIX.length).split("/");
  if (segments.length !== 2) return null;
  const [capability, encodedId] = segments;
  if (!CAPABILITIES.has(capability!)) return null;
  let id: string;
  try {
    id = decodeURIComponent(encodedId!);
  } catch {
    return { malformed: true as const };
  }
  if (
    id.includes("/") ||
    id.includes("\\") ||
    id === "." ||
    id === ".." ||
    !IDENTIFIER_PATTERN.test(id)
  )
    return { malformed: true as const };
  return { capability: capability!, id };
}

function allowedMethods(capability: string): ReadonlySet<string> {
  if (capability === "queues") return new Set(["POST"]);
  return new Set(["GET", "POST"]);
}

function upstreamHeaders(source: Headers, capability: string): Headers {
  const headers = new Headers();
  for (const name of ["accept", "content-type"]) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (capability === "http" || capability === "queues") {
    const authorization = source.get("authorization");
    if (authorization !== null) headers.set("authorization", authorization);
  }
  return headers;
}

export function registerSaviaFlowsPublicRoutes(
  app: OpenAPIHono,
  options: SaviaFlowsOptions = {},
) {
  app.post(
    "/api/public/savia-flows/maintenance",
    bodyLimit({ maxSize: 8192 }),
    async (c) => {
      const secret = options.bridgeSecret;
      const token = c.req.header("x-savia-flows-maintenance");
      if (!options.service || !secret || secret.length < 32)
        return errorResponse(
          "SAVIA_FLOWS_UNAVAILABLE",
          "Flows maintenance is unavailable.",
          503,
        );
      try {
        await jwtVerify(token ?? "", new TextEncoder().encode(secret), {
          issuer: "savia",
          audience: "savia-flows-maintenance",
          algorithms: ["HS256"],
          maxTokenAge: "60s",
        });
      } catch {
        return errorResponse(
          "AUTHORIZATION_FORBIDDEN",
          "Maintenance authorization required.",
          401,
        );
      }
      return options.service.fetch(
        new Request(new URL("/internal/savia/maintenance", INTERNAL_ORIGIN), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-savia-flows-maintenance": token!,
          },
          body: c.req.raw.body,
          duplex: "half",
        } as RequestInit),
      );
    },
  );

  app.use(
    "/api/public/savia-flows/*",
    bodyLimit({ maxSize: MAX_PUBLIC_BODY_BYTES }),
  );
  app.all("/api/public/savia-flows/*", async (c) => {
    const parsed = parseCapabilityPath(new URL(c.req.url).pathname);
    if (!parsed)
      return errorResponse("NOT_FOUND", "Public capability not found.", 404);
    if ("malformed" in parsed)
      return errorResponse(
        "INVALID_CAPABILITY",
        "Invalid public capability identifier.",
        400,
      );
    if (!allowedMethods(parsed.capability).has(c.req.method))
      return errorResponse(
        "METHOD_NOT_ALLOWED",
        "Method not allowed for this capability.",
        405,
      );
    if (!options.service)
      return errorResponse(
        "SAVIA_FLOWS_UNAVAILABLE",
        "Savia Flows is not available.",
        503,
      );

    const suffix = parsed.capability === "queues" ? "/publish" : "";
    const target = new URL(
      `/${parsed.capability}/${encodeURIComponent(parsed.id)}${suffix}`,
      INTERNAL_ORIGIN,
    );
    target.search = new URL(c.req.url).search;
    const body = c.req.method === "GET" ? undefined : c.req.raw.body;
    const upstream = await options.service.fetch(
      streamingRequest(target, {
        method: c.req.method,
        headers: upstreamHeaders(c.req.raw.headers, parsed.capability),
        body,
        redirect: "manual",
      }),
    );
    if (upstream.webSocket) return upstream;
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("set-cookie");
    responseHeaders.set("cache-control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  });
}
