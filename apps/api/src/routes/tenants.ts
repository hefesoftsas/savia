import { dialectFor } from "@savia/db/dialect";
import { tableNames, foreignKeys } from "../lib/database-schema";
import { deleteTenantBrandingAssets } from "../tenant-branding/service";
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
  findPrincipal,
  grantMembership,
  listGlobalRoles,
  upsertPrincipal,
} from "../auth/identity-repository";
import {
  assignOrTransferMembership,
  TenantMembershipInvariantError,
} from "../auth/tenant-membership-invariants";
import {
  isForeignKeyConstraint,
  isUniqueConstraint,
} from "../lib/database-errors";
import type { Context } from "hono";
import type { RealtimeHubClient } from "../realtime/hub-client";
import { publishRealtime } from "../realtime/hub-client";
import { PLATFORM_ROOM } from "../realtime/protocol";
import type { SaviaRequestService } from "./savia-request";

/** Discover restrictive references from the schema before any external cleanup. */
async function hasRestrictingTenantReference(db: D1Database, tenantId: number) {
  type ForeignKey = {
    id: number;
    table: string;
    from: string;
    to: string | null;
    on_delete: string;
  };
  const identifier = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  const tables =
    dialectFor(db).name === "postgres"
      ? await tableNames(db)
      : (
          await db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%tenants%'",
            )
            .all<{ name: string }>()
        ).results.map((row) => row.name);
  const names = tables.filter((name) => identifier.test(name));
  if (!names.length) return false;
  const keys = await Promise.all(
    names.map(async (name) => ({ results: await foreignKeys(db, name) })),
  );
  const probes: string[] = [];
  keys.forEach((result, index) => {
    const groups = new Map<number, ForeignKey[]>();
    for (const key of result.results) {
      if (
        key.table !== "tenants" ||
        !["NO ACTION", "RESTRICT"].includes(key.on_delete)
      )
        continue;
      const group = groups.get(key.id) ?? [];
      group.push(key);
      groups.set(key.id, group);
    }
    for (const group of groups.values()) {
      if (
        group.some(
          (key) =>
            !identifier.test(key.from) || !identifier.test(key.to ?? "id"),
        )
      )
        throw new Error("Unsupported tenant foreign key identifier");
      probes.push(
        `SELECT 1 FROM "${names[index]}" child JOIN tenants parent ON ${group.map((key) => `child."${key.from}"=parent."${key.to ?? "id"}"`).join(" AND ")} WHERE parent.id=?`,
      );
    }
  });
  return (
    probes.length > 0 &&
    Boolean(
      await db
        .prepare(probes.join(" UNION ALL ") + " LIMIT 1")
        .bind(...probes.map(() => tenantId))
        .first(),
    )
  );
}

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
const tenantRole = z.enum([
  "tenant_admin",
  "agency_admin",
  "operator",
  "viewer",
]);
const newTenantUserSchema = z
  .object({
    email: z.string().email(),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    role: tenantRole,
    temporaryPassword: z.string().min(12).max(128).optional(),
  })
  .strict();
const existingTenantMemberSchema = z
  .object({
    principalId: z.string().min(1).max(100),
    role: tenantRole,
  })
  .strict();
const tenantInputSchema = z
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
    initialUser: newTenantUserSchema.optional(),
    existingMember: existingTenantMemberSchema.optional(),
  })
  .strict();
const inputSchema = tenantInputSchema.refine(
  (val) =>
    Number(Boolean(val.initialUser)) + Number(Boolean(val.existingMember)) ===
    1,
  {
    message:
      "Provide either initialUser for a new account or existingMember to transfer a user, not both.",
  },
);
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
      content: { "application/json": { schema: tenantInputSchema.partial() } },
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
const select =
  'SELECT t.id,t.id_slug AS "idSlug",t.name,t.kind,t.is_active AS "isActive",t.created_at AS "createdAt",t.updated_at AS "updatedAt",NULL AS "agencyId" FROM tenants t';
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
const userMissing = {
  error: { code: "USER_NOT_FOUND", message: "El usuario no existe." },
};
function memberConflict(message: string) {
  return { error: { code: "TENANT_CONFLICT", message } };
}

/**
 * Reserve the next tenant ID and insert the commercial tenant row.
 * Callers compensate with `DELETE FROM tenants WHERE id=?` when a later
 * phase of the compensated creation fails.
 */
async function insertTenant(
  db: D1Database,
  input: { name: string; idSlug?: string; isActive?: boolean },
  now: string,
): Promise<number> {
  const allocation = await db
    .prepare(
      `INSERT INTO server_id_sequences(resource,next_id) SELECT 'tenants',COALESCE(MAX(id),0)+2 FROM tenants WHERE true ON CONFLICT(resource) DO UPDATE SET next_id=${dialectFor(db).name === "postgres" ? "GREATEST" : "MAX"}(${dialectFor(db).name === "postgres" ? "server_id_sequences.next_id" : "next_id"}+1,(SELECT COALESCE(MAX(id),0)+2 FROM tenants)) RETURNING next_id-1 AS id`,
    )
    .first<{ id: number }>();
  if (!allocation) throw new Error("Unable to allocate tenant ID");
  await db
    .prepare(
      "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(?,?,?,?,?,?, 'commercial')",
    )
    .bind(
      allocation.id,
      input.idSlug ?? crypto.randomUUID(),
      input.name,
      input.isActive === false ? 0 : 1,
      now,
      now,
    )
    .run();
  return allocation.id;
}

/**
 * Create a commercial tenant around an existing user. Membership is unique
 * per principal, so this transfers the user out of their current tenant
 * instead of sharing them. Platform administrators cannot be transferred:
 * revoke their global role first through user management.
 */
async function createTenantWithExistingMember(
  c: Context,
  db: D1Database,
  input: {
    name: string;
    idSlug?: string;
    isActive?: boolean;
    existingMember: { principalId: string; role: z.infer<typeof tenantRole> };
  },
  realtime?: RealtimeHubClient,
) {
  const principal = await findPrincipal(db, input.existingMember.principalId);
  if (!principal || !principal.isActive) return c.json(userMissing, 404);
  if ((await listGlobalRoles(db, principal.id)).includes("platform_admin"))
    return c.json(
      memberConflict(
        "El usuario es administrador de plataforma. Revoca ese rol antes de transferirlo a un tenant.",
      ),
      409,
    );
  const now = new Date().toISOString();
  let tenantId: number | undefined;
  try {
    tenantId = await insertTenant(db, input, now);
    await assignOrTransferMembership(
      db,
      principal.id,
      tenantId,
      input.existingMember.role,
    );
  } catch (error) {
    if (tenantId !== undefined)
      await db.prepare("DELETE FROM tenants WHERE id=?").bind(tenantId).run();
    if (error instanceof TenantMembershipInvariantError)
      return c.json(
        memberConflict(
          "El usuario es el último miembro activo de su organización. Agrega otro miembro allí antes de transferirlo.",
        ),
        409,
      );
    if (isUniqueConstraint(error)) return c.json(conflict, 409);
    throw error;
  }
  const row = await db
    .prepare(`${select} WHERE t.id=?`)
    .bind(tenantId)
    .first<TenantRow>();
  notifyTenantRoom(realtime, c, "tenants", "created", tenantId);
  notifyTenantRoom(realtime, c, "users", "updated", principal.id);
  return c.json({ data: document(row!) }, 201);
}

/**
 * Best-effort realtime hint after tenant mutations. The socket carries no
 * record data; subscribers refetch through the API.
 */
function notifyTenantRoom(
  realtime: RealtimeHubClient | undefined,
  context: Context,
  topic: "users" | "tenants",
  type: "created" | "updated" | "deleted",
  id: string | number,
): void {
  publishRealtime(realtime, PLATFORM_ROOM, {
    topic,
    type,
    id,
    actor: actorFromContext(context).principal.id,
  });
}

export function registerTenantRoutes(
  app: OpenAPIHono,
  db: D1Database,
  userAdministrator?: IdentityUserAdministrator,
  realtime?: RealtimeHubClient,
  documents?: R2Bucket,
  saviaRequestService?: SaviaRequestService,
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
        'SELECT id, id_slug AS "idSlug", name, kind, is_active AS "isActive" FROM tenants WHERE id_slug=? AND is_active=1',
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
      .prepare(
        `${select} WHERE t.id=?${platform ? "" : " AND t.kind='commercial' AND t.is_active=1"}`,
      )
      .bind(id)
      .first<TenantRow>();
    if (!row) return c.json(missing, 404);
    return c.json({ data: document(row) }, 200);
  });
  app.openapi(createDefinition, async (c) => {
    requirePlatformAdministrator(actorFromContext(c));
    const input = c.req.valid("json");
    if (input.existingMember) {
      return createTenantWithExistingMember(
        c,
        db,
        input as {
          name: string;
          idSlug?: string;
          isActive?: boolean;
          existingMember: {
            principalId: string;
            role: z.infer<typeof tenantRole>;
          };
        },
        realtime,
      );
    }
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
    const now = new Date().toISOString();
    let authenticatedUser: { subject: string } | undefined;
    let principalId: string | undefined;
    let tenantId: number | undefined;
    try {
      authenticatedUser = await userAdministrator.createUser(
        { ...input.initialUser!, platformAdmin: false },
        c.req.raw,
      );
      tenantId = await insertTenant(db, input, now);
      const principal = await upsertPrincipal(db, {
        issuer: userAdministrator.issuer,
        subject: authenticatedUser.subject,
        email: input.initialUser!.email,
        displayName: `${input.initialUser!.firstName} ${input.initialUser!.lastName}`,
      });
      principalId = principal.id;
      await grantMembership(
        db,
        principal.id,
        tenantId,
        input.initialUser!.role,
      );
    } catch (error) {
      if (principalId) await deletePrincipal(db, principalId);
      if (tenantId)
        await db.prepare("DELETE FROM tenants WHERE id=?").bind(tenantId).run();
      if (authenticatedUser) {
        await userAdministrator.deleteUser(
          authenticatedUser.subject,
          c.req.raw,
        );
      }
      if (isUniqueConstraint(error)) return c.json(conflict, 409);
      throw error;
    }
    const row = await db
      .prepare(`${select} WHERE t.id=?`)
      .bind(tenantId)
      .first<TenantRow>();
    notifyTenantRoom(realtime, c, "tenants", "created", tenantId!);
    if (principalId)
      notifyTenantRoom(realtime, c, "users", "created", principalId);
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
    notifyTenantRoom(realtime, c, "tenants", "updated", id);
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
    if (await hasRestrictingTenantReference(db, id))
      return c.json(conflict, 409);
    const linked = await db
      .prepare(
        "SELECT 1 FROM identity_tenant_membership WHERE tenant_id=? UNION ALL SELECT 1 FROM crm_objects WHERE tenant_id=? LIMIT 1",
      )
      .bind(id, `agency:${id}`)
      .first();
    if (linked) return c.json(conflict, 409);
    const tables =
      dialectFor(db).name === "postgres"
        ? await tableNames(db, "tenant_id")
        : (
            await db
              .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crm_%' AND sql LIKE '%tenant_id%'",
              )
              .all<{ name: string }>()
          ).results.map((row) => row.name);
    const names = tables.filter((name) => /^crm_[a-z_]+$/.test(name));
    if (names.length) {
      const remaining = await db.batch(
        names.map((name) =>
          db
            .prepare(
              `SELECT 1 FROM "${name}" WHERE tenant_id=? OR tenant_id LIKE ? LIMIT 1`,
            )
            .bind(`agency:${id}`, `agency:${id}:%`),
        ),
      );
      if (remaining.some((result) => result.results.length > 0))
        return c.json(conflict, 409);
    }
    await deleteTenantBrandingAssets(db, documents, id);
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
    // Best-effort: drop the tenant's Savia Request overlays (flows,
    // variables, versions, runs, folders, bundles) so sealed secrets never
    // linger in the request store. The core record is already gone, so a
    // purge failure is logged loudly instead of failing the deletion.
    if (saviaRequestService) {
      for (const scope of [`agency:${id}`, `tenant:${id}`]) {
        try {
          const purged = await saviaRequestService.fetch(
            new Request(
              `https://savia-request.internal/api/admin/tenants/${scope}`,
              {
                method: "DELETE",
                headers: { "content-type": "application/json" },
                body: "{}",
              },
            ),
          );
          if (!purged.ok)
            console.error(
              `Savia Request purge failed for ${scope}: HTTP ${purged.status}.`,
            );
        } catch (error) {
          console.error(
            `Savia Request purge failed for ${scope}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }
    notifyTenantRoom(realtime, c, "tenants", "deleted", id);
    return c.body(null, 204);
  });
}
