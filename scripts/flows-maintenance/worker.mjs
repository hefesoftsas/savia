const MAINTENANCE_URL =
  "https://savia-preview.hefesoft.com/api/public/savia-flows/maintenance";
const MAINTENANCE_PATH = "/api/public/savia-flows/maintenance";
const HEALTH_PATH = "/__session/health";
const MAX_REQUEST_BYTES = 64 * 1024;

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

async function boundedBody(request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new Error("Request body is too large");
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("Request body is too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      typeof env.SESSION_TOKEN !== "string" ||
      env.SESSION_TOKEN.length < 40 ||
      request.headers.get("authorization") !== `Bearer ${env.SESSION_TOKEN}`
    ) {
      return unauthorized();
    }
    if (
      request.method === "GET" &&
      url.pathname === HEALTH_PATH &&
      !url.search
    ) {
      return Response.json({ ready: true });
    }
    if (
      request.method !== "POST" ||
      url.pathname !== MAINTENANCE_PATH ||
      url.search !== ""
    ) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers(request.headers);
    headers.delete("authorization");
    try {
      return await env.SAVIA_HOST.fetch(
        new Request(MAINTENANCE_URL, {
          method: "POST",
          headers,
          body: await boundedBody(request),
        }),
      );
    } catch {
      return new Response("Preview maintenance forwarding failed", {
        status: 503,
      });
    }
  },
};
