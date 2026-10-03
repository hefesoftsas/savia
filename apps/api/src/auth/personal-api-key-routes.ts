import type { Context, Next } from "hono";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { isAllowedPublicOrigin } from "@savia/tenant-host/tenant-host";
import { actorFromContext, authenticationErrorResponse } from "./middleware";
import { AuthenticationError } from "./types";
import {
  PersonalApiKeys,
  createPersonalApiKeySchema,
  personalApiKeySummarySchema,
} from "./personal-api-keys";
export function registerPersonalApiKeyRoutes(
  app: OpenAPIHono,
  repo: PersonalApiKeys,
  publicOrigin: string,
): void {
  const path = "/v1/account/api-keys";
  const guard = async (c: Context, next: Next) => {
    c.header("Cache-Control", "no-store");
    try {
      if (actorFromContext(c).credential?.kind === "personal-api-key")
        throw new AuthenticationError(
          "INSUFFICIENT_SCOPE",
          "Sign in to manage personal API keys",
        );
      if (
        !["GET", "HEAD"].includes(c.req.method) &&
        !c.req.header("authorization")
      ) {
        const origin = c.req.header("origin");
        if (
          !origin ||
          !(
            origin === publicOrigin ||
            isAllowedPublicOrigin(origin, new URL(publicOrigin).hostname)
          )
        )
          throw new AuthenticationError(
            "AUTHORIZATION_FORBIDDEN",
            "A trusted origin is required",
          );
      }
      await next();
    } catch (error) {
      if (error instanceof AuthenticationError)
        return authenticationErrorResponse(error);
      throw error;
    }
  };
  app.use(path, guard);
  app.use(`${path}/*`, guard);
  app.openapi(
    createRoute({
      method: "get",
      path,
      tags: ["Personal API keys"],
      summary: "List your personal API key metadata",
      responses: {
        200: {
          description: "Metadata without secrets",
          content: {
            "application/json": {
              schema: z.object({ keys: z.array(personalApiKeySummarySchema) }),
            },
          },
        },
      },
    }),
    async (c) =>
      c.json({ keys: await repo.list(actorFromContext(c).principal.id) }, 200),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: `${path}/tenants`,
      tags: ["Personal API keys"],
      summary: "List eligible tenants for personal keys",
      responses: {
        200: {
          description: "Eligible active memberships",
          content: {
            "application/json": {
              schema: z.object({
                tenants: z.array(
                  z.object({ id: z.number(), name: z.string() }),
                ),
              }),
            },
          },
        },
      },
    }),
    async (c) =>
      c.json(
        {
          tenants: await repo.eligibleTenants(actorFromContext(c).principal.id),
        },
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path,
      tags: ["Personal API keys"],
      summary: "Create a scoped personal key; reveal its secret once",
      request: {
        body: {
          required: true,
          content: {
            "application/json": { schema: createPersonalApiKeySchema },
          },
        },
      },
      responses: {
        201: {
          description: "One-time credential",
          content: {
            "application/json": {
              schema: z.object({
                key: personalApiKeySummarySchema,
                secret: z.string(),
              }),
            },
          },
        },
      },
    }),
    async (c) =>
      c.json(await repo.create(actorFromContext(c), c.req.valid("json")), 201),
  );
  app.openapi(
    createRoute({
      method: "delete",
      path: `${path}/{id}`,
      tags: ["Personal API keys"],
      summary: "Revoke your personal key",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 204: { description: "Revoked or already absent" } },
    }),
    async (c) => {
      await repo.revoke(
        actorFromContext(c).principal.id,
        c.req.valid("param").id,
      );
      return c.body(null, 204);
    },
  );
}
