import { beforeAll, describe, expect, it } from "vitest";
import {
  createAccessFixture,
  type FixtureRole,
} from "./access-control-fixtures";
import { hasAgencyCapability } from "../src/auth/access-policy";
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
  ] as FixtureRole[])("rejects independent domain for %s", async (role) => {
    expect(
      (await f.request(role, 101, "/v1/data-domains/acl_private/api/objects"))
        .status,
    ).toBe(403);
  });
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
