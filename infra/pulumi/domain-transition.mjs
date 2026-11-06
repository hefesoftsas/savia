import { normalizeTenantSlug } from "../../packages/tenant-host/src/tenant-slug.mjs";

const pendingHost = "savia.hefesoft.com";
const activeHost = "savia.app.hefesoft.com";

export function transitionResponse(request) {
  const url = new URL(request.url);
  let destinationHost = activeHost;
  if (url.hostname !== pendingHost) {
    const suffix = `.${pendingHost}`;
    if (!url.hostname.endsWith(suffix))
      return new Response("Not found", { status: 404 });
    const slug = normalizeTenantSlug(url.hostname.slice(0, -suffix.length));
    if (!slug) return new Response("Not found", { status: 404 });
    destinationHost = `${slug}.${activeHost}`;
  }
  if (
    ["GET", "HEAD"].includes(request.method) &&
    ["/sw.js", "/dev-sw.js"].includes(url.pathname)
  ) {
    // Retire only this temporary origin's old app shell. Keep caches and user data.
    const destination = JSON.stringify(
      `https://${destinationHost}/api/auth/admin/authorize`,
    );
    const script = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil((async () => {
  await self.clients.claim();
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({type: "window"})) {
    if (new URL(client.url).pathname === "/") await client.navigate(${destination});
  }
})()));`;
    return new Response(request.method === "HEAD" ? null : script, {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "service-worker-allowed": "/",
      },
    });
  }
  if (!["GET", "HEAD"].includes(request.method))
    return Response.json(
      {
        error: {
          code: "DOMAIN_MIGRATION_PENDING",
          message: "Use the active Savia origin until migration completes.",
        },
      },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  const target = new URL(`https://${destinationHost}/api/auth/admin/authorize`);
  if (
    url.pathname !== "/" &&
    !url.pathname.startsWith("/api/auth/") &&
    url.pathname !== "/api/auth" &&
    url.pathname !== "/auth/callback"
  ) {
    target.pathname = url.pathname;
    target.search = url.search;
  }
  return new Response(null, {
    status: 307,
    headers: {
      location: target.toString(),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
export default { fetch: transitionResponse };
