import { Hono } from "hono";
import { jwtMiddleware } from "../auth";
import type { ApiContext } from "../context";
import { callSaviaCollections } from "../nodes/savia/collection-client";
import { getAuthContext } from "../utils/auth-context";

export const saviaCollectionsRoutes = new Hono<ApiContext>();

saviaCollectionsRoutes.get("/", jwtMiddleware, async (c) => {
  const { organizationId, userId, isApiKey } = getAuthContext(c);
  if (isApiKey) return c.json({ error: "A user session is required" }, 403);
  try {
    return c.json(
      await callSaviaCollections(
        c.env,
        { action: "catalog" },
        {
          principalId: userId,
          tenant: organizationId,
        },
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Savia collection catalogue unavailable";
    return c.json({ error: message }, 503);
  }
});
