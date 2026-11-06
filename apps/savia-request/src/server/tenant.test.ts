import { expect, it } from "vitest";
import requestApp from "./index";
import { normalizeTenantId, tenantFromRequest } from "./tenant";

it("accepts canonical tenant identities and the shared package catalog", () => {
  expect(normalizeTenantId("tenant:0")).toBe("tenant:0");
  expect(normalizeTenantId("tenant:101")).toBe("tenant:101");
  expect(normalizeTenantId(undefined)).toBe("");
});
it.each([
  "domain:platform",
  "domain:research",
  "agency:101",
  "tenant:01",
  "tenant:9007199254740992",
])("rejects retired or invalid scope %s", async (scope) => {
  expect(() => normalizeTenantId(scope)).toThrow();
  const request = new Request(
    "https://savia-request.internal/api/flows?tenant=" +
      encodeURIComponent(scope),
  );
  expect(() => tenantFromRequest(request)).toThrow();
  expect((await requestApp.fetch(request)).status).toBe(400);
});
