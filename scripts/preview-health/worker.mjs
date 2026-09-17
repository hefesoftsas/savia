// Ephemeral authenticated Wrangler session; never deploy this probe publicly.
export default {
  async fetch(request, env) {
    if (
      request.method !== "GET" ||
      new URL(request.url).pathname !== "/health"
    ) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const response = await env.PREVIEW.fetch(
        "https://savia-preview.hefesoft.com/health",
      );
      if (!response.ok) throw new Error("Unhealthy preview");
      const health = await response.json();
      if (health.status !== "ok" || health.database !== "ok")
        throw new Error("Unhealthy database");
      return Response.json({ status: "ok", database: "ok" });
    } catch {
      return new Response("Preview health verification failed", {
        status: 503,
      });
    }
  },
};
