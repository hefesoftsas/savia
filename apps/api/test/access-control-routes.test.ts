import { beforeAll, it, expect } from "vitest";
import { createAccessFixture } from "./access-control-fixtures";
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
