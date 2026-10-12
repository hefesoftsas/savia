/** Synthetic local identity for browser verification; never a production entrypoint. */
import { OpenAPIHono } from "@hono/zod-openapi";
import { registerSaviaFlowsRoutes } from "../../api/src/routes/savia-flows";
import { registerSaviaFlowsPublicRoutes } from "../../api/src/routes/savia-flows-public";
import { registerSaviaCollectionHostRoutes } from "../../api/src/savia-flows/collection-host";
import {
  installSaviaCollectionEventDelivery,
  dispatchSaviaCollectionEvents,
} from "../../api/src/savia-flows/event-dispatch";
import { registerStudioRoutes } from "../../api/src/routes/studio";
import { registerSaviaNativeHostRoutes } from "../../api/src/savia-flows/native-host";
import { runScheduledWorkflows } from "../../api/src/workflows";
import { registerWorkflowWebhookRoutes } from "../../api/src/workflow-webhooks";

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/_fixture/")) {
      if (
        request.headers.get("authorization") !==
        "Bearer " + env.FIXTURE_SECRET
      )
        return new Response("Unauthorized", { status: 401 });
      if (path === "/_fixture/revoke") {
        await env.DB.prepare(
          "UPDATE identity_tenant_membership SET role='viewer' WHERE principal_id='browser-verification'",
        ).run();
        return new Response("Revoked");
      }
      if (path === "/_fixture/second-manager") {
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES('second-webhook-manager','savia:local-fixture','second-webhook-manager','second@savia.local','Second local manager',1,'2026-10-12','2026-10-12')",
          ),
          env.DB.prepare(
            "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES('second-webhook-membership','second-webhook-manager',101,'tenant_admin',1,'2026-10-12','2026-10-12')",
          ),
        ]);
        return new Response("Created");
      }
      if (path === "/_fixture/native-tick") {
        await runScheduledWorkflows(env.DB, undefined, async () =>
          Response.json(
            { error: "External services are disabled in the local fixture" },
            { status: 503 },
          ),
        );
        return Response.json({ processed: true });
      }
      if (path === "/_fixture/native-state")
        return Response.json(
          (
            await env.DB.prepare(
              "SELECT id,workflow_id,status,depth,node_id FROM workflow_executions ORDER BY created_at,id",
            ).all()
          ).results,
        );
      if (path === "/_fixture/drain")
        return Response.json(
          await dispatchSaviaCollectionEvents(env.DB, {
            service: env.SAVIA_FLOWS,
            bridgeSecret: env.SAVIA_FLOWS_BRIDGE_SECRET,
          }),
        );
      if (path === "/_fixture/events")
        return Response.json(
          (
            await env.DB.prepare(
              "SELECT * FROM savia_flows_collection_event_outbox ORDER BY created_at,id",
            ).all()
          ).results,
        );
      if (path !== "/_fixture/bootstrap")
        return new Response("Not found", { status: 404 });
      const { migrations } = (await request.json()) as {
        migrations: { name: string; statements: string[] }[];
      };
      await env.DB.exec(
        "CREATE TABLE IF NOT EXISTS fixture_migrations(name TEXT PRIMARY KEY)",
      );
      for (const migration of migrations) {
        if (
          await env.DB.prepare(
            "SELECT name FROM fixture_migrations WHERE name=?",
          )
            .bind(migration.name)
            .first()
        )
          continue;
        await env.DB.batch([
          ...migration.statements.map((sql) => env.DB.prepare(sql)),
          env.DB.prepare("INSERT INTO fixture_migrations VALUES(?)").bind(
            migration.name,
          ),
        ]);
      }
      await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(101,'browser-fixture','Browser verification','commercial',1,'2026-10-12','2026-10-12')",
        ),
        env.DB.prepare(
          "INSERT OR IGNORE INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES('browser-verification','savia:local-fixture','browser-verification','browser@savia.local','Browser verification',1,'2026-10-12','2026-10-12')",
        ),
        env.DB.prepare(
          "INSERT OR IGNORE INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES('browser-membership','browser-verification',101,'tenant_admin',1,'2026-10-12','2026-10-12')",
        ),
        ...["flow_requests", "flow_results"].map((name) =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO studio_objects(tenant_id,name,label,config) VALUES('tenant:101',?,?,?)",
          ).bind(
            name,
            name === "flow_requests" ? "Requests" : "Results",
            JSON.stringify({
              fields: {
                title: { type: "Textbox", label: "Title", required: true },
                status: { type: "Textbox", label: "Status" },
                count: { type: "Number", label: "Count" },
              },
              fieldOrder: ["title", "status", "count"],
            }),
          ),
        ),
      ]);
      return new Response("Ready");
    }
    if (!path.startsWith("/v1/") && !path.startsWith("/api/public/"))
      return env.ASSETS.fetch(request);
    const app = new OpenAPIHono();
    app.onError((error, c) =>
      c.json(
        { error: { message: error.message } },
        ((error as { status?: number }).status ?? 500) as any,
      ),
    );
    const options = {
      service: env.SAVIA_FLOWS,
      bridgeSecret: env.SAVIA_FLOWS_BRIDGE_SECRET,
    };
    installSaviaCollectionEventDelivery(app as any, env.DB, options);
    app.use("*", async (c, next) => {
      c.set(
        "actor" as never,
        {
          principal: {
            id: "browser-verification",
            issuer: "savia:local-fixture",
            subject: "browser-verification",
            email: "browser@savia.local",
            displayName: "Browser verification",
            isActive: true,
          },
          globalRoles: [],
          memberships: [
            {
              principalId: "browser-verification",
              tenantId: 101,
              tenantName: "Browser verification",
              role: "tenant_admin",
              isActive: true,
            },
          ],
        } as never,
      );
      await next();
    });
    registerSaviaFlowsRoutes(app as any, {
      service: env.SAVIA_FLOWS,
      bridgeSecret: env.SAVIA_FLOWS_BRIDGE_SECRET,
    });
    registerSaviaCollectionHostRoutes(app as any, env.DB, options);
    registerSaviaNativeHostRoutes(app as any, {
      db: env.DB,
      secret: options.bridgeSecret,
      files: env.FILES,
    });
    registerWorkflowWebhookRoutes(app as any, env.DB);
    registerStudioRoutes(app as any, env.DB, env.FILES);
    registerSaviaFlowsPublicRoutes(app as any, {
      service: env.SAVIA_FLOWS,
      bridgeSecret: env.SAVIA_FLOWS_BRIDGE_SECRET,
    });
    return app.fetch(request, env, ctx);
  },
};
