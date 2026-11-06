import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import authWorker from "../../auth/src/index";
import { registerAccountAvatarRoutes } from "../src/routes/account-avatar";

const authEnvironment = {
  AUTH_DB: env.DB,
  BETTER_AUTH_URL: "http://127.0.0.1:8787",
  BETTER_AUTH_SECRET: "avatar-integration-test-secret-at-least-32-characters",
  BETTER_AUTH_BOOTSTRAP_EMAIL: "avatar@test.example",
  BETTER_AUTH_BOOTSTRAP_PASSWORD: "Avatar-Test-Password-123!",
  BETTER_AUTH_BOOTSTRAP_NAME: "Avatar Test",
  SAVIA_ADMIN_REDIRECT_URI: "http://127.0.0.1:5173/auth/callback",
};
const service = {
  fetch: (request: Request) => authWorker.fetch(request, authEnvironment),
};

describe("avatar with real Better Auth session", () => {
  it("uploads, reads and removes an avatar from the admin origin", async () => {
    const login = await service.fetch(
      new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: authEnvironment.BETTER_AUTH_BOOTSTRAP_EMAIL,
          password: authEnvironment.BETTER_AUTH_BOOTSTRAP_PASSWORD,
        }),
      }),
    );
    expect(login.status).toBe(200);
    const { user } = (await login.json()) as { user: { id: string } };
    const cookie = login.headers.get("set-cookie")!;
    const app = new OpenAPIHono();
    app.use("*", async (context, next) => {
      (context as unknown as { set(key: string, value: unknown): void }).set(
        "actor",
        { principal: { subject: user.id } },
      );
      await next();
    });
    registerAccountAvatarRoutes(app, env.DOCUMENTS, service);
    const headers = { cookie, origin: "http://127.0.0.1:5173" };
    const form = new FormData();
    form.append(
      "file",
      new File(["avatar-bytes"], "avatar.png", { type: "image/png" }),
    );
    for (const untrustedHeaders of [
      { cookie },
      { cookie, origin: "https://untrusted.example" },
    ]) {
      const rejected = await app.request(
        "http://127.0.0.1:5173/v1/account/avatar",
        {
          method: "PUT",
          headers: untrustedHeaders,
          body: form,
        },
      );
      expect(rejected.status).toBe(502);
      expect(
        (await env.DOCUMENTS.list({ prefix: `avatars/${user.id}/` })).objects,
      ).toHaveLength(0);
    }
    const uploaded = await app.request(
      "http://127.0.0.1:5173/v1/account/avatar",
      { method: "PUT", headers, body: form },
    );
    expect(uploaded.status, await uploaded.text()).toBe(204);
    const read = await app.request("/v1/account/avatar", { headers });
    expect(read.status).toBe(200);
    expect(new TextDecoder().decode(await read.arrayBuffer())).toBe(
      "avatar-bytes",
    );
    const removed = await app.request("/v1/account/avatar", {
      method: "DELETE",
      headers,
    });
    expect(removed.status, await removed.text()).toBe(204);
    expect(
      (await env.DOCUMENTS.list({ prefix: `avatars/${user.id}/` })).objects,
    ).toHaveLength(0);
    expect((await app.request("/v1/account/avatar", { headers })).status).toBe(
      404,
    );
  });
});
