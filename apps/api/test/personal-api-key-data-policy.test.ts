import { describe, expect, it } from "vitest";
import { authorizePersonalApiKeyRequest } from "../src/auth/personal-api-key-policy";
import { createPersonalApiKeySchema } from "../src/auth/personal-api-keys";
const id = "10b438d1-8b7f-4a92-a554-254dc67159a3";
const scopes = ["records:read", "records:create", "records:update"] as const;
const prefixes = [
  "/v1/studio/101/api",
  "/v1/dynamic-crm/101/api",
  "/v1/tenants/101/crm/api",
];
function authorize(
  path: string,
  method: string,
  granted: readonly string[],
  tenantId = 101,
) {
  return authorizePersonalApiKeyRequest(
    new Request(`https://savia.test${path}`, { method }),
    granted as any,
    tenantId,
  );
}
describe("personal key native data routes", () => {
  for (const prefix of prefixes) {
    for (const [method, suffix, required] of [
      ["GET", "/objects", "records:read"],
      ["GET", "/records/contacts", "records:read"],
      ["GET", `/records/contacts/${id}`, "records:read"],
      ["POST", "/records/contacts", "records:create"],
      ["PATCH", `/records/contacts/${id}`, "records:update"],
    ])
      for (const scope of scopes)
        it(`${scope} authorizes only ${required}: ${method} ${prefix}${suffix}`, () => {
          const call = () => authorize(prefix + suffix, method, [scope]);
          if (scope === required) expect(call).not.toThrow();
          else expect(call).toThrow();
        });
  }
  it("binds every alias to the key tenant", () => {
    for (const prefix of prefixes)
      expect(() =>
        authorize(prefix + "/records/contacts", "GET", scopes, 102),
      ).toThrow();
    expect(() =>
      authorize("/v1/studio/0/api/records/contacts", "GET", scopes, 0),
    ).toThrow();
    expect(() =>
      authorizePersonalApiKeyRequest(
        new Request("https://savia.test/v1/studio/101/api/records/contacts"),
        scopes as any,
      ),
    ).toThrow();
  });
  it("keeps adjacent operations and path bypasses unavailable", () => {
    for (const [method, suffix] of [
      ["DELETE", `/records/contacts/${id}`],
      ["POST", "/records/contacts/bulk"],
      ["POST", `/records/contacts/${id}/restore`],
      ["GET", "/records/contacts/summary"],
      ["POST", "/objects"],
      ["GET", "/objects/contacts"],
      ["GET", "/access-context"],
      ["POST", "/bootstrap"],
      ["GET", "/export/contacts"],
      ["POST", "/import/contacts/commit"],
      ["GET", "/published/contacts"],
      ["GET", "/records/Contacts"],
      ["GET", "/records/contacts%2fother"],
      ["GET", "/records/contacts/not-a-uuid"],
    ])
      expect(() => authorize(prefixes[0] + suffix, method, scopes)).toThrow();
    expect(() =>
      authorize(prefixes[0] + "/records/contacts", "GET", ["recordings:read"]),
    ).toThrow();
  });
  it("does not expose recording capabilities to a data-only key", () => {
    expect(() =>
      authorize("/v1/companion/capabilities", "GET", scopes),
    ).toThrow();
    expect(() =>
      authorize("/v1/companion/capabilities", "GET", [
        ...scopes,
        "recordings:read",
      ]),
    ).not.toThrow();
  });
  it("accepts mixed permissions without widening existing keys", () => {
    expect(
      createPersonalApiKeySchema.parse({
        name: "Sync",
        tenantId: 101,
        scopes: [...scopes, "recordings:read"],
      }).scopes,
    ).toEqual([...scopes, "recordings:read"]);
    expect(() =>
      createPersonalApiKeySchema.parse({
        name: "Sync",
        tenantId: 101,
        scopes: ["records:delete"],
      }),
    ).toThrow();
  });
});
