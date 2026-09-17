import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  normalizeTenantSlug,
  parseTenantSlugFromHostname,
} from "@savia/tenant-host/tenant-host";
import {
  actorFromContext,
  requirePlatformAdministrator,
} from "../auth/middleware";
import { tenantSlugFromApiRequest } from "../auth/tenant-host-guard";
import type { IdentityUserAdministrator } from "../auth/better-auth";
import {
  deletePrincipal,
  grantMembership,
  upsertPrincipal,
} from "../auth/identity-repository";
import { isForeignKeyConstraint, isUniqueConstraint } from "../lib/database-errors";

const tenantSchema = z.object({
  id: z.number(),
  idSlug: z.string(),
  name: z.string(),
  kind: z.enum(["commercial", "platform"]),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  agencyId: z.number().nullable(),
});
const inputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    idSlug: z
      .string()
      .trim()
      .refine((val) => normalizeTenantSlug(val) !== null, {
        message:
          "Tenant slug must be 1-63 lowercase alphanumeric characters/hyphens and not a reserved name",
      })
      .transform((val) => normalizeTenantSlug(val)!)
      .optional(),
    isActive: z.boolean().optional(),
    initialUser: z
      .object({
        email: z.string().email(),
        firstName: z.string().trim().min(1).max(100),
        lastName: z.string().trim().min(1).max(100),
        role: z.enum(["tenant_admin", "agency_admin", "operator", "viewer"]),
        temporaryPassword: z.string().min(12).max(128).optional(),
      })
      .strict(),
  })
  .strict();
const params = z.object({ tenantId: z.coerce.number().int().nonnegative() });
const response = {
  description: "Tenant",
  content: { "application/json": { schema: z.object({ data: tenantSchema }) } },
};
const errorResponse = {
  description: "Rejected",
  content: {
    "application/json": {
      schema: z.object({
        error: z.object({ code: z.string(), message: z.string() }),
      }),
    },
  },
};
const errors = {
  400: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
};
const tags = ["Tenants"];
const listRoute = createRoute({
  method: "get",
  path: "/v1/tenants",
  tags,
  summary: "List accessible tenants",
  responses: {
    200: {
      description: "Tenants",
      content: {
        "application/json": {
          schema: z.object({
            data: z.array(tenantSchema),
            meta: z.object({ total: z.number() }),
          }),
        },
      },
    },
    ...errors,
  },
});
const currentTenantRoute = createRoute({
  method: "get",
  path: "/v1/tenants/current",
  tags,
  summary: "Get current tenant context from host",
  responses: {
    200: {
      description: "Current workspace tenant info",
      content: {
        "application/json": {
          schema: z.object({
            data: z.object({
              isDedicated: z.boolean(),
              slug: z.string().nullable(),
              name: z.string(),
              kind: z.enum(["commercial", "platform"]),
              id: z.number().nullable(),
            }),
          }),
        },
      },
    },
    ...errors,
  },
});
const getRoute = createRoute({
  method: "get",
  path: "/v1/tenants/{tenantId}",
  tags,
  request: { params },
  responses: { 200: response, ...errors },
});
const createDefinition = createRoute({
  method: "post",
  path: "/v1/tenants",
  tags,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: inputSchema } },
    },
  },
  responses: { 201: response, ...errors, 503: errorResponse },
});
const updateDefinition = createRoute({
  method: "patch",
  path: "/v1/tenants/{tenantId}",
  tags,
  request: {
    params,
    body: {
      required: true,
      content: { "application/json": { schema: inputSchema.partial() } },
    },
  },
  responses: { 200: response, ...errors },
});
const deleteDefinition = createRoute({
  method: "delete",
  path: "/v1/tenants/{tenantId}",
  tags,
  request: { params },
  responses: { 204: { description: "Deleted" }, ...errors },
});
type TenantRow = Omit<z.infer<typeof tenantSchema>, "isActive"> & {
  isActive: number;
};
const select = `SELECT t.id,t.id_slug AS idSlug,t.name,t.kind,t.is_active AS isActive,t.created_at AS createdAt,t.updated_at AS updatedAt,NULL AS agencyId FROM tenants t`;
const document = (row: TenantRow) => ({
  ...row,
  isActive: Boolean(row.isActive),
});
const missing = {
  error: { code: "TENANT_NOT_FOUND", message: "El tenant no existe." },
};
const conflict = {
  error: {
    code: "TENANT_CONFLICT",
    message: "El identificador ya existe o el tenant tiene datos asociados.",
  },
};

export function registerTenantRoutes(
  app: OpenAPIHono,
  db: D1Database,
  userAdministrator?: IdentityUserAdministrator,
) {
  app.openapi(listRoute, async (c) => {
    const actor = actorFromContext(c);
    const platform = actor.globalRoles.includes("platform_admin");
    const ids = actor.memberships
      .filter((m) => m.isActive)
      .map((m) => m.tenantId ?? m.agencyId);
    const rows = await db
      .prepare(
        `${select}${platform ? "" : ` WHERE t.kind='commercial' AND t.is_active=1 AND t.id IN (${ids.map(() => "?").join(",") || "NULL"})`} ORDER BY CASE t.kind WHEN 'platform' THEN 0 ELSE 1 END,t.name,t.id`,
      )
      .bind(...(platform ? [] : ids))
      .all<TenantRow>();
    c.header("cache-control", "no-store");
    return c.json(
      {
        data: rows.results.map(document),
        meta: { total: rows.results.length },
      },
      200,
    );
  });
  app.openapi(currentTenantRoute, async (c) => {
    const slug = tenantSlugFromApiRequest(c.req.raw);
    if (!slug) {
      return c.json(
        {
          data: {
            isDedicated: false,
            slug: null,
            name: "Savia",
            kind: "platform" as const,
            id: null,
          },
        },
        200,
      );
    }
    const row = await db
      .prepare(
        "SELECT id, id_slug AS idSlug, name, kind, is_active AS isActive FROM tenants WHERE id_slug=? AND is_active=1",
      )
      .bind(slug)
      .first<{
        id: number;
        idSlug: string;
        name: string;
        kind: "commercial" | "platform";
        isActive: number;
      }>();
    if (!row) return c.json(missing, 404);
    return c.json(
      {
        data: {
          isDedicated: true,
          slug: row.idSlug,
          name: row.name,
          kind: row.kind,
          id: row.id,
        },
      },
      200,
    );
  });
  app.openapi(getRoute, async (c) => {
    const id = c.req.valid("param").tenantId,
      actor = actorFromContext(c);
    const platform = actor.globalRoles.includes("platform_admin");
    if (
      !platform &&
      !actor.memberships.some(
        (m) => m.isActive && (m.tenantId ?? m.agencyId) === id,
      )
    )
      return c.json(
        {
          error: {
            code: "AUTHORIZATION_FORBIDDEN",
            message: "No tienes acceso a este tenant.",
          },
        },
        403,
      );
    const row = await db
      .prepare(`${select} WHERE t.id=?${platform ? "" : " AND t.kind='commercial' AND t.is_active=1"}`)
      .bind(id)
      .first<TenantRow>();
    if (!row) return c.json(missing, 404);
    return c.json({ data: document(row) }, 200);
  });
  app.openapi(createDefinition, async (c) => {
    requirePlatformAdministrator(actorFromContext(c));
    if (!userAdministrator) {
      return c.json(
        {
          error: {
            code: "AUTHENTICATION_UNAVAILABLE",
            message: "User administration is not configured",
          },
        },
        503,
      );
    }
    const input = c.req.valid("json"),
      now = new Date().toISOString();
    let authenticatedUser: { subject: string } | undefined;
    let principalId: string | undefined;
    let tenantId: number | undefined;
    try {
      authenticatedUser = await userAdministrator.createUser(
        { ...input.initialUser, platformAdmin: false },
        c.req.raw,
      );
      const allocation = await db
        .prepare(
          `INSERT INTO server_id_sequences(resource,next_id) SELECT 'tenants',COALESCE(MAX(id),0)+2 FROM tenants WHERE true ON CONFLICT(resource) DO UPDATE SET next_id=MAX(next_id+1,(SELECT COALESCE(MAX(id),0)+2 FROM tenants)) RETURNING next_id-1 AS id`,
        )
        .first<{ id: number }>();
      if (!allocation) throw new Error("Unable to allocate tenant ID");
      tenantId = allocation.id;
      await db
        .prepare(
          "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(?,?,?,?,?,?, 'commercial')",
        )
        .bind(
          tenantId,
          input.idSlug ?? crypto.randomUUID(),
          input.name,
          input.isActive === false ? 0 : 1,
          now,
          now,
        )
        .run();
      const principal = await upsertPrincipal(db, {
        issuer: userAdministrator.issuer,
        subject: authenticatedUser.subject,
        email: input.initialUser.email,
        displayName: `${input.initialUser.firstName} ${input.initialUser.lastName}`,
      });
      principalId = principal.id;
      await grantMembership(db, principal.id, tenantId, input.initialUser.role);
    } catch (error) {
      if (principalId) await deletePrincipal(db, principalId);
      if (tenantId) await db.prepare("DELETE FROM tenants WHERE id=?").bind(tenantId).run();
      if (authenticatedUser) {
        await userAdministrator.deleteUser(authenticatedUser.subject, c.req.raw);
      }
      if (isUniqueConstraint(error)) return c.json(conflict, 409);
      throw error;
    }
    const row = await db
      .prepare(`${select} WHERE t.id=?`)
      .bind(tenantId)
      .first<TenantRow>();
    return c.json({ data: document(row!) }, 201);
  });
  app.openapi(updateDefinition, async (c) => {
    requirePlatformAdministrator(actorFromContext(c));
    const id = c.req.valid("param").tenantId,
      input = c.req.valid("json");
    const current = await db
      .prepare(`${select} WHERE t.id=? AND t.kind='commercial'`)
      .bind(id)
      .first<TenantRow>();
    if (!current) return c.json(missing, 404);
    try {
      await db
        .prepare(
          "UPDATE tenants SET name=?,id_slug=?,is_active=?,updated_at=? WHERE id=? AND kind='commercial'",
        )
        .bind(
          input.name ?? current.name,
          input.idSlug ?? current.idSlug,
          input.isActive === undefined
            ? current.isActive
            : Number(input.isActive),
          new Date().toISOString(),
          id,
        )
        .run();
    } catch (error) {
      if (isUniqueConstraint(error)) return c.json(conflict, 409);
      throw error;
    }
    const row = await db
      .prepare(`${select} WHERE t.id=? AND t.kind='commercial'`)
      .bind(id)
      .first<TenantRow>();
    return c.json({ data: document(row!) }, 200);
  });
  app.openapi(deleteDefinition, async (c) => {
    requirePlatformAdministrator(actorFromContext(c));
    const id = c.req.valid("param").tenantId;
    // Memberships and domain records must not be orphaned by tenant removal.
    const commercial = await db
      .prepare("SELECT 1 FROM tenants WHERE id=? AND kind='commercial'")
      .bind(id)
      .first();
    if (!commercial) return c.json(missing, 404);
    const linked = await db
      .prepare(
        "SELECT 1 FROM identity_tenant_membership WHERE tenant_id=? UNION ALL SELECT 1 FROM crm_objects WHERE tenant_id=? LIMIT 1",
      )
      .bind(id, `agency:${id}`)
      .first();
    if (linked) return c.json(conflict, 409);
    const tables = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crm_%' AND sql LIKE '%tenant_id%'",
      )
      .all<{ name: string }>();
    const names = tables.results
      .map((table) => table.name)
      .filter((name) => /^[a-z_]+$/.test(name));
    if (names.length) {
      const remaining = await db
        .prepare(
          names
            .map(
              (name) =>
                `SELECT 1 FROM "${name}" WHERE tenant_id=? OR tenant_id LIKE ?`,
            )
            .join(" UNION ALL ") + " LIMIT 1",
        )
        .bind(...names.flatMap(() => [`agency:${id}`, `agency:${id}:%`]))
        .first();
      if (remaining) return c.json(conflict, 409);
    }
    try {
      const deleted = await db
        .prepare("DELETE FROM tenants WHERE id=? RETURNING id")
        .bind(id)
        .first();
      if (!deleted) return c.json(missing, 404);
    } catch (error) {
      if (isForeignKeyConstraint(error)) return c.json(conflict, 409);
      throw error;
    }
    return c.body(null, 204);
  });
}
