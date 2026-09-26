import { createStudioApp } from "../../packages/studio-server/src/index";

/** Private, short-lived Wrangler session. Never publish as a public Worker. */
export async function deploymentTenants(db: D1Database): Promise<string[]> {
  const tenants = await db
    .prepare(
      `
    SELECT CASE
      WHEN EXISTS(SELECT 1 FROM studio_objects o WHERE o.tenant_id='tenant:'||t.id) THEN 'tenant:'||t.id
      WHEN EXISTS(SELECT 1 FROM studio_objects o WHERE o.tenant_id='agency:'||t.id)
        OR EXISTS(SELECT 1 FROM studio_solution_installations s WHERE s.tenant_id='agency:'||t.id) THEN 'agency:'||t.id
      ELSE 'tenant:'||t.id END AS scope FROM tenants t
    UNION SELECT 'domain:'||id AS scope FROM studio_data_domains
    UNION SELECT 'domain:platform' AS scope
    ORDER BY scope
  `,
    )
    .all<{ scope: string }>();
  return tenants.results.map((row) => row.scope);
}

export default {
  async fetch(
    request: Request,
    env: { DB: D1Database; DEPLOYMENT_SESSION: string },
  ) {
    if (
      !env.DEPLOYMENT_SESSION ||
      request.headers.get("authorization") !==
        `Bearer ${env.DEPLOYMENT_SESSION}`
    )
      return new Response("Unauthorized", { status: 401 });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return Response.json({ status: "ok" });
    const tenants = await deploymentTenants(env.DB);
    if (request.method === "GET" && url.pathname === "/tenants")
      return Response.json({ tenants });
    const tenant = url.searchParams.get("tenant");
    if (!tenant || !tenants.includes(tenant))
      return new Response("Unknown deployment workspace", { status: 404 });
    const studio = createStudioApp(tenant, { seedObjects: [] });
    if (request.method === "POST" && url.pathname === "/upload") {
      return studio.request(
        "https://deployment.internal/api/plugin-store/upload",
        {
          method: "POST",
          headers: {
            "content-type": request.headers.get("content-type") ?? "",
          },
          body: await request.arrayBuffer(),
        },
        env,
      );
    }
    if (request.method === "POST" && url.pathname === "/install") {
      const id = url.searchParams.get("id");
      if (!id) return new Response("Missing plugin id", { status: 400 });
      return studio.request(
        `https://deployment.internal/api/extensions/${encodeURIComponent(id)}/install`,
        { method: "POST" },
        env,
      );
    }
    return new Response("Not found", { status: 404 });
  },
};
