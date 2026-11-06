import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, it, expect } from "vitest";
import { registerPersonalApiKeyRoutes } from "../src/auth/personal-api-key-routes";
import { PersonalApiKeys } from "../src/auth/personal-api-keys";
import { platformAdministratorAuthenticator } from "./auth-fixtures";
import { authenticationMiddleware } from "../src/auth/middleware";
function app(kind?: "personal-api-key") {
  const app = new OpenAPIHono();
  const base = platformAdministratorAuthenticator();
  app.use(
    "*",
    authenticationMiddleware(env.DB, {
      async authenticate(r, d) {
        const actor = await base.authenticate(r, d);
        return {
          ...actor,
          ...(kind
            ? {
                credential: {
                  kind,
                  keyId: "key",
                  tenantId: 0,
                  scopes: ["recordings:read" as const],
                },
              }
            : {}),
        };
      },
    }),
  );
  registerPersonalApiKeyRoutes(
    app,
    new PersonalApiKeys(env.DB, "https://preview.example"),
    "https://preview.example",
  );
  return app;
}
describe("key management boundary", () => {
  it("rejects personal keys before any management database read", async () => {
    for (const path of ["/v1/account/api-keys", "/v1/account/api-keys/tenants"])
      expect((await app("personal-api-key").request(path)).status).toBe(403);
  });
  it("requires trusted origin for cookie-authenticated mutations", async () => {
    for (const origin of [undefined, "https://evil.example"]) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        cookie: "session=value",
      };
      if (origin) headers.origin = origin;
      const response = await app().request("/v1/account/api-keys", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "test",
          tenantId: 0,
          scopes: ["recordings:read"],
        }),
      });
      expect(response.status).toBe(403);
    }
  });
  it("rejects invalid scopes before creating a key", async () => {
    const response = await app().request("/v1/account/api-keys", {
      method: "POST",
      headers: {
        origin: "https://preview.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "test", tenantId: 0, scopes: ["*"] }),
    });
    expect(response.status).toBe(400);
  });
});
