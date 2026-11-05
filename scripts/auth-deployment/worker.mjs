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
    let response;
    try {
      response = await env.AUTH.fetch(
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
    } catch {
      return Response.json({ error: "TRANSPORT_FAILED" }, { status: 502 });
    }
    const fail = (error) =>
      Response.json(
        { error, upstreamStatus: response.status },
        { status: 502 },
      );
    if (!response.ok) {
      const error =
        response.status === 403
          ? "AUTH_BRIDGE_REJECTED"
          : response.status === 409
            ? "REVISION_MISMATCH"
            : response.status === 503
              ? "INITIALIZATION_FAILED"
              : "UPSTREAM_REJECTED";
      return fail(error);
    }
    try {
      const result = await response.json();
      if (result.status !== "ready" || result.revision !== env.AUTH_REVISION)
        return fail("READINESS_MISMATCH");
      return Response.json({ status: "ready", revision: result.revision });
    } catch {
      return fail("INITIALIZATION_FAILED");
    }
  },
};
