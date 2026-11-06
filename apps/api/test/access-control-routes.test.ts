import { beforeAll, it, expect } from "vitest";
import { createAccessFixture } from "./access-control-fixtures";
import { createTestApp } from "./test-app";
import type { RealtimeHubClient } from "../src/realtime/hub-client";
let f: Awaited<ReturnType<typeof createAccessFixture>>;
beforeAll(async () => {
  f = await createAccessFixture();
});
const prefix = "/v1/access-control";
it("lets agency administrators create and assign business roles", async () => {
  const listed = await f.request(
    "agency_admin",
    101,
    prefix + "/roles?scope=tenant:101",
  );
  expect(listed.status).toBe(200);
  const { revision } = (await listed.json()) as { revision: number };
  const created = await f.request("agency_admin", 101, prefix + "/roles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "tenant:101",
      name: "claims",
      label: "Claims reviewer",
      description: "",
      enabled: true,
      expectedRevision: revision,
      grants: [
        {
          resource: "collection:acl_contacts",
          action: "read",
          predicate: { all: true },
          fields: ["name"],
        },
      ],
    }),
  });
  expect(created.status).toBe(201);
  const role = (await created.json()) as { id: string; revision: number };
  const assigned = await f.request(
    "agency_admin",
    101,
    prefix + "/assignments/" + f.principalId("viewer"),
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "tenant:101",
        roleIds: [role.id],
        expectedRevision: role.revision,
      }),
    },
  );
  expect(assigned.status).toBe(200);
  const effective = await f.request(
    "viewer",
    101,
    prefix + "/effective?scope=tenant:101",
  );
  expect(effective.status).toBe(200);
  expect(effective.headers.get("cache-control")).toBe("no-store");
  expect(await effective.text()).toContain("collection:acl_contacts");
});
it("blocks foreign scopes and previewing other users", async () => {
  expect(
    (await f.request("agency_admin", 101, prefix + "/roles?scope=tenant:102"))
      .status,
  ).toBe(403);
  expect(
    (await f.request("viewer", 101, prefix + "/roles?scope=tenant:101")).status,
  ).toBe(403);
  expect(
    (
      await f.request(
        "viewer",
        101,
        prefix +
          "/effective?scope=tenant:101&principalId=" +
          f.principalId("agency_admin"),
      )
    ).status,
  ).toBe(403);
});
it("returns derived system roles through the validated roles endpoint", async () => {
  const response = await f.request(
    "platform_admin",
    102,
    prefix + "/roles?scope=tenant:102",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    roles: [
      {
        id: "builtin:tenant:102:platform_admin",
        source: "system",
        protected: true,
        assignedUsers: [
          expect.objectContaining({ id: f.principalId("platform_admin") }),
        ],
      },
    ],
  });
});
it("creates an empty-grant custom role in tenant:0 through the API", async () => {
  const list = await f.request(
    "platform_admin",
    101,
    prefix + "/roles?scope=tenant:0",
  );
  expect(list.status).toBe(200);
  const { revision } = (await list.json()) as { revision: number };
  const response = await f.request("platform_admin", 101, prefix + "/roles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "tenant:0",
      name: "ui_creation_check",
      label: "UI creation check",
      description: "",
      enabled: true,
      expectedRevision: revision,
      grants: [],
    }),
  });
  expect(response.status).toBe(201);
});
it("returns only scope members and rejects stale updates", async () => {
  const members = await f.request(
    "agency_admin",
    101,
    prefix + "/members?scope=tenant:101",
  );
  expect(members.status).toBe(200);
  expect(await members.text()).toContain(f.principalId("viewer"));
  const stale = await f.request("agency_admin", 101, prefix + "/roles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "tenant:101",
      name: "stale",
      label: "Stale",
      description: "",
      enabled: true,
      expectedRevision: 0,
      grants: [],
    }),
  });
  expect(stale.status).toBe(409);
});

it("publishes tenant-scoped hints after successful role and assignment changes", async () => {
  const published: Array<{ room: string; event: Record<string, unknown> }> = [];
  const hub: RealtimeHubClient = {
    publish(room, event) {
      published.push({ room, event });
    },
    async issue() {
      return { ticket: "ticket", expiresAt: new Date().toISOString() };
    },
    async forward() {
      return new Response(null, { status: 204 });
    },
  };
  const actor = await f.actor("agency_admin");
  const app = createTestApp({
    auth: { authenticate: async () => actor },
    realtime: hub,
  });
  const current = await app.request(prefix + "/roles?scope=tenant:101");
  const { revision } = (await current.json()) as { revision: number };
  const created = await app.request(prefix + "/roles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "tenant:101",
      name: "realtime_role",
      label: "Realtime role",
      description: "",
      enabled: true,
      expectedRevision: revision,
      grants: [],
    }),
  });
  expect(created.status).toBe(201);
  const role = (await created.json()) as { id: string; revision: number };

  const invalidUpdate = await app.request(prefix + "/roles/" + role.id, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "tenant:101",
      name: "realtime_role",
      label: "Stale role",
      description: "",
      enabled: true,
      expectedRevision: revision,
      grants: [],
    }),
  });
  expect(invalidUpdate.status).toBe(409);
  expect(published).toHaveLength(1);

  const assignment = await app.request(
    prefix + "/assignments/" + f.principalId("viewer"),
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "tenant:101",
        roleIds: [role.id],
        expectedRevision: role.revision,
      }),
    },
  );
  expect(assignment.status).toBe(200);
  const assigned = (await assignment.json()) as { revision: number };

  const updated = await app.request(prefix + "/roles/" + role.id, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "tenant:101",
      name: "realtime_role",
      label: "Updated realtime role",
      description: "",
      enabled: true,
      expectedRevision: assigned.revision,
      grants: [],
    }),
  });
  expect(updated.status).toBe(200);
  const saved = (await updated.json()) as { revision: number };
  const deleted = await app.request(
    `${prefix}/roles/${role.id}?scope=tenant:101&expectedRevision=${saved.revision}`,
    { method: "DELETE" },
  );
  expect(deleted.status).toBe(200);
  expect(published.map(({ room, event }) => [room, event.topic, event.type, event.id])).toEqual([
    ["tenant:101", "access-control", "created", role.id],
    ["tenant:101", "access-control", "updated", f.principalId("viewer")],
    ["principal:" + f.principalId("viewer"), "account", "updated", undefined],
    ["tenant:101", "access-control", "updated", role.id],
    ["principal:" + f.principalId("viewer"), "account", "updated", undefined],
    ["tenant:101", "access-control", "deleted", role.id],
    ["principal:" + f.principalId("viewer"), "account", "updated", undefined],
  ]);
});
