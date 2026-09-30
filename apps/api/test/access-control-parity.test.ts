import { beforeAll, describe, expect, it } from "vitest";
import {
  createAccessFixture,
  type FixtureRole,
} from "./access-control-fixtures";
import { hasAgencyCapability } from "../src/auth/access-policy";
import { makeConfig } from "@savia/studio-shared/metadata";
let f: Awaited<ReturnType<typeof createAccessFixture>>;
beforeAll(async () => {
  f = await createAccessFixture();
});
describe("legacy authorization compatibility", () => {
  it.each([
    "tenant_admin",
    "agency_admin",
    "operator",
    "viewer",
  ] as FixtureRole[])("rejects foreign tenant for %s", async (role) => {
    expect(
      (
        await f.request(
          role,
          101,
          "/v1/dynamic-crm/102/api/records/acl_contacts",
        )
      ).status,
    ).toBe(403);
  });
  it.each([
    ["platform_admin", 200],
    ["tenant_admin", 200],
    ["agency_admin", 200],
    ["operator", 403],
    ["viewer", 403],
  ] as const)(
    "preserves native collection access for %s",
    async (role, status) => {
      const response = await f.request(
        role,
        101,
        "/v1/dynamic-crm/101/api/records/acl_contacts",
      );
      expect(response.status).toBe(status);
      if (status === 200) {
        const body = await response.text();
        expect(body).toContain("Tenant 101");
        expect(body).not.toContain("Tenant 102");
      }
    },
  );
  it.each([
    "tenant_admin",
    "agency_admin",
    "operator",
    "viewer",
  ] as FixtureRole[])(
    "rejects removed data-domain route for %s",
    async (role) => {
      expect(
        (await f.request(role, 101, "/v1/data-domains/acl_private/api/objects"))
          .status,
      ).toBe(404);
    },
  );
  it.each([
    ["tenant_admin", true, true],
    ["agency_admin", true, true],
    ["operator", true, false],
    ["viewer", false, false],
  ] as const)(
    "preserves operational customer capabilities for %s",
    async (role, write, remove) => {
      const a = await f.actor(role);
      expect(hasAgencyCapability(a, 101, "customers:create")).toBe(write);
      expect(hasAgencyCapability(a, 101, "customers:update")).toBe(write);
      expect(hasAgencyCapability(a, 101, "customers:delete")).toBe(remove);
      expect(hasAgencyCapability(a, 102, "customers:update")).toBe(false);
    },
  );
});

it.each([
  ["platform_admin", 200],
  ["tenant_admin", 200],
  ["agency_admin", 200],
  ["operator", 403],
  ["viewer", 403],
] as const)(
  "restricts screen deletion previews to administrators: %s",
  async (role, status) => {
    const response = await f.request(
      role,
      101,
      "/v1/studio/101/api/objects/acl_contacts/deletion-preview",
    );
    expect(response.status).toBe(status);
    if (status === 200) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({
        data: {
          root: "acl_contacts",
          totalRecords: 1,
          screens: [{ name: "acl_contacts", recordCount: 1 }],
        },
      });
    }
  },
);

it("limits tenant-admin screen creation and metadata access to its own tenant", async () => {
  const ownScreen = "acl_tenant_admin_screen";
  const globalScreen = "acl_global_screen";
  await f.db
    .prepare(
      "INSERT INTO studio_objects(tenant_id,name,label,description,config,version) VALUES ('tenant:0',?,?, '', ?, 1)",
    )
    .bind(
      globalScreen,
      "Global screen",
      JSON.stringify(makeConfig({ name: { type: "Textbox", label: "Name" } })),
    )
    .run();

  const headers = { "content-type": "application/json" };
  const created = await f.request(
    "tenant_admin",
    101,
    "/v1/studio/101/api/objects",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: ownScreen,
        label: "Tenant screen",
        config: makeConfig({ name: { type: "Textbox", label: "Name" } }),
      }),
    },
  );
  expect(created.status).toBe(201);

  const ownList = await f.request(
    "tenant_admin",
    101,
    "/v1/studio/101/api/objects",
  );
  expect(ownList.status).toBe(200);
  expect(await ownList.text()).toContain(ownScreen);

  for (const tenantId of [102, 0]) {
    const expectedStatus = tenantId === 0 ? 404 : 403;
    const path = `/v1/studio/${tenantId}/api`;
    const createResponse = await f.request(
      "tenant_admin",
      101,
      `${path}/objects`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: `acl_forbidden_screen_${tenantId}`,
          label: "Forbidden screen",
          config: makeConfig({ name: { type: "Textbox", label: "Name" } }),
        }),
      },
    );
    expect(createResponse.status).toBe(expectedStatus);

    const listResponse = await f.request(
      "tenant_admin",
      101,
      `${path}/objects`,
    );
    expect(listResponse.status).toBe(expectedStatus);

    const target = tenantId === 0 ? globalScreen : "acl_contacts";
    const editResponse = await f.request(
      "tenant_admin",
      101,
      `${path}/objects/${target}/screen`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ label: "Unauthorized edit" }),
      },
    );
    expect(editResponse.status).toBe(expectedStatus);
  }

  const [foreignObject, globalObject, forbiddenObjects] = await Promise.all([
    f.db
      .prepare("SELECT label FROM studio_objects WHERE tenant_id='tenant:102' AND name='acl_contacts'")
      .first<{ label: string }>(),
    f.db
      .prepare("SELECT label FROM studio_objects WHERE tenant_id='tenant:0' AND name=?")
      .bind(globalScreen)
      .first<{ label: string }>(),
    f.db
      .prepare("SELECT count(*) AS count FROM studio_objects WHERE name IN ('acl_forbidden_screen_102','acl_forbidden_screen_0')")
      .first<{ count: number }>(),
  ]);
  expect(foreignObject?.label).toBe("ACL contacts");
  expect(globalObject?.label).toBe("Global screen");
  expect(forbiddenObjects?.count).toBe(0);
});
