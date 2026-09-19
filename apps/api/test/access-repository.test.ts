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
  ).toContainEqual(expect.objectContaining({ id: role.id, label: "reader" }));
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
    ["domain:platform", "platform"],
    ["agency:101", "tenant:101"],
    ["domain:acl_private", "domain:acl_private"],
  ] as const;
  for (const [tenant, scope] of mappings) {
    await f.db
      .prepare("INSERT OR IGNORE INTO access_revisions(scope) VALUES (?)")
      .bind(scope)
      .run();
    const name = "revision_probe_" + scope.replace(/:/g, "_");
    await f.db
      .prepare(
        "INSERT INTO crm_objects(tenant_id,name,label,config) VALUES (?,?,?,'{}')",
      )
      .bind(tenant, name, name)
      .run();
    for (const sql of [
      "UPDATE crm_objects SET config='{\"fields\":{}}' WHERE tenant_id=? AND name=?",
      "DELETE FROM crm_objects WHERE tenant_id=? AND name=?",
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
