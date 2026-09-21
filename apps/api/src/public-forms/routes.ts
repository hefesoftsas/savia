import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";
import {
  activePublicForm,
  domainIdSchema,
  managedForm,
  objectNameSchema,
  publishPublicForm,
  publishSchema,
  submissionSchema,
  submitPublicForm,
  tenantForDomain,
  type PublicFormOptions,
  type PublicFormRow,
} from "./service";
import { captchaConfiguration, publicFormChallenge } from "./captcha";
export type PublicFormsOptions = PublicFormOptions;
const jsonResponse = {
  description: "Public form response",
  content: {
    "application/json": { schema: z.record(z.string(), z.unknown()) },
  },
};
export function registerPublicFormRoutes(
  app: OpenAPIHono,
  db: D1Database,
  options: PublicFormsOptions = {},
) {
  app.use("/v1/public-forms", async (c, next) => {
    try {
      requirePlatformAdministrator(actorFromContext(c));
    } catch {
      throw new HTTPException(403, {
        message: "Platform administrator required.",
      });
    }
    await next();
  });
  app.use("/v1/public-forms/*", async (c, next) => {
    try {
      requirePlatformAdministrator(actorFromContext(c));
    } catch {
      throw new HTTPException(403, {
        message: "Platform administrator required.",
      });
    }
    await next();
  });
  app.use("/api/public/forms/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
    if (!["GET", "POST"].includes(c.req.method))
      return c.json({ error: "Method not allowed" }, 405);
    if (options.rateLimiter) {
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(ip),
      );
      const key = Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      if (!(await options.rateLimiter.limit({ key })).success)
        return c.json({ error: "Too many requests" }, 429);
    }
    await next();
  });
  app.use("/api/public/forms/*", bodyLimit({ maxSize: 32768 }));
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/public-forms",
      tags: ["Public forms"],
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: publishSchema } },
        },
      },
      responses: { 201: jsonResponse },
    }),
    async (c) =>
      c.json(
        {
          data: await publishPublicForm(
            db,
            options,
            actorFromContext(c).principal.id,
            c.req.valid("json"),
          ),
        },
        201,
      ),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/public-forms",
      tags: ["Public forms"],
      request: {
        query: z.object({
          domainId: domainIdSchema,
          objectName: objectNameSchema,
        }),
      },
      responses: { 200: jsonResponse },
    }),
    async (c) => {
      const q = c.req.valid("query");
      const result = await db
        .prepare(
          "SELECT * FROM public_forms WHERE tenant_id=? AND object_name=? ORDER BY created_at DESC",
        )
        .bind(tenantForDomain(q.domainId), q.objectName)
        .all<PublicFormRow>();
      return c.json(
        {
          data: result.results.map((row) =>
            managedForm(row, options.publicOrigin),
          ),
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/public-forms/{id}",
      tags: ["Public forms"],
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: jsonResponse, 404: jsonResponse },
    }),
    async (c) => {
      const id = c.req.valid("param").id;
      const row = await db
        .prepare("SELECT revoked_at FROM public_forms WHERE id=?")
        .bind(id)
        .first<{ revoked_at: string | null }>();
      if (!row) return c.json({ error: "Public form not found." }, 404);
      if (!row.revoked_at) {
        await db
          .prepare(
            "UPDATE public_forms SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
          )
          .bind(new Date().toISOString(), id)
          .run();
        return c.json({ ok: true, deleted: false }, 200);
      }
      // A revoked link can be deleted permanently: its submissions only exist
      // for quota and replay checks, so they are removed with the form.
      await db.batch([
        db
          .prepare("DELETE FROM public_form_submissions WHERE form_id=?")
          .bind(id),
        db.prepare("DELETE FROM public_forms WHERE id=?").bind(id),
      ]);
      return c.json({ ok: true, deleted: true }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/public/forms/{token}/challenge",
      security: [],
      tags: ["Public forms"],
      request: { params: z.object({ token: z.string() }) },
      responses: { 200: jsonResponse },
    }),
    async (c) => {
      const row = await activePublicForm(db, c.req.valid("param").token);
      return c.json(await publicFormChallenge(options, row.id), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/public/forms/{token}",
      security: [],
      tags: ["Public forms"],
      request: { params: z.object({ token: z.string() }) },
      responses: { 200: jsonResponse },
    }),
    async (c) => {
      const config = captchaConfiguration(options);
      const row = await activePublicForm(db, c.req.valid("param").token);
      let presentation: unknown;
      if (row.kind === "quote") {
        if (!options.quote)
          throw new HTTPException(503, { message: "Public form unavailable." });
        const snapshot = JSON.parse(row.snapshot);
        await options.quote.assertAvailable?.({
          db,
          tenant: row.tenant_id,
          domainId: row.domain_id,
          objectName: row.object_name,
          snapshot,
        });
        if (options.quote.presentation) {
          presentation = await options.quote.presentation({
            objectName: row.object_name,
            snapshot,
          });
        }
      }
      return c.json(
        {
          id: row.id,
          title: row.title,
          ...(row.description ? { description: row.description } : {}),
          kind: row.kind,
          fields: JSON.parse(row.fields),
          ...(presentation !== undefined ? { presentation } : {}),
          captchaProvider: config.provider,
          ...(config.provider === "turnstile"
            ? { siteKey: config.siteKey }
            : {}),
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/public/forms/{token}/vehicle-lookup",
      security: [],
      tags: ["Public forms"],
      request: {
        params: z.object({ token: z.string() }),
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({ plate: z.string().min(1).max(20) }).strict(),
            },
          },
        },
      },
      responses: { 200: jsonResponse },
    }),
    async (c) => {
      const row = await activePublicForm(db, c.req.valid("param").token);
      if (row.kind !== "quote")
        throw new HTTPException(404, { message: "Public form unavailable." });
      if (!options.quote?.lookupVehicle)
        throw new HTTPException(503, { message: "Public form unavailable." });
      await options.quote.assertAvailable?.({
        db,
        tenant: row.tenant_id,
        domainId: row.domain_id,
        objectName: row.object_name,
        snapshot: JSON.parse(row.snapshot),
      });
      return c.json(
        await options.quote.lookupVehicle({
          db,
          tenant: row.tenant_id,
          domainId: row.domain_id,
          objectName: row.object_name,
          snapshot: JSON.parse(row.snapshot),
          plate: c.req.valid("json").plate,
        }),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/public/forms/{token}",
      security: [],
      tags: ["Public forms"],
      request: {
        params: z.object({ token: z.string() }),
        body: {
          required: true,
          content: { "application/json": { schema: submissionSchema } },
        },
      },
      responses: { 200: jsonResponse },
    }),
    async (c) => {
      const row = await activePublicForm(db, c.req.valid("param").token);
      return c.json(
        await submitPublicForm(
          db,
          options,
          row,
          c.req.valid("json"),
          c.req.header("cf-connecting-ip") ?? "unknown",
        ),
        200,
      );
    },
  );
}
