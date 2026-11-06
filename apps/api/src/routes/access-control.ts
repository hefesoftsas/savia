import {
  auditQuerySchema,
  auditEntrySchema,
  auditDetailSchema,
  listAccessAudit,
  getAccessAudit,
} from "../auth/access-audit";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { actorFromContext } from "../auth/middleware";
import { accessAuthority } from "../auth/access-context";
import { AccessControlError, accessCatalog } from "../auth/access-registry";
import {
  saveAccessRole,
  deleteAccessRole,
  listAccessRoles,
  replaceAccessAssignments,
  loadAccessPolicy,
} from "../auth/access-repository";
import { findPrincipal } from "../auth/identity-repository";
import {
  publishRealtime,
  type RealtimeHubClient,
} from "../realtime/hub-client";
import { principalRoom, tenantRoom } from "../realtime/protocol";
import {
  accessScopeSchema,
  accessActions,
  type AccessScope,
  type AccessPredicate,
} from "@savia/studio-shared/access-control";

const scopeQuery = z.object({ scope: z.string() });
const revision = z.number().int().nonnegative();
const grant = z.object({
  resource: z.string(),
  action: z.enum(accessActions),
  predicate: z.record(z.string(), z.unknown()),
  fields: z.array(z.string()),
});
const roleInput = z
  .object({
    scope: z.string(),
    name: z.string(),
    label: z.string(),
    description: z.string(),
    enabled: z.boolean(),
    expectedRevision: revision,
    grants: z.array(grant),
  })
  .strict();
const role = z.object({
  id: z.string(),
  scope: z.string(),
  name: z.string(),
  label: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  protected: z.boolean(),
  legacy_role: z.string().nullable(),
  source: z.enum(["system", "custom"]).optional(),
  assignedUsers: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.string(),
        email: z.string().nullable(),
      }),
    )
    .optional(),
  grants: z.array(grant.extend({ id: z.string(), roleId: z.string() })),
});
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const failures = {
  403: {
    description: "Forbidden",
    content: { "application/json": { schema: errorSchema } },
  },
  404: {
    description: "Not found",
    content: { "application/json": { schema: errorSchema } },
  },
  409: {
    description: "Policy changed",
    content: { "application/json": { schema: errorSchema } },
  },
  422: {
    description: "Invalid policy",
    content: { "application/json": { schema: errorSchema } },
  },
};
const response = <T extends z.ZodType>(schema: T) => ({
  description: "Success",
  content: { "application/json": { schema } },
});
const scope = (value: string): AccessScope => {
  const parsed = accessScopeSchema.safeParse(value);
  if (!parsed.success)
    throw new AccessControlError(
      422,
      "INVALID_ACCESS_SCOPE",
      "Invalid access scope.",
    );
  return parsed.data;
};
const tags = ["Roles & permissions"];
const base = "/v1/access-control";
const roomForScope = (scope: AccessScope) =>
  tenantRoom(scope === "platform" ? 0 : Number(scope.slice("tenant:".length)));

async function assignedPrincipals(
  database: D1Database,
  roleScope: AccessScope,
  roleId: string,
): Promise<string[]> {
  return (
    await database
      .prepare(
        "SELECT principal_id FROM access_assignments WHERE scope=? AND role_id=?",
      )
      .bind(roleScope, roleId)
      .all<{ principal_id: string }>()
  ).results.map((row) => row.principal_id);
}

function publishAccountRefreshes(
  realtime: RealtimeHubClient | undefined,
  principalIds: string[],
  actor: string,
): void {
  for (const principalId of new Set(principalIds))
    publishRealtime(realtime, principalRoom(principalId), {
      topic: "account",
      type: "updated",
      collection: "security",
      actor,
    });
}

export function registerAccessControlRoutes(
  app: OpenAPIHono,
  db: D1Database,
  realtime?: RealtimeHubClient,
) {
  app.use(base + "/*", async (c, next) => {
    c.header("cache-control", "no-store");
    await next();
  });
  app.openapi(
    createRoute({
      method: "get",
      path: base + "/audit",
      tags,
      request: { query: auditQuerySchema },
      responses: {
        200: response(
          z.object({
            data: z.array(auditEntrySchema),
            nextCursor: z.string().nullable(),
          }),
        ),
        ...failures,
      },
    }),
    async (c) => {
      const q = c.req.valid("query");
      return c.json(
        await listAccessAudit(db, actorFromContext(c), scope(q.scope), q),
        200,
      );
    },
    (result, c) => {
      if (!result.success)
        return c.json(
          {
            error: {
              code: "INVALID_AUDIT_FILTERS",
              message: "Invalid audit filters.",
            },
          },
          422,
        );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: base + "/audit/{id}",
      tags,
      request: {
        query: scopeQuery,
        params: z.object({ id: z.string().min(1).max(256) }),
      },
      responses: { 200: response(auditDetailSchema), ...failures },
    }),
    async (c) =>
      c.json(
        await getAccessAudit(
          db,
          actorFromContext(c),
          scope(c.req.valid("query").scope),
          c.req.valid("param").id,
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: base + "/roles",
      tags,
      request: { query: scopeQuery },
      responses: {
        200: response(z.object({ revision, roles: z.array(role) })),
        ...failures,
      },
    }),
    async (c) =>
      c.json(
        await listAccessRoles(
          db,
          actorFromContext(c),
          scope(c.req.valid("query").scope),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: base + "/roles",
      tags,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: roleInput } },
        },
      },
      responses: {
        201: response(z.object({ id: z.string(), revision })),
        ...failures,
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const actor = actorFromContext(c);
      const roleScope = scope(input.scope);
      const saved = await saveAccessRole(db, actor, {
        ...input,
        scope: roleScope,
        grants: input.grants as Parameters<typeof saveAccessRole>[2]["grants"],
      });
      publishRealtime(realtime, roomForScope(roleScope), {
        topic: "access-control",
        type: "created",
        id: saved.id,
        actor: actor.principal.id,
      });
      return c.json(saved, 201);
    },
  );
  app.openapi(
    createRoute({
      method: "patch",
      path: base + "/roles/{id}",
      tags,
      request: {
        params: z.object({ id: z.string() }),
        body: {
          required: true,
          content: { "application/json": { schema: roleInput } },
        },
      },
      responses: {
        200: response(z.object({ id: z.string(), revision })),
        ...failures,
      },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const actor = actorFromContext(c);
      const roleScope = scope(input.scope);
      const affectedPrincipals = await assignedPrincipals(
        db,
        roleScope,
        c.req.valid("param").id,
      );
      const saved = await saveAccessRole(db, actor, {
        ...input,
        id: c.req.valid("param").id,
        scope: roleScope,
        grants: input.grants as Parameters<typeof saveAccessRole>[2]["grants"],
      });
      publishRealtime(realtime, roomForScope(roleScope), {
        topic: "access-control",
        type: "updated",
        id: saved.id,
        actor: actor.principal.id,
      });
      publishAccountRefreshes(realtime, affectedPrincipals, actor.principal.id);
      return c.json(saved, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "delete",
      path: base + "/roles/{id}",
      tags,
      request: {
        params: z.object({ id: z.string() }),
        query: scopeQuery.extend({
          expectedRevision: z.coerce.number().int().nonnegative(),
        }),
      },
      responses: { 200: response(z.object({ revision })), ...failures },
    }),
    async (c) => {
      const q = c.req.valid("query");
      const actor = actorFromContext(c);
      const roleScope = scope(q.scope);
      const roleId = c.req.valid("param").id;
      const affectedPrincipals = await assignedPrincipals(db, roleScope, roleId);
      const result = await deleteAccessRole(db, actor, {
        id: roleId,
        scope: roleScope,
        expectedRevision: q.expectedRevision,
      });
      publishRealtime(realtime, roomForScope(roleScope), {
        topic: "access-control",
        type: "deleted",
        id: roleId,
        actor: actor.principal.id,
      });
      publishAccountRefreshes(realtime, affectedPrincipals, actor.principal.id);
      return c.json(result, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: base + "/assignments/{principalId}",
      tags,
      request: {
        params: z.object({ principalId: z.string() }),
        query: scopeQuery,
      },
      responses: {
        200: response(z.object({ revision, roleIds: z.array(z.string()) })),
        ...failures,
      },
    }),
    async (c) => {
      const actor = actorFromContext(c),
        s = scope(c.req.valid("query").scope);
      await accessAuthority(db, actor, s, true);
      const rows = await db
        .prepare(
          "SELECT a.role_id FROM access_assignments a JOIN access_roles r ON r.scope=a.scope AND r.id=a.role_id WHERE a.scope=? AND a.principal_id=? AND r.protected=0",
        )
        .bind(s, c.req.valid("param").principalId)
        .all<{ role_id: string }>();
      const policy = await loadAccessPolicy(db, actor, s);
      return c.json(
        {
          revision: policy.revision,
          roleIds: rows.results.map((r) => r.role_id),
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "put",
      path: base + "/assignments/{principalId}",
      tags,
      request: {
        params: z.object({ principalId: z.string() }),
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z
                .object({
                  scope: z.string(),
                  roleIds: z.array(z.string()),
                  expectedRevision: revision,
                })
                .strict(),
            },
          },
        },
      },
      responses: { 200: response(z.object({ revision })), ...failures },
    }),
    async (c) => {
      const input = c.req.valid("json");
      const actor = actorFromContext(c);
      const roleScope = scope(input.scope);
      const principalId = c.req.valid("param").principalId;
      const result = await replaceAccessAssignments(db, actor, {
        ...input,
        scope: roleScope,
        principalId,
      });
      publishRealtime(realtime, roomForScope(roleScope), {
        topic: "access-control",
        type: "updated",
        id: principalId,
        actor: actor.principal.id,
      });
      publishRealtime(realtime, principalRoom(principalId), {
        topic: "account",
        type: "updated",
        collection: "security",
        actor: actor.principal.id,
      });
      return c.json(result, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: base + "/catalog",
      tags,
      request: { query: scopeQuery },
      responses: {
        200: response(
          z.object({
            resources: z.array(
              z.object({
                resource: z.string(),
                label: z.string(),
                fields: z.array(z.string()),
                actions: z.array(z.enum(accessActions)),
                creatorSupported: z.boolean(),
                fieldTypes: z.record(z.string(), z.string()),
                restricted: z.boolean(),
              }),
            ),
          }),
        ),
        ...failures,
      },
    }),
    async (c) => {
      const s = scope(c.req.valid("query").scope);
      await accessAuthority(db, actorFromContext(c), s, true);
      return c.json({ resources: await accessCatalog(db, s) }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: base + "/effective",
      tags,
      request: {
        query: scopeQuery.extend({ principalId: z.string().optional() }),
      },
      responses: {
        200: response(
          z.object({
            principalId: z.string(),
            scope: z.string(),
            revision,
            grants: z.array(
              grant.extend({ id: z.string(), roleId: z.string() }),
            ),
          }),
        ),
        ...failures,
      },
    }),
    async (c) => {
      const q = c.req.valid("query"),
        s = scope(q.scope);
      let actor = actorFromContext(c);
      if (q.principalId && q.principalId !== actor.principal.id) {
        await accessAuthority(db, actor, s, true);
        const principal = await findPrincipal(db, q.principalId);
        if (!principal)
          throw new AccessControlError(
            404,
            "PRINCIPAL_NOT_FOUND",
            "User not found.",
          );
        actor = { ...actor, principal };
      }
      const p = await loadAccessPolicy(db, actor, s);
      return c.json(
        {
          ...p,
          grants: p.grants.map((g) => ({
            ...g,
            predicate: g.predicate as AccessPredicate & Record<string, unknown>,
          })),
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: base + "/members",
      tags,
      request: {
        query: scopeQuery.extend({ q: z.string().max(100).optional() }),
      },
      responses: {
        200: response(
          z.object({
            members: z.array(
              z.object({
                id: z.string(),
                displayName: z.string(),
                email: z.string(),
              }),
            ),
          }),
        ),
        ...failures,
      },
    }),
    async (c) => {
      const q = c.req.valid("query"),
        s = scope(q.scope);
      await accessAuthority(db, actorFromContext(c), s, true);
      const rows = await db
        .prepare(
          'SELECT p.id,p.display_name AS "displayName",p.email FROM identity_principal p WHERE p.is_active=1 AND (CAST(? AS TEXT) IS NULL OR EXISTS(SELECT 1 FROM identity_tenant_membership m WHERE m.principal_id=p.id AND m.tenant_id=? AND m.is_active=1)) AND (p.display_name LIKE ? OR p.email LIKE ?) ORDER BY p.display_name,p.id LIMIT 200',
        )
        .bind(
          s.startsWith("tenant:") ? Number(s.slice(7)) : null,
          s.startsWith("tenant:") ? Number(s.slice(7)) : null,
          "%" + (q.q ?? "") + "%",
          "%" + (q.q ?? "") + "%",
        )
        .all<{ id: string; displayName: string; email: string }>();
      return c.json({ members: rows.results }, 200);
    },
  );
}
