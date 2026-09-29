import { beforeAll, it, expect } from "vitest";
import { createAccessFixture } from "./access-control-fixtures";
import {
  saveAccessRole,
  replaceAccessAssignments,
  loadAccessPolicy,
  listAccessRoles,
  deleteAccessRole,
} from "../src/auth/access-repository";
let f: Awaited<ReturnType<typeof createAccessFixture>>;
beforeAll(async () => {
  f = await createAccessFixture();
});
const draft = (name: string, revision: number) => ({
  scope: "tenant:101" as const,
  name,
  label: name,
  description: "",
  enabled: true,
  expectedRevision: revision,
  grants: [
    {
      resource: "collection:acl_contacts" as const,
      action: "read" as const,
      predicate: { all: true as const },
      fields: ["name"],
    },
  ],
});
it("stores scoped roles and authorizes only assigned fields", async () => {
  const admin = await f.actor("agency_admin");
  const revision = (await loadAccessPolicy(f.db, admin, "tenant:101")).revision;
  const role = await saveAccessRole(f.db, admin, draft("reader", revision));
  const saved = await replaceAccessAssignments(f.db, admin, {
    scope: "tenant:101",
    principalId: f.principalId("viewer"),
    roleIds: [role.id],
    expectedRevision: role.revision,
  });
  const policy = await loadAccessPolicy(
    f.db,
    await f.actor("viewer"),
    "tenant:101",
  );
  expect(policy.revision).toBe(saved.revision);
  expect(
    policy.grants.filter((g) => g.resource === "collection:acl_contacts"),
  ).toEqual([expect.objectContaining({ fields: ["name"], action: "read" })]);
  expect(
    (await listAccessRoles(f.db, admin, "tenant:101")).roles,
  ).toContainEqual(
    expect.objectContaining({
      id: role.id,
      label: "reader",
      source: "custom",
      assignedUsers: [
        expect.objectContaining({ id: f.principalId("viewer") }),
      ],
    }),
  );
});
it("lists read-only system roles with the same grants as effective access", async () => {
  const admin = await f.actor("platform_admin");
  const listed = await listAccessRoles(f.db, admin, "tenant:102");
  expect(listed.roles).toHaveLength(1);
  const platformRole = listed.roles[0]!;
  expect(platformRole).toMatchObject({
    id: "builtin:tenant:102:platform_admin",
    scope: "tenant:102",
    name: "platform_admin",
    label: "Platform administrator",
    legacy_role: "platform_admin",
    source: "system",
    enabled: true,
    protected: true,
    assignedUsers: [
      expect.objectContaining({ id: f.principalId("platform_admin") }),
    ],
  });
  const policy = await loadAccessPolicy(f.db, admin, "tenant:102");
  expect(platformRole.grants).toEqual(
    policy.grants.filter((grant) => grant.roleId === platformRole.id),
  );
  await expect(
    deleteAccessRole(f.db, admin, {
      scope: "tenant:102",
      id: platformRole.id,
      expectedRevision: listed.revision,
    }),
  ).rejects.toMatchObject({ status: 404 });
});
it("lists only memberships belonging to the requested tenant scope", async () => {
  const admin = await f.actor("platform_admin");
  const tenant101 = await listAccessRoles(f.db, admin, "tenant:101");
  const agencyAdmin = tenant101.roles.find(
    (role) => role.id === "builtin:tenant:101:agency_admin",
  );
  expect(agencyAdmin?.assignedUsers.map((user) => user.id)).toEqual([
    f.principalId("agency_admin"),
  ]);
  const tenant102 = await listAccessRoles(f.db, admin, "tenant:102");
  expect(
    tenant102.roles.flatMap((role) => role.assignedUsers.map((user) => user.id)),
  ).not.toContain(f.principalId("agency_admin"));
  expect(
    tenant102.roles.find((role) => role.name === "platform_admin")
      ?.assignedUsers.map((user) => user.id),
  ).toEqual([f.principalId("platform_admin")]);
});
it("rejects foreign scopes and administrative escalation", async () => {
  const admin = await f.actor("agency_admin");
  await expect(
    saveAccessRole(f.db, admin, {
      ...draft("foreign", 0),
      scope: "tenant:102",
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    saveAccessRole(f.db, admin, {
      ...draft("escalate", 0),
      grants: [
        {
          resource: "capability:identity.manage",
          action: "manage",
          predicate: { all: true },
          fields: [],
        },
      ],
    }),
  ).rejects.toMatchObject({ status: 422 });
});
it("rejects unknown collections and fields", async () => {
  const admin = await f.actor("agency_admin");
  const revision = (await loadAccessPolicy(f.db, admin, "tenant:101")).revision;
  await expect(
    saveAccessRole(f.db, admin, {
      ...draft("invalid", revision),
      grants: [
        {
          resource: "collection:missing",
          action: "read",
          predicate: { all: true },
          fields: ["name"],
        },
      ],
    }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    saveAccessRole(f.db, admin, {
      ...draft("invalid", revision),
      grants: [
        {
          resource: "collection:acl_contacts",
          action: "read",
          predicate: { all: true },
          fields: ["hidden_fake"],
        },
      ],
    }),
  ).rejects.toMatchObject({ status: 422 });
});

it("creates an empty-grant custom role in the platform tenant scope", async () => {
  const admin = await f.actor("platform_admin");
  const policy = await loadAccessPolicy(f.db, admin, "tenant:0");
  await expect(
    saveAccessRole(f.db, admin, {
      scope: "tenant:0",
      name: "ui_creation_check",
      label: "UI creation check",
      description: "",
      enabled: true,
      expectedRevision: policy.revision,
      grants: [],
    }),
  ).resolves.toMatchObject({ revision: policy.revision + 1 });
});
it("fails stale writes atomically", async () => {
  const admin = await f.actor("agency_admin"),
    revision = (await loadAccessPolicy(f.db, admin, "tenant:101")).revision;
  const outcomes = await Promise.allSettled([
    saveAccessRole(f.db, admin, draft("race_a", revision)),
    saveAccessRole(f.db, admin, draft("race_b", revision)),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (
      await f.db
        .prepare(
          "SELECT name FROM access_roles WHERE name IN ('race_a','race_b')",
        )
        .all()
    ).results,
  ).toHaveLength(1);
});
it("keeps protected roles immutable and denies foreign assignments", async () => {
  const admin = await f.actor("agency_admin"),
    listed = await listAccessRoles(f.db, admin, "tenant:101");
  const protectedRole = listed.roles.find((r) => r.protected)!;
  await expect(
    deleteAccessRole(f.db, admin, {
      scope: "tenant:101",
      id: protectedRole.id,
      expectedRevision: listed.revision,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    replaceAccessAssignments(f.db, admin, {
      scope: "tenant:101",
      principalId: f.principalId("viewer"),
      roleIds: ["builtin:tenant:102:viewer"],
      expectedRevision: listed.revision,
    }),
  ).rejects.toMatchObject({ status: 422 });
});
it("stops resolving grants after membership suspension", async () => {
  const viewer = await f.actor("viewer");
  await f.db
    .prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=?",
    )
    .bind(viewer.principal.id)
    .run();
  await expect(
    loadAccessPolicy(f.db, viewer, "tenant:101"),
  ).rejects.toMatchObject({ status: 403 });
  await f.db
    .prepare(
      "UPDATE identity_tenant_membership SET is_active=1 WHERE principal_id=?",
    )
    .bind(viewer.principal.id)
    .run();
});

it("invalidates only the mapped policy scope when collection schemas change or disappear", async () => {
  const mappings = [
    ["tenant:0", "tenant:0"],
    ["tenant:101", "tenant:101"],
    ["tenant:999", "tenant:999"],
  ] as const;
  for (const [tenant, scope] of mappings) {
    await f.db
      .prepare("INSERT OR IGNORE INTO access_revisions(scope) VALUES (?)")
      .bind(scope)
      .run();
    const name = "revision_probe_" + scope.replace(/:/g, "_");
    await f.db
      .prepare(
        "INSERT INTO studio_objects(tenant_id,name,label,config) VALUES (?,?,?,'{}')",
      )
      .bind(tenant, name, name)
      .run();
    for (const sql of [
      "UPDATE studio_objects SET config='{\"fields\":{}}' WHERE tenant_id=? AND name=?",
      "DELETE FROM studio_objects WHERE tenant_id=? AND name=?",
    ]) {
      const before = (
        await f.db
          .prepare("SELECT scope,revision FROM access_revisions ORDER BY scope")
          .all<{ scope: string; revision: number }>()
      ).results;
      await f.db.prepare(sql).bind(tenant, name).run();
      const after = (
        await f.db
          .prepare("SELECT scope,revision FROM access_revisions ORDER BY scope")
          .all<{ scope: string; revision: number }>()
      ).results;
      expect(after).toEqual(
        before.map((row) => ({
          ...row,
          revision: row.revision + (row.scope === scope ? 1 : 0),
        })),
      );
    }
  }
});
