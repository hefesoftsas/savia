import { describe, expect, it } from "vitest";
import { authorizePersonalApiKeyRequest } from "../src/auth/personal-api-key-policy";
import {
  apiKeyScopeSchema,
  createPersonalApiKeySchema,
} from "../src/auth/personal-api-keys";
const prefix = "/v1/studio/12/api/plugin-development";
function authorize(
  path: string,
  method: string,
  scopes: string[],
  tenant = 12,
) {
  authorizePersonalApiKeyRequest(
    new Request(`https://savia.test${path}`, { method }),
    scopes as any,
    tenant,
  );
}
describe("personal key plugin development routes", () => {
  for (const [method, path, required] of [
    ["GET", "/catalog", "plugins:read"],
    ["GET", "/custom.example/checkout?version=1.0.0", "plugins:read"],
    ["POST", "/custom.example/publish", "plugins:publish"],
  ])
    for (const scope of ["plugins:read", "plugins:publish", "records:read"])
      it(`${scope} grants only ${required} for ${method} ${path}`, () => {
        const call = () => authorize(prefix + path, method, [scope]);
        if (required === scope) expect(call).not.toThrow();
        else expect(call).toThrow();
      });
  it("permits capabilities with either plugin scope and binds the tenant", () => {
    for (const scope of ["plugins:read", "plugins:publish"]) {
      expect(() =>
        authorize(prefix + "/capabilities", "GET", [scope]),
      ).not.toThrow();
      expect(() =>
        authorize(prefix + "/capabilities", "GET", [scope], 13),
      ).toThrow();
    }
  });
  it("keeps platform authoring unavailable", () => {
    expect(() =>
      authorize(
        "/v1/studio/0/api/plugin-development/catalog",
        "GET",
        ["plugins:read"],
        0,
      ),
    ).toThrow();
  });
  it("rejects aliases, activation, deletion, path escapes and general Studio access", () => {
    for (const [method, path] of [
      ["GET", "/v1/dynamic-crm/12/api/plugin-development/catalog"],
      ["GET", "/v1/tenants/12/crm/api/plugin-development/catalog"],
      ["GET", "/v1/studio/12/api/objects"],
      ["POST", "/v1/studio/12/api/plugin-store/custom.example/activate"],
      ["DELETE", prefix + "/custom.example/publish"],
      ["POST", prefix + "/custom.example/activate"],
      ["GET", prefix + "/custom%2fexample/checkout"],
      ["GET", prefix + "/catalog/extra"],
    ])
      expect(() =>
        authorize(path, method, ["plugins:read", "plugins:publish"]),
      ).toThrow();
  });
  it("allows explicit mixed scopes without changing existing defaults", () => {
    expect(
      createPersonalApiKeySchema.parse({
        name: "Author",
        tenantId: 12,
        scopes: apiKeyScopeSchema.options,
      }).scopes,
    ).toContain("plugins:publish");
    expect(
      createPersonalApiKeySchema.parse({
        name: "Old",
        tenantId: 12,
        scopes: ["recordings:read"],
      }).scopes,
    ).toEqual(["recordings:read"]);
    expect(
      createPersonalApiKeySchema.safeParse({
        name: "Author",
        tenantId: 12,
        scopes: ["plugins:read", "plugins:publish"],
      }).success,
    ).toBe(true);
  });
});
