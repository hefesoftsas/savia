import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { actorFromContext } from "../auth/middleware";
import type { AppActor } from "../auth/types";
import { publicQuoteReportSchema } from "@savia/studio-shared/public-quote";
import {
  listQuoteLinks,
  readPublicQuoteReport,
  revokeQuoteLink,
} from "./service";

export type PublicQuoteRoutesOptions = {
  rateLimiter?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
  publicOrigin?: string;
};

const tenantIdParam = z.object({
  tenantId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const linkIdParam = tenantIdParam.extend({ id: z.string().uuid() });
const tokenParam = z.object({ token: z.string().max(256) });
const publicResult = z.object({
  report: publicQuoteReportSchema,
  expiresAt: z.string().datetime(),
});
const linkSchema = z.object({
  id: z.string().uuid(),
  quoteId: z.string(),
  url: z.string().url(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});
const responseSchema = z.object({ items: z.array(linkSchema) });
const errorSchema = z.object({ error: z.string() });

function isPlatformAdministrator(actor: AppActor): boolean {
  return actor.globalRoles.includes("platform_admin");
}

async function requireTenantAdministrator(
  db: D1Database,
  actor: AppActor,
  tenantId: number,
): Promise<void> {
  const allowed =
    actor.principal.isActive &&
    (isPlatformAdministrator(actor) ||
      actor.memberships.some(
        (membership) =>
          membership.isActive &&
          (membership.tenantId ?? membership.agencyId) === tenantId &&
          ["tenant_admin", "agency_admin"].includes(membership.role),
      ));
  if (!allowed)
    throw new HTTPException(403, {
      message: "Tenant administration is required.",
    });
  const tenant = await db
    .prepare(
      "SELECT id FROM tenants WHERE id=? AND kind='commercial' AND is_active=1",
    )
    .bind(tenantId)
    .first();
  if (!tenant) throw new HTTPException(404, { message: "Tenant not found." });
}

function authenticatedActor(
  context: Parameters<typeof actorFromContext>[0],
): AppActor {
  try {
    return actorFromContext(context);
  } catch {
    throw new HTTPException(401, { message: "Authentication is required." });
  }
}

export function registerPublicQuoteRoutes(
  app: OpenAPIHono,
  db: D1Database,
  options: PublicQuoteRoutesOptions = {},
): void {
  app.use("/api/public/quotes/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
    if (c.req.method !== "GET")
      return c.json({ error: "Method not allowed" }, 405);
    if (options.rateLimiter) {
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(ip),
      );
      const key = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (!(await options.rateLimiter.limit({ key })).success)
        return c.json({ error: "Too many requests" }, 429);
    }
    await next();
  });

  app.use("/api/tenants/*/quote-links", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  app.use("/api/tenants/*/quote-links/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/public/quotes/{token}",
      tags: ["Public quotes"],
      summary: "Read a shared quote comparison",
      security: [],
      request: { params: tokenParam },
      responses: {
        200: {
          description: "Shared quote report",
          content: { "application/json": { schema: publicResult } },
        },
        404: {
          description: "Quote report not found",
          content: { "application/json": { schema: errorSchema } },
        },
        429: {
          description: "Rate limit exceeded",
          content: { "application/json": { schema: errorSchema } },
        },
      },
    }),
    async (c) => {
      const { token } = c.req.valid("param");
      const result = await readPublicQuoteReport(db, token);
      if (!result) return c.json({ error: "Quote report not found" }, 404);
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/tenants/{tenantId}/quote-links",
      tags: ["Tenant quotes"],
      summary: "List shared quote links for a tenant",
      security: [{ oauth2: ["savia.api.read"] }],
      request: {
        params: tenantIdParam,
        query: z.object({ quoteId: z.string().min(1).max(200).optional() }),
      },
      responses: {
        200: {
          description: "Quote links",
          content: { "application/json": { schema: responseSchema } },
        },
        403: { description: "Tenant administration is required" },
        404: { description: "Tenant not found" },
      },
    }),
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const { quoteId } = c.req.valid("query");
      await requireTenantAdministrator(db, authenticatedActor(c), tenantId);
      const origin = options.publicOrigin ?? new URL(c.req.url).origin;
      return c.json(
        { items: await listQuoteLinks(db, tenantId, origin, quoteId) },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/tenants/{tenantId}/quote-links/{id}",
      tags: ["Tenant quotes"],
      summary: "Revoke a shared quote link",
      security: [{ oauth2: ["savia.api.write"] }],
      request: { params: linkIdParam },
      responses: {
        204: { description: "Quote link revoked" },
        403: { description: "Tenant administration is required" },
        404: { description: "Quote link not found" },
      },
    }),
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      await requireTenantAdministrator(db, authenticatedActor(c), tenantId);
      if (!(await revokeQuoteLink(db, tenantId, id)))
        throw new HTTPException(404, { message: "Quote link not found." });
      return c.body(null, 204);
    },
  );
}
