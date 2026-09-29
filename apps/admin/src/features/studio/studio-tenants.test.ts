import { describe, expect, it } from "vitest";
import { selectStudioTenant, type StudioTenant } from "./studio-tenants";

const tenants: StudioTenant[] = [
  {
    id: "tenant:0",
    tenantId: 0,
    label: "Platform",
    kind: "platform",
    apiBasePath: "/v1/studio/0",
  },
  {
    id: "tenant:7",
    tenantId: 7,
    label: "North",
    kind: "tenant",
    apiBasePath: "/v1/studio/7",
  },
];

describe("Studio tenant selection", () => {
  it("selects an explicitly requested tenant, including reserved tenant zero", () => {
    expect(selectStudioTenant(tenants, 0)?.id).toBe("tenant:0");
    expect(selectStudioTenant(tenants, 7)?.id).toBe("tenant:7");
  });

  it("does not invent a tenant when the requested id is absent", () => {
    expect(selectStudioTenant(tenants, 9)).toBeUndefined();
  });
});
