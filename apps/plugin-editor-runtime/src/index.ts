type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };
const policy = [
  "default-src 'none'",
  "script-src 'self' blob: 'unsafe-inline' 'unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' blob:",
  "frame-src 'self' blob:",
  "frame-ancestors 'self' https://*.savia-preview.hefesoft.com https://savia-preview.hefesoft.com https://*.savia.hefesoft.com https://savia.hefesoft.com https://*.savia.app.hefesoft.com https://savia.app.hefesoft.com http://localhost:* http://127.0.0.1:*",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (
      !["GET", "HEAD"].includes(request.method) ||
      !(
        /^\/assets\//.test(url.pathname) ||
        /^\/plugin-editor(?:\.html)?$/.test(url.pathname)
      )
    )
      return new Response("Not found", { status: 404 });
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", policy);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=()",
    );
    headers.delete("Set-Cookie");
    if (
      response.ok &&
      /^\/assets\/webWorkerExtensionHostIframe-[\w-]+(?:\.html)?$/.test(
        url.pathname,
      )
    ) {
      // The upstream bootstrap meta policy does not allow blob package resources.
      // This trusted build asset uses the stricter response policy above instead.
      const html = (await response.text()).replace(
        /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i,
        "",
      );
      headers.delete("Content-Length");
      headers.delete("ETag");
      return new Response(html, { status: response.status, headers });
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
