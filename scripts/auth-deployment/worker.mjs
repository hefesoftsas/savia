// Ephemeral authenticated deployment session; never published as a public Worker.
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/ready" && request.method === "GET")
      return Response.json({ nonce: env.PROBE_NONCE });
    if (path !== "/initialize" || request.method !== "POST")
      return new Response(null, { status: 405 });
    const credential = request.headers.get("x-savia-bridge-key");
    if (
      !credential ||
      !env.PROBE_NONCE ||
      request.headers.get("x-savia-probe-nonce") !== env.PROBE_NONCE
    )
      return new Response(null, { status: 403 });
    try {
      const response = await env.AUTH.fetch(
        new Request(
          "https://savia-auth.internal/_internal/deployment/initialize",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-savia-bridge-key": credential,
            },
            body: JSON.stringify({ revision: env.AUTH_REVISION }),
          },
        ),
      );
      if (!response.ok) throw new Error("Initialization rejected");
      const result = await response.json();
      if (result.status !== "ready" || result.revision !== env.AUTH_REVISION)
        throw new Error("Readiness mismatch");
      return Response.json({ status: "ready", revision: result.revision });
    } catch {
      return Response.json(
        { error: "Auth preparation failed" },
        { status: 502 },
      );
    }
  },
};
