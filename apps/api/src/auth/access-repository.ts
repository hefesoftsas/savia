import { dialectFor } from "@savia/db/dialect";
import { z } from "@hono/zod-openapi";
import {
  accessGrantSchema,
  accessScopeSchema,
  type AccessScope,
  type AccessGrant,
  type AccessPolicy,
} from "@savia/crm-shared/access-control";
import type { AppActor } from "./types";
import { accessAuthority } from "./access-context";
import {
  AccessControlError,
  validateAccessGrants,
  denyAccess,
} from "./access-registry";
import { compatibilityGrants } from "./access-compatibility";

export type SaveAccessRole = {
  scope: AccessScope;
  id?: string;
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  expectedRevision: number;
  grants: Array<Omit<AccessGrant, "id" | "roleId">>;
};
export type ReplaceAccessAssignments = {
  scope: AccessScope;
  principalId: string;
  roleIds: string[];
  expectedRevision: number;
};
export const saveAccessRoleSchema = z
  .object({
    scope: accessScopeSchema,
    id: z.string().min(1).max(200).optional(),
    name: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    label: z.string().trim().min(1).max(120),
    description: z.string().max(1000),
    enabled: z.boolean(),
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    grants: z
      .array(accessGrantSchema.omit({ id: true, roleId: true }))
      .max(200),
  })
  .strict();
export const replaceAccessAssignmentsSchema = z
  .object({
    scope: accessScopeSchema,
    principalId: z.string().min(1).max(200),
    roleIds: z.array(z.string().min(1).max(200)).max(100),
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
type RoleRow = {
  id: string;
  scope: AccessScope;
  name: string;
  label: string;
  description: string;
  enabled: number;
  protected: number;
  legacy_role: string | null;
};
const revision = async (db: D1Database, scope: AccessScope) =>
  (
    await db
      .prepare("SELECT revision FROM access_revisions WHERE scope=?")
      .bind(scope)
      .first<{ revision: number }>()
  )?.revision ?? 0;
const parseRole = (r: RoleRow) => ({
  ...r,
  enabled: Boolean(r.enabled),
  protected: Boolean(r.protected),
});
async function grantsForRoles(
  db: D1Database,
  scope: AccessScope,
  ids: string[],
): Promise<AccessGrant[]> {
  if (!ids.length) return [];
  const rows = await db
    .prepare(
      `SELECT * FROM access_grants WHERE scope=? AND role_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,
    )
    .bind(scope, ...ids)
    .all<{
      id: string;
      role_id: string;
      resource: AccessGrant["resource"];
      action: AccessGrant["action"];
      predicate: string;
      fields: string;
    }>();
  return rows.results.map((r) =>
    accessGrantSchema.parse({
      id: r.id,
      roleId: r.role_id,
      resource: r.resource,
      action: r.action,
      predicate: JSON.parse(r.predicate),
      fields: JSON.parse(r.fields),
    }),
  );
}
export async function loadAccessPolicy(
  db: D1Database,
  actor: AppActor,
  scope: AccessScope,
): Promise<AccessPolicy> {
  // A read bracket avoids mixing role data with a newer revision. Retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await revision(db, scope);
    const authority = await accessAuthority(db, actor, scope);
    const roles = await db
      .prepare(
        "SELECT r.id FROM access_assignments a JOIN access_roles r ON r.scope=a.scope AND r.id=a.role_id WHERE a.scope=? AND a.principal_id=? AND r.enabled=1 AND r.protected=0",
      )
      .bind(scope, actor.principal.id)
      .all<{ id: string }>();
    const grants = [
      ...(await compatibilityGrants(db, scope, authority)),
      ...(await grantsForRoles(
        db,
        scope,
        roles.results.map((r) => r.id),
      )),
    ];
    if (before === (await revision(db, scope)))
      return {
        principalId: actor.principal.id,
        scope,
        revision: before,
        grants,
      };
  }
  throw new AccessControlError(
    409,
    "ACCESS_CHANGED",
    "Permissions changed. Retry this request.",
  );
}
export async function listAccessRoles(
  db: D1Database,
  actor: AppActor,
  scope: AccessScope,
) {
  await accessAuthority(db, actor, scope, true);
  const rows = await db
    .prepare(
      "SELECT * FROM access_roles WHERE scope=? ORDER BY protected DESC,label,id",
    )
    .bind(scope)
    .all<RoleRow>();
  const grants = await grantsForRoles(
    db,
    scope,
    rows.results.map((r) => r.id),
  );
  return {
    revision: await revision(db, scope),
    roles: rows.results.map((r) => ({
      ...parseRole(r),
      grants: grants.filter((g) => g.roleId === r.id),
    })),
  };
}
async function mutableRole(db: D1Database, scope: AccessScope, id: string) {
  const row = await db
    .prepare("SELECT * FROM access_roles WHERE scope=? AND id=?")
    .bind(scope, id)
    .first<RoleRow>();
  if (!row)
    throw new AccessControlError(
      404,
      "ACCESS_ROLE_NOT_FOUND",
      "Role not found.",
    );
  if (row.protected) return denyAccess();
  return row;
}
async function commitPolicy(
  db: D1Database,
  actor: AppActor,
  scope: AccessScope,
  expectedRevision: number,
  action: string,
  target: string,
  before: unknown,
  after: unknown,
  statements: D1PreparedStatement[],
) {
  const guard = crypto.randomUUID();
  const tenant = scope.startsWith("tenant:") ? Number(scope.slice(7)) : -1;
  const authorization = db
    .prepare(
      "INSERT INTO crm_write_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM identity_principal p WHERE p.id=? AND p.is_active=1 AND (EXISTS(SELECT 1 FROM identity_global_role g WHERE g.principal_id=p.id AND g.role='platform_admin') OR EXISTS(SELECT 1 FROM identity_tenant_membership m JOIN tenants t ON t.id=m.tenant_id WHERE m.principal_id=p.id AND m.tenant_id=? AND m.is_active=1 AND t.is_active=1 AND m.role IN ('tenant_admin','agency_admin')))) THEN 1 ELSE 0 END",
    )
    .bind(guard, actor.principal.id, tenant);
  const revisionGuard = crypto.randomUUID();
  try {
    await db.batch([
      authorization,
      db
        .prepare(
          dialectFor(db).name === "postgres"
            ? "INSERT INTO access_revisions(scope,revision) VALUES (?,0) ON CONFLICT (scope) DO NOTHING"
            : "INSERT OR IGNORE INTO access_revisions(scope,revision) VALUES (?,0)",
        )
        .bind(scope),
      db
        .prepare(
          "INSERT INTO crm_write_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM access_revisions WHERE scope=? AND revision=?) THEN 1 ELSE 0 END",
        )
        .bind(revisionGuard, scope, expectedRevision),
      db
        .prepare(
          "UPDATE access_revisions SET revision=revision+1 WHERE scope=? AND revision=?",
        )
        .bind(scope, expectedRevision),
      ...statements,
      db
        .prepare(
          "INSERT INTO access_audit(id,scope,actor_id,action,target_id,before_state,after_state) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          scope,
          actor.principal.id,
          action,
          target,
          JSON.stringify(before),
          JSON.stringify(after),
        ),
      db
        .prepare("DELETE FROM crm_write_guards WHERE id IN (?,?)")
        .bind(guard, revisionGuard),
    ]);
  } catch (error) {
    if (/constraint|crm_write_guards/i.test(String(error)))
      throw new AccessControlError(
        409,
        "ACCESS_CHANGED",
        "The policy or membership changed. Reload before saving.",
      );
    throw error;
  }
  return { revision: expectedRevision + 1 };
}
export async function saveAccessRole(
  db: D1Database,
  actor: AppActor,
  input: SaveAccessRole,
) {
  const parsed = saveAccessRoleSchema.safeParse(input);
  if (!parsed.success)
    throw new AccessControlError(
      422,
      "INVALID_ACCESS_POLICY",
      "Invalid role policy.",
    );
  input = parsed.data;
  await accessAuthority(db, actor, input.scope, true);
  await validateAccessGrants(db, input.scope, input.grants);
  const old = input.id ? await mutableRole(db, input.scope, input.id) : null;
  const oldGrants = old
    ? (
        await db
          .prepare(
            "SELECT resource,action,predicate,fields FROM access_grants WHERE scope=? AND role_id=?",
          )
          .bind(input.scope, old.id)
          .all()
      ).results
    : [];
  const id = input.id ?? crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO access_roles(id,scope,name,label,description,enabled) VALUES (?,?,?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET name=excluded.name,label=excluded.label,description=excluded.description,enabled=excluded.enabled WHERE access_roles.protected=0",
      )
      .bind(
        id,
        input.scope,
        input.name,
        input.label,
        input.description,
        Number(input.enabled),
      ),
    db
      .prepare("DELETE FROM access_grants WHERE scope=? AND role_id=?")
      .bind(input.scope, id),
    ...input.grants.map((g) =>
      db
        .prepare(
          "INSERT INTO access_grants(id,scope,role_id,resource,action,predicate,fields) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          input.scope,
          id,
          g.resource,
          g.action,
          JSON.stringify(g.predicate),
          JSON.stringify([...new Set(g.fields)]),
        ),
    ),
  ];
  const result = await commitPolicy(
    db,
    actor,
    input.scope,
    input.expectedRevision,
    "role.saved",
    id,
    old ? { ...old, grants: oldGrants } : null,
    { ...input, id },
    statements,
  );
  return { id, ...result };
}
export async function replaceAccessAssignments(
  db: D1Database,
  actor: AppActor,
  input: ReplaceAccessAssignments,
) {
  const parsed = replaceAccessAssignmentsSchema.safeParse(input);
  if (!parsed.success)
    throw new AccessControlError(
      422,
      "INVALID_ACCESS_ASSIGNMENTS",
      "Invalid role assignment.",
    );
  input = parsed.data;
  await accessAuthority(db, actor, input.scope, true);
  const target = await db
    .prepare("SELECT id FROM identity_principal WHERE id=? AND is_active=1")
    .bind(input.principalId)
    .first();
  if (!target) return denyAccess();
  if (
    input.scope.startsWith("tenant:") &&
    !(await db
      .prepare(
        "SELECT id FROM identity_tenant_membership WHERE principal_id=? AND tenant_id=? AND is_active=1",
      )
      .bind(input.principalId, Number(input.scope.slice(7)))
      .first())
  )
    return denyAccess();
  const roleIds = [...new Set(input.roleIds)];
  for (const id of roleIds) {
    const role = await db
      .prepare(
        "SELECT id FROM access_roles WHERE scope=? AND id=? AND enabled=1 AND protected=0",
      )
      .bind(input.scope, id)
      .first();
    if (!role)
      throw new AccessControlError(
        422,
        "INVALID_ACCESS_ROLE",
        "Only enabled business roles in this scope may be assigned.",
      );
  }
  const before = await db
    .prepare(
      "SELECT role_id FROM access_assignments WHERE scope=? AND principal_id=?",
    )
    .bind(input.scope, input.principalId)
    .all();
  const guard = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO crm_write_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM identity_principal p WHERE p.id=? AND p.is_active=1) THEN 1 ELSE 0 END",
      )
      .bind(guard, input.principalId),
    db
      .prepare(
        "DELETE FROM access_assignments WHERE scope=? AND principal_id=? AND role_id IN (SELECT id FROM access_roles WHERE scope=? AND protected=0)",
      )
      .bind(input.scope, input.principalId, input.scope),
    ...roleIds.map((id) =>
      db
        .prepare(
          "INSERT INTO access_assignments(scope,principal_id,role_id) VALUES (?,?,?)",
        )
        .bind(input.scope, input.principalId, id),
    ),
    db.prepare("DELETE FROM crm_write_guards WHERE id=?").bind(guard),
  ];
  if (input.scope.startsWith("tenant:")) {
    const membershipGuard = crypto.randomUUID();
    statements.unshift(
      db
        .prepare(
          "INSERT INTO crm_write_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM identity_tenant_membership WHERE principal_id=? AND tenant_id=? AND is_active=1) THEN 1 ELSE 0 END",
        )
        .bind(membershipGuard, input.principalId, Number(input.scope.slice(7))),
    );
    statements.push(
      db
        .prepare("DELETE FROM crm_write_guards WHERE id=?")
        .bind(membershipGuard),
    );
  }
  return commitPolicy(
    db,
    actor,
    input.scope,
    input.expectedRevision,
    "assignments.saved",
    input.principalId,
    before.results,
    roleIds,
    statements,
  );
}
export async function deleteAccessRole(
  db: D1Database,
  actor: AppActor,
  input: { scope: AccessScope; id: string; expectedRevision: number },
) {
  await accessAuthority(db, actor, input.scope, true);
  const role = await mutableRole(db, input.scope, input.id);
  return commitPolicy(
    db,
    actor,
    input.scope,
    input.expectedRevision,
    "role.deleted",
    input.id,
    role,
    null,
    [
      db
        .prepare(
          "DELETE FROM access_roles WHERE scope=? AND id=? AND protected=0",
        )
        .bind(input.scope, input.id),
    ],
  );
}
