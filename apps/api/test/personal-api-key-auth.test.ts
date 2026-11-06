import { describe, it, expect } from "vitest";
import { authorizePersonalApiKeyRequest } from "../src/auth/personal-api-key-policy";
import { betterAuthAuthenticator } from "../src/auth/better-auth";
const id = "10b438d1-8b7f-4a92-a554-254dc67159a3";
const base = "/v1/companion";
describe("personal key route policy", () => {
  const operations = [
    ["GET", `${base}/recordings`, "read"],
    ["GET", `${base}/recordings/${id}`, "read"],
    ["GET", `${base}/recordings/${id}/notes`, "read"],
    ["POST", `${base}/recordings`, "upload"],
    ["POST", `${base}/recordings/upload`, "upload"],
    ["POST", `${base}/recordings/${id}/notes`, "process"],
    ["POST", `${base}/recordings/${id}/questions`, "process"],
    ["DELETE", `${base}/recordings/${id}`, "delete"],
  ];
  for (const [method, path, scope] of operations)
    for (const granted of ["read", "upload", "process", "delete"])
      it(`${granted} ${granted === scope ? "allows" : "denies"} ${method} ${path}`, () => {
        const call = () =>
          authorizePersonalApiKeyRequest(
            new Request(`https://preview.example${path}`, { method }),
            [`recordings:${granted}` as any],
          );
        if (granted === scope) expect(call).not.toThrow();
        else expect(call).toThrow();
      });
  it("denies unknown operations, management and connected drive imports", () => {
    for (const path of [
      "/v1/account/api-keys",
      "/v1/identity/users",
      "/api/assistant/chat",
      `${base}/recordings/import`,
      `${base}/transcribe`,
      `${base}/summarize`,
    ])
      expect(() =>
        authorizePersonalApiKeyRequest(
          new Request(`https://preview.example${path}`, { method: "POST" }),
          [
            "recordings:read",
            "recordings:upload",
            "recordings:process",
            "recordings:delete",
          ],
        ),
      ).toThrow();
  });
  it("allows capabilities but denies unknown methods and malformed identifiers", () => {
    expect(() =>
      authorizePersonalApiKeyRequest(
        new Request(`https://preview.example${base}/capabilities`),
        ["recordings:upload"],
      ),
    ).not.toThrow();
    for (const [method, path] of [
      ["PATCH", `${base}/recordings/${id}`],
      ["GET", `${base}/recordings/not-a-uuid`],
    ])
      expect(() =>
        authorizePersonalApiKeyRequest(
          new Request(`https://preview.example${path}`, { method }),
          ["recordings:read", "recordings:upload"],
        ),
      ).toThrow();
  });
  it("never falls back to a cookie for a rejected opaque bearer credential", async () => {
    let cookieCalls = 0;
    const auth = betterAuthAuthenticator({
      async fetch() {
        cookieCalls++;
        return Response.json({ user: null });
      },
    });
    for (const authorization of [
      "Bearer savia_pat_invalid",
      "Bearer opaque-token",
      "bearer opaque-token",
    ])
      await expect(
        auth.authenticate(
          new Request("https://preview.example/v1/companion/capabilities", {
            headers: { authorization, cookie: "session=valid" },
          }),
          {} as D1Database,
        ),
      ).rejects.toThrow();
    expect(cookieCalls).toBe(0);
  });
});
