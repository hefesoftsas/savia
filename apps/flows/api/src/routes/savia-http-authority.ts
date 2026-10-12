import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { jwtMiddleware } from "../auth";
import type { ApiContext } from "../context";
import {
  createDatabase,
  saviaHttpExecutionAuthorities,
  workflows,
} from "../db";
import { getAuthContext } from "../utils/auth-context";

export const saviaHttpAuthorityRoutes = new Hono<ApiContext>();

saviaHttpAuthorityRoutes.get(
  "/:workflowId/savia-http-authority",
  jwtMiddleware,
  async (c) => {
    const { organizationId, userId, isApiKey } = getAuthContext(c);
    if (isApiKey) return c.json({ error: "A user session is required" }, 403);

    const workflowId = c.req.param("workflowId") ?? "";
    const db = createDatabase(c.env.DB);
    const [workflow] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(
        and(
          eq(workflows.id, workflowId),
          eq(workflows.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!workflow) return c.json({ error: "Workflow not found" }, 404);

    const [authority] = await db
      .select({
        organizationId: saviaHttpExecutionAuthorities.organizationId,
        principalId: saviaHttpExecutionAuthorities.principalId,
        active: saviaHttpExecutionAuthorities.active,
      })
      .from(saviaHttpExecutionAuthorities)
      .where(eq(saviaHttpExecutionAuthorities.workflowId, workflowId))
      .limit(1);
    const ownedAuthority =
      authority?.organizationId === organizationId ? authority : undefined;
    return c.json({
      configured: Boolean(ownedAuthority),
      active: Boolean(ownedAuthority?.active),
      ...(ownedAuthority?.principalId === userId
        ? { configuredBy: "you" as const }
        : {}),
    });
  },
);
