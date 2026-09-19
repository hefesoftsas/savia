import type { Hono, Context } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import { fail } from "../context";
import { WorkflowRepository } from "./repository";
import { workflowDraftSchema } from "@savia/crm-shared/workflows";
export type WorkflowAction =
  "view" | "design" | "publish" | "execute" | "history" | "resolve";
export type WorkflowOptions = {
  authorizeWorkflow?: (request: {
    workspace: string;
    principalId: string;
    action: WorkflowAction;
  }) => Promise<boolean>;
};
export const workflowRequests = {
  save: z
    .object({
      revision: z.number().int().positive(),
      ...workflowDraftSchema.shape,
    })
    .strict(),
  publish: z.object({ revision: z.number().int().positive() }).strict(),
  enabled: z.object({ enabled: z.boolean() }).strict(),
  start: z
    .object({
      data: z.record(z.string(), z.unknown()).default({}),
      key: z.string().min(1).max(150),
    })
    .strict(),
};
export function registerWorkflows(
  app: Hono<Env>,
  options: WorkflowOptions = {},
) {
  const repository = async (c: Context<Env>, action: WorkflowAction) => {
    const principalId = c.get("principalId"),
      workspace = c.get("tenant");
    if (
      !principalId ||
      !(await options.authorizeWorkflow?.({ workspace, principalId, action }))
    )
      fail("Workflow permission required", 403);
    return new WorkflowRepository(c.env.DB, workspace);
  };
  app.get("/api/workflows", async (c) =>
    c.json({ data: await (await repository(c, "view")).list() }),
  );
  app.post("/api/workflows", async (c) =>
    c.json(
      {
        data: await (
          await repository(c, "design")
        ).create(await c.req.json(), c.get("principalId")),
      },
      201,
    ),
  );
  app.get("/api/workflows/:id", async (c) =>
    c.json({
      data: await (await repository(c, "view")).get(c.req.param("id")),
    }),
  );
  app.put("/api/workflows/:id", async (c) => {
    const repo = await repository(c, "design"),
      body = workflowRequests.save.parse(await c.req.json());
    return c.json({
      data: await repo.save(c.req.param("id"), body.revision, {
        name: body.name,
        definition: body.definition,
      }),
    });
  });
  app.post("/api/workflows/:id/publish", async (c) => {
    const repo = await repository(c, "publish"),
      body = workflowRequests.publish.parse(await c.req.json());
    return c.json({
      data: await repo.publish(
        c.req.param("id"),
        body.revision,
        c.get("principalId"),
      ),
    });
  });
  app.post("/api/workflows/:id/enabled", async (c) => {
    const repo = await repository(c, "publish"),
      body = workflowRequests.enabled.parse(await c.req.json());
    return c.json({
      data: await repo.setEnabled(c.req.param("id"), body.enabled),
    });
  });
  app.post("/api/workflows/:id/start", async (c) => {
    const repo = await repository(c, "execute"),
      body = workflowRequests.start.parse(await c.req.json());
    return c.json(
      {
        data: await repo.start(
          c.req.param("id"),
          body.data,
          c.get("principalId"),
          body.key,
        ),
      },
      202,
    );
  });
  app.get("/api/workflows/:id/executions", async (c) =>
    c.json({
      data: await (
        await repository(c, "history")
      ).executions(c.req.param("id")),
    }),
  );
  app.get("/api/workflow-executions/:id", async (c) =>
    c.json({
      data: await (await repository(c, "history")).execution(c.req.param("id")),
    }),
  );
  app.post("/api/workflow-executions/:id/cancel", async (c) =>
    c.json({
      data: await (await repository(c, "execute")).cancel(c.req.param("id")),
    }),
  );
  app.post("/api/workflow-executions/:id/retry", async (c) =>
    c.json({
      data: await (await repository(c, "execute")).retry(c.req.param("id")),
    }),
  );
  app.get("/api/workflow-inbox", async (c) =>
    c.json({
      data: await (await repository(c, "resolve")).inbox(c.get("principalId")),
    }),
  );
  app.post("/api/workflow-inbox/:id/resolve", async (c) => {
    await (
      await repository(c, "resolve")
    ).resolveTask(c.req.param("id"), c.get("principalId"));
    return c.json({ data: { resolved: true } });
  });
}
