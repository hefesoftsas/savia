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
  persistPublicFormShortUrl,
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
  app.use("/s/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
    if (c.req.method !== "GET")
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
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/public-forms/{id}/short-url",
      tags: ["Public forms"],
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: jsonResponse, 404: jsonResponse, 503: jsonResponse },
    }),
    async (c) => {
      const id = c.req.valid("param").id;
      const now = new Date().toISOString();
      const form = await db
        .prepare(
          "SELECT id,token,expires_at,revoked_at,short_url FROM public_forms WHERE id=?",
        )
        .bind(id)
        .first<{
          id: string;
          token: string;
          expires_at: string | null;
          revoked_at: string | null;
          short_url: string | null;
        }>();
      if (
        !form ||
        form.revoked_at !== null ||
        (form.expires_at !== null && form.expires_at <= now)
      )
        return c.json({ error: "Public form unavailable." }, 404);

      if (form.short_url)
        return c.json({ data: { shortUrl: form.short_url } }, 200);
      if (options.shortener) {
        const destination = new URL(
          "/public/forms/" + form.token,
          options.publicOrigin ?? c.req.url,
        ).href;
        try {
          const shortUrl = await options.shortener.shorten(destination);
          const persistedShortUrl = await persistPublicFormShortUrl(
            db,
            id,
            shortUrl,
          );
          return c.json({ data: { shortUrl: persistedShortUrl } }, 200);
        } catch {
          throw new HTTPException(503, {
            message: "External short URL provider unavailable.",
          });
        }
      }

      let row = await db
        .prepare("SELECT code FROM public_form_short_links WHERE form_id=?")
        .bind(id)
        .first<{ code: string }>();
      for (let attempt = 0; !row && attempt < 8; attempt++) {
        const code = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
        const inserted = await db
          .prepare(
            "INSERT OR IGNORE INTO public_form_short_links(code,form_id,created_at) VALUES(?,?,?)",
          )
          .bind(code, id, now)
          .run();
        if (inserted.meta.changes > 0) row = { code };
        else
          row = await db
            .prepare("SELECT code FROM public_form_short_links WHERE form_id=?")
            .bind(id)
            .first<{ code: string }>();
      }
      if (!row)
        throw new HTTPException(503, {
          message: "Could not create a short URL.",
        });

      const shortUrl = new URL(
        "/s/" + row.code,
        options.publicOrigin ?? c.req.url,
      ).href;
      return c.json({ data: { shortUrl } }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/s/{code}",
      security: [],
      tags: ["Public forms"],
      request: { params: z.object({ code: z.string() }) },
      responses: {
        302: { description: "Redirect to the published public form" },
      },
    }),
    async (c) => {
      const { code } = c.req.valid("param");
      if (!/^[a-f0-9]{16}$/.test(code))
        return c.json({ error: "Public form unavailable." }, 404);
      const form = await db
        .prepare(
          "SELECT f.token FROM public_form_short_links s JOIN public_forms f ON f.id=s.form_id WHERE s.code=? AND f.revoked_at IS NULL AND (f.expires_at IS NULL OR f.expires_at>?)",
        )
        .bind(code, new Date().toISOString())
        .first<{ token: string }>();
      if (!form) return c.json({ error: "Public form unavailable." }, 404);
      const destination = new URL(
        "/public/forms/" + form.token,
        options.publicOrigin ?? c.req.url,
      );
      return c.redirect(destination.href, 302);
    },
  );
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
          "SELECT f.*, s.code AS short_code FROM public_forms f LEFT JOIN public_form_short_links s ON s.form_id=f.id WHERE f.tenant_id=? AND f.object_name=? ORDER BY f.created_at DESC",
        )
        .bind(tenantForDomain(q.domainId), q.objectName)
        .all<PublicFormRow>();
      return c.json(
        {
          data: result.results.map((row) =>
            managedForm(row, options.publicOrigin, Boolean(options.shortener)),
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
      request: {
        params: z.object({ id: z.string().uuid() }),
        query: z.object({ hard: z.string().optional() }),
      },
      responses: { 200: jsonResponse },
    }),
    async (c) => {
      const id = c.req.valid("param").id;
      // Hard deletion is only for dead links: removing an active link would
      // silently drop its deduplication reservations. Revoke first.
      if (c.req.valid("query").hard === "true") {
        const row = await db
          .prepare("SELECT revoked_at,expires_at FROM public_forms WHERE id=?")
          .bind(id)
          .first<{ revoked_at: string | null; expires_at: string | null }>();
        if (!row) return c.json({ ok: true }, 200);
        const dead =
          row.revoked_at !== null ||
          (row.expires_at !== null &&
            row.expires_at <= new Date().toISOString());
        if (!dead)
          throw new HTTPException(409, {
            message: "Revoca el enlace antes de eliminarlo.",
          });
        await db.batch([
          db
            .prepare("DELETE FROM public_form_submissions WHERE form_id=?")
            .bind(id),
          db.prepare("DELETE FROM public_forms WHERE id=?").bind(id),
        ]);
        return c.json({ ok: true }, 200);
      }
      await db
        .prepare(
          "UPDATE public_forms SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
        )
        .bind(new Date().toISOString(), id)
        .run();
      return c.json({ ok: true }, 200);
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
          ...(row.logo_image ? { logoImage: row.logo_image } : {}),
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
      method: "get",
      path: "/api/public/forms/{token}/cities",
      security: [],
      tags: ["Public forms"],
      request: {
        params: z.object({ token: z.string() }),
        query: z.object({ search: z.string().min(2).max(100) }),
      },
      responses: { 200: jsonResponse },
    }),
    async (c) => {
      const row = await activePublicForm(db, c.req.valid("param").token);
      if (row.kind !== "quote")
        throw new HTTPException(404, { message: "Public form unavailable." });
      if (!options.saviaRequest)
        throw new HTTPException(503, { message: "Public form unavailable." });
      await options.quote?.assertAvailable?.({
        db,
        tenant: row.tenant_id,
        domainId: row.domain_id,
        objectName: row.object_name,
        snapshot: JSON.parse(row.snapshot),
      });
      const search = c.req.valid("query").search.trim();
      if (search.length < 2)
        throw new HTTPException(400, { message: "Indica una ciudad válida." });
      const upstream = await options.saviaRequest.fetch(
        new Request(
          "https://savia-request.internal/api/lookups/dane?city=" +
            encodeURIComponent(search.slice(0, 100)),
          { method: "GET", headers: { "content-type": "application/json" } },
        ),
      );
      if (!upstream.ok)
        throw new HTTPException(503, { message: "Public form unavailable." });
      const body = (await upstream.json().catch(() => undefined)) as
        { matches?: unknown } | undefined;
      // DANE codes are public reference data: project a bounded list with
      // only code/city/department, never upstream internals.
      const matches = Array.isArray(body?.matches)
        ? body.matches
            .filter(
              (match): match is Record<string, unknown> =>
                !!match && typeof match === "object" && !Array.isArray(match),
            )
            .map((match) => ({
              code: typeof match.code === "string" ? match.code : "",
              city: typeof match.city === "string" ? match.city : "",
              department:
                typeof match.department === "string" ? match.department : "",
            }))
            .filter((match) => match.code && match.city)
            .slice(0, 20)
        : [];
      return c.json({ matches }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/public/forms/{token}/status/{submissionId}",
      security: [],
      tags: ["Public forms"],
      request: {
        params: z.object({
          token: z.string(),
          submissionId: z.string().uuid(),
        }),
      },
      responses: { 200: jsonResponse },
    }),
    async (c) => {
      const row = await activePublicForm(db, c.req.valid("param").token);
      if (row.kind !== "quote" || !options.quote?.quoteStatus)
        throw new HTTPException(404, { message: "Public form unavailable." });
      // The submission id is an unguessable capability: unknown ids 404
      // without revealing whether the link itself exists beyond the token.
      const submission = await db
        .prepare(
          "SELECT state,response FROM public_form_submissions WHERE form_id=? AND submission_id=?",
        )
        .bind(row.id, c.req.valid("param").submissionId)
        .first<{ state: string; response: string | null }>();
      if (!submission)
        throw new HTTPException(404, { message: "Public form unavailable." });
      // Return only the committed public receipt, with its original result policy.
      return c.json(
        {
          ...(submission.state === "complete" && submission.response
            ? { state: "complete", receipt: JSON.parse(submission.response) }
            : {}),
          ...(await options.quote.quoteStatus({
            db,
            tenant: row.tenant_id,
            domainId: row.domain_id,
            objectName: row.object_name,
            snapshot: JSON.parse(row.snapshot),
            submission: c.req.valid("param").submissionId,
          })),
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
