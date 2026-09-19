import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, it, expect } from "vitest";
import { registerWorkflowWebhookRoutes } from "../src/workflow-webhooks";
import { WorkflowRepository } from "@savia/crm-server/workflows/repository";
import { WebhookEndpointRepository } from "@savia/crm-server/workflows/webhook-endpoints";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);
beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((v) =>
        v
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});
it("accepts a secret-authenticated event without a session and documents the route", async () => {
  const repo = new WorkflowRepository(env.DB, "domain:hooks");
  const flow = await repo.create(
    {
      name: "Hook",
      definition: {
        trigger: { type: "webhook" },
        nodes: [{ id: "data", type: "transform", values: {} }],
      },
    },
    "owner",
  );
  await repo.publish(flow.id, flow.revision, "owner");
  const endpoint = await new WebhookEndpointRepository(
    env.DB,
    "domain:hooks",
  ).ensure(flow.id);
  const app = new OpenAPIHono();
  registerWorkflowWebhookRoutes(app, env.DB, { authorize: async () => true });
  const path = `/api/public/workflow-webhooks/${endpoint.id}`;
  const req = () =>
    app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${endpoint.secret}`,
        "idempotency-key": "test",
      },
      body: '{"x":1}',
    });
  const first = await req();
  expect(first.status).toBe(202);
  expect(first.headers.get("cache-control")).toBe("no-store");
  expect((await (await req()).json()).data.duplicate).toBe(true);
  expect(
    (
      await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).status,
  ).toBe(404);
  expect(
    app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "Test", version: "1" },
    }).paths,
  ).toHaveProperty("/api/public/workflow-webhooks/{endpointId}");
  const document = app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "Test", version: "1" },
  });
  expect(
    document.paths?.["/api/public/workflow-webhooks/{endpointId}"].post
      ?.requestBody,
  ).toMatchObject({
    required: true,
    content: { "application/json": { schema: { type: "object" } } },
  });
});
