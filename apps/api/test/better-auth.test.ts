import { describe, expect, it } from "vitest";
import { betterAuthUserAdministrator } from "../src/auth/better-auth";

describe("Better Auth user administration", () => {
  it("uses the session cookie without forwarding the OAuth access token", async () => {
    const administrator = betterAuthUserAdministrator({
      async fetch(request) {
        expect(new URL(request.url).pathname).toBe("/_internal/users");
        expect(request.headers.get("cookie")).toBe(
          "savia.session_token=active-session",
        );
        expect(request.headers.get("authorization")).toBeNull();
        return Response.json({
          users: [
            {
              id: "better-auth-user",
              email: "user@savia.test",
              name: "Savia User",
              role: "user",
              isBanned: false,
              twoFactorEnabled: false,
            },
          ],
        });
      },
    });
    if (!administrator) throw new Error("Expected Better Auth administrator");

    const users = await administrator.listUsers(
      new Request("https://api.savia.test/v1/identity/users", {
        headers: {
          authorization: "Bearer oauth-access-token",
          cookie: "savia.session_token=active-session",
        },
      }),
    );

    expect(users).toEqual([
      {
        subject: "better-auth-user",
        email: "user@savia.test",
        displayName: "Savia User",
        role: "user",
        isBanned: false,
        twoFactorEnabled: false,
      },
    ]);
  });
});
