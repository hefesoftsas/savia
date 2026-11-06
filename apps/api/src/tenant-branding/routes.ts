import { dialectFor } from "@savia/db/dialect";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { actorFromContext } from "../auth/middleware";
import {
  activeTenant,
  authorizeBranding,
  brandingSchema,
  readTenantBranding,
  readTenantBrandingForRequest,
  saveTenantBranding,
  uploadBrandingAsset,
  MAX_ASSET_BYTES,
} from "./service";
const tenantId = z.coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const params = z.object({ tenantId });
const response = {
  description: "Tenant branding",
  content: {
    "application/json": {
      schema: z.object({
        data: brandingSchema,
        canManage: z.boolean().optional(),
      }),
    },
  },
};
export function registerTenantBrandingRoutes(
  app: OpenAPIHono,
  db: D1Database,
  bucket?: R2Bucket,
  canonicalHost?: string,
) {
  app.use("/v1/tenants/:tenantId/branding", bodyLimit({ maxSize: 8192 }));
  app.use(
    "/v1/tenants/:tenantId/branding/assets/:kind",
    bodyLimit({ maxSize: MAX_ASSET_BYTES + 65536 }),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/tenants/{tenantId}/branding",
      tags: ["Tenant branding"],
      request: { params },
      responses: { 200: response },
    }),
    async (c) => {
      const { tenant, canManage } = await authorizeBranding(
        db,
        actorFromContext(c),
        c.req.valid("param").tenantId,
      );
      c.header("Cache-Control", "no-store");
      return c.json(
        { data: await readTenantBranding(db, tenant), canManage },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/tenants/{tenantId}/branding",
      tags: ["Tenant branding"],
      request: {
        params,
        body: {
          required: true,
          content: { "application/json": { schema: brandingSchema } },
        },
      },
      responses: { 200: response },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(
        {
          data: await saveTenantBranding(
            db,
            c.req.valid("param").tenantId,
            actorFromContext(c),
            c.req.valid("json"),
          ),
          canManage: true,
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/tenants/{tenantId}/branding/assets/{kind}",
      tags: ["Tenant branding"],
      request: {
        params: params.extend({
          kind: z.enum(["logo", "cover", "login-animation"]),
        }),
        body: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: z.object({
                file: z.any().openapi({ type: "string", format: "binary" }),
              }),
            },
          },
        },
      },
      responses: {
        201: {
          description: "Uploaded image awaiting branding save",
          content: {
            "application/json": {
              schema: z.object({ data: z.object({ url: z.string() }) }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { tenantId, kind } = c.req.valid("param");
      const actor = actorFromContext(c);
      await authorizeBranding(db, actor, tenantId, true);
      const form = await c.req.formData();
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        Array.from(form.keys()).some((key) => key !== "file") ||
        form.getAll("file").length !== 1
      )
        throw new HTTPException(400, {
          message: "Upload exactly one image file.",
        });
      return c.json(
        {
          data: await uploadBrandingAsset(
            db,
            bucket,
            tenantId,
            kind,
            actor,
            file,
          ),
        },
        201,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/public/tenant-branding",
      security: [],
      tags: ["Tenant branding"],
      responses: {
        200: {
          description: "Branding for the requested tenant hostname",
          content: {
            "application/json": {
              schema: z.object({ data: brandingSchema.nullable() }),
            },
          },
        },
      },
    }),
    async (c) => {
      c.header(
        "Cache-Control",
        "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      );
      return c.json(
        {
          data: await readTenantBrandingForRequest(
            db,
            c.req.raw,
            canonicalHost,
          ),
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/public/tenant-branding/assets/{tenantId}/{assetId}",
      security: [],
      tags: ["Tenant branding"],
      request: { params: params.extend({ assetId: z.string().uuid() }) },
      responses: {
        200: {
          description: "Published tenant logo, cover or login animation",
          content: {
            "image/png": { schema: z.string().openapi({ format: "binary" }) },
            "image/jpeg": { schema: z.string().openapi({ format: "binary" }) },
            "image/webp": { schema: z.string().openapi({ format: "binary" }) },
            "application/json": {
              schema: z.string().openapi({ format: "binary" }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { tenantId, assetId } = c.req.valid("param");
      await activeTenant(db, tenantId);
      const row = await db
        .prepare(
          "SELECT a.object_key,a.content_type FROM tenant_branding_assets a JOIN tenant_branding b ON b.tenant_id=a.tenant_id WHERE a.state='live' AND a.tenant_id=? AND a.id=? AND (" +
            dialectFor(db).jsonValue("b.config", "$.logoUrl") +
            "=? OR " +
            dialectFor(db).jsonValue("b.config", "$.coverUrl") +
            "=? OR " +
            dialectFor(db).jsonValue("b.config", "$.loginAnimationUrl") +
            "=?)",
        )
        .bind(
          tenantId,
          assetId,
          "/api/public/tenant-branding/assets/" + tenantId + "/" + assetId,
          "/api/public/tenant-branding/assets/" + tenantId + "/" + assetId,
          "/api/public/tenant-branding/assets/" + tenantId + "/" + assetId,
        )
        .first<{ object_key: string; content_type: string }>();
      if (!row || !bucket)
        throw new HTTPException(404, { message: "File unavailable." });
      const object = await bucket.get(row.object_key);
      if (!object)
        throw new HTTPException(404, { message: "File unavailable." });
      return new Response(object.body, {
        headers: {
          "Content-Type": row.content_type,
          "Content-Length": String(object.size),
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Content-Disposition": "inline",
        },
      });
    },
  );
}
