import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import {
  createPublicPageLink,
  createPublicPageShortUrl,
  getPublicPage,
  getPublicPageFile,
  listPublicPageLinks,
  publicPageTokenForShortCode,
  revokePublicPageLink,
} from "./public-sharing";
import { PagesError } from "./service";

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const linkSchema = z.object({
  id: z.string(),
  path: z.string(),
  shortUrl: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
const pageSchema = z.object({
  root: z.object({ id: z.string(), title: z.string() }),
  page: z.object({
    id: z.string(),
    title: z.string(),
    kind: z.enum(["page", "folder"]),
    content: z.array(z.unknown()),
    updatedAt: z.string(),
  }),
  children: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kind: z.enum(["page", "folder"]),
    }),
  ),
  breadcrumbs: z.array(z.object({ id: z.string(), title: z.string() })),
});
const response = (schema: z.ZodType, description: string) => ({
  200: {
    description,
    content: { "application/json": { schema: z.object({ data: schema }) } },
  },
  400: {
    description: "Invalid request",
    content: { "application/json": { schema: errorSchema } },
  },
  404: {
    description: "Page or link unavailable",
    content: { "application/json": { schema: errorSchema } },
  },
});
const readSecurity = [{ oauth2: ["savia.api.read"] }];
const writeSecurity = [{ oauth2: ["savia.api.write"] }];
function routeError(error: unknown) {
  if (error instanceof PagesError && error.status === 400)
    return {
      status: 400 as const,
      body: { error: { code: error.code, message: error.message } },
    };
  if (error instanceof PagesError)
    return {
      status: 404 as const,
      body: { error: { code: error.code, message: error.message } },
    };
  return {
    status: 404 as const,
    body: { error: { code: "PAGE_NOT_FOUND", message: "Page not found" } },
  };
}

export type PublicPagesOptions = {
  publicOrigin?: string;
  shortener?: { shorten(destination: string): Promise<string> };
  rateLimiter?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
};

export function registerPublicPagesRoutes(
  app: OpenAPIHono,
  db: D1Database,
  documents?: R2Bucket,
  options: PublicPagesOptions = {},
) {
  app.use("/api/public/pages/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    if (c.req.method !== "GET")
      return c.json({ error: "Method not allowed" }, 405);
    if (options.rateLimiter) {
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(ip),
      );
      const key = Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (!(await options.rateLimiter.limit({ key })).success)
        return c.json({ error: "Too many requests" }, 429);
    }
    await next();
  });

  app.use("/s/p/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    if (c.req.method !== "GET")
      return c.json({ error: "Method not allowed" }, 405);
    if (options.rateLimiter) {
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(ip),
      );
      const key = Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (!(await options.rateLimiter.limit({ key })).success)
        return c.json({ error: "Too many requests" }, 429);
    }
    await next();
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/pages/{id}/public-links",
      tags: ["Pages"],
      security: readSecurity,
      request: { params: z.object({ id: z.string().min(1).max(128) }) },
      responses: response(
        z.array(linkSchema),
        "Public links for an owned page",
      ),
    }),
    async (c) => {
      try {
        return c.json(
          {
            data: await listPublicPageLinks(
              db,
              actorFromContext(c),
              c.req.valid("param").id,
            ),
          },
          200,
        );
      } catch (error) {
        const result = routeError(error);
        return c.json(result.body, result.status);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/pages/{id}/public-links/{linkId}/short-url",
      tags: ["Pages"],
      security: writeSecurity,
      request: {
        params: z.object({
          id: z.string().min(1).max(128),
          linkId: z.string().uuid(),
        }),
      },
      responses: {
        200: {
          description: "Reusable short URL for an active public page link",
          content: {
            "application/json": {
              schema: z.object({ data: z.object({ shortUrl: z.string() }) }),
            },
          },
        },
        404: {
          description: "Page or link unavailable",
          content: { "application/json": { schema: errorSchema } },
        },
        400: {
          description: "Invalid request",
          content: { "application/json": { schema: errorSchema } },
        },
      },
    }),
    async (c) => {
      try {
        const { id, linkId } = c.req.valid("param");
        const shortUrl = await createPublicPageShortUrl(
          db,
          actorFromContext(c),
          id,
          linkId,
          {
            publicOrigin: options.publicOrigin,
            requestUrl: c.req.url,
            shortener: options.shortener,
          },
        );
        return c.json({ data: { shortUrl } }, 200);
      } catch (error) {
        const result = routeError(error);
        return c.json(result.body, result.status);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/s/p/{code}",
      security: [],
      tags: ["Public pages"],
      request: { params: z.object({ code: z.string() }) },
      responses: { 302: { description: "Redirect to the public page" } },
    }),
    async (c) => {
      try {
        const token = await publicPageTokenForShortCode(
          db,
          c.req.valid("param").code,
        );
        const destination = new URL(
          `/public/pages/${token}`,
          options.publicOrigin ?? c.req.url,
        );
        return c.redirect(destination.href, 302);
      } catch {
        return c.json({ error: "Page not found" }, 404);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/pages/{id}/public-links",
      tags: ["Pages"],
      security: writeSecurity,
      request: {
        params: z.object({ id: z.string().min(1).max(128) }),
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z
                .object({
                  expiresAt: z
                    .string()
                    .datetime({ offset: true })
                    .nullable()
                    .optional(),
                })
                .strict(),
            },
          },
        },
      },
      responses: {
        ...response(linkSchema, "Created public page link"),
        201: {
          description: "Created public page link",
          content: {
            "application/json": { schema: z.object({ data: linkSchema }) },
          },
        },
      },
    }),
    async (c) => {
      try {
        const result = await createPublicPageLink(
          db,
          actorFromContext(c),
          c.req.valid("param").id,
          c.req.valid("json").expiresAt,
        );
        return c.json({ data: result }, 201);
      } catch (error) {
        const result = routeError(error);
        return c.json(result.body, result.status);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/pages/{id}/public-links/{linkId}",
      tags: ["Pages"],
      security: writeSecurity,
      request: {
        params: z.object({
          id: z.string().min(1).max(128),
          linkId: z.string().uuid(),
        }),
      },
      responses: response(linkSchema, "Revoked public page link"),
    }),
    async (c) => {
      try {
        const { id, linkId } = c.req.valid("param");
        return c.json(
          {
            data: await revokePublicPageLink(
              db,
              actorFromContext(c),
              id,
              linkId,
            ),
          },
          200,
        );
      } catch (error) {
        const result = routeError(error);
        return c.json(result.body, result.status);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/public/pages/{token}",
      security: [],
      tags: ["Public pages"],
      request: { params: z.object({ token: z.string() }) },
      responses: {
        ...response(pageSchema, "Publicly shared page content"),
        200: {
          description: "Publicly shared page content",
          content: {
            "application/json": { schema: z.object({ data: pageSchema }) },
          },
        },
      },
    }),
    async (c) => {
      try {
        return c.json(
          { data: await getPublicPage(db, c.req.valid("param").token) },
          200,
        );
      } catch (error) {
        const result = routeError(error);
        return c.json(result.body, result.status);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/public/pages/{token}/pages/{pageId}",
      security: [],
      tags: ["Public pages"],
      request: {
        params: z.object({
          token: z.string(),
          pageId: z.string().min(1).max(128),
        }),
      },
      responses: {
        ...response(pageSchema, "Publicly shared page content"),
        200: {
          description: "Publicly shared page content",
          content: {
            "application/json": { schema: z.object({ data: pageSchema }) },
          },
        },
      },
    }),
    async (c) => {
      try {
        const { token, pageId } = c.req.valid("param");
        return c.json({ data: await getPublicPage(db, token, pageId) }, 200);
      } catch (error) {
        const result = routeError(error);
        return c.json(result.body, result.status);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/public/pages/{token}/pages/{pageId}/files/{fileId}",
      security: [],
      tags: ["Public pages"],
      request: {
        params: z.object({
          token: z.string(),
          pageId: z.string().min(1).max(128),
          fileId: z.string().min(1).max(128),
        }),
      },
      responses: {
        200: { description: "Page attachment" },
        404: { description: "File unavailable" },
      },
    }),
    async (c) => {
      try {
        const { token, pageId, fileId } = c.req.valid("param");
        const result = await getPublicPageFile(
          db,
          token,
          pageId,
          fileId,
          documents,
        );
        if (!result) return new Response("Not found", { status: 404 });
        const { object, fileName, mimeType } = result;
        const safeMimeType = mimeType.split(";", 1)[0].trim().toLowerCase();
        const safeInlineImage = new Set([
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
          "image/avif",
        ]).has(safeMimeType);
        const disposition = safeInlineImage ? "inline" : "attachment";
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("Content-Type", safeMimeType);
        headers.set(
          "Content-Disposition",
          `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        );
        headers.set("Content-Length", String(object.size));
        headers.set("Cache-Control", "no-store");
        headers.set("X-Robots-Tag", "noindex, nofollow");
        headers.set("Referrer-Policy", "no-referrer");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(object.body, { headers });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  );
}
