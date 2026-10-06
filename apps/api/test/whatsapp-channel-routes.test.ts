import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { expect, it } from "vitest";
import { setupChannelFixture } from "./whatsapp-channel-fixture";
import { registerWhatsappChannelRoutes } from "../src/whatsapp/channel-routes";
import { authenticationMiddleware } from "../src/auth/middleware";
import { loadActor } from "../src/auth/identity-repository";

it("requires an administrator and publishes only tenant employees", async () => {
  const s = await setupChannelFixture();
  const actor = await loadActor(env.DB, s.principal);
  const app = new OpenAPIHono();
  app.use(
    "*",
    authenticationMiddleware(env.DB, { authenticate: async () => actor }),
  );
  registerWhatsappChannelRoutes(app, env.DB);
  const response = await app.request(
    `/v1/whatsapp/channel?agencyId=${s.tenantId}`,
  );
  expect(response.status).toBe(200);
  expect(((await response.json()) as any).data.employees).toContainEqual({
    id: s.employeeId,
    name: "Test employee",
  });
  actor.memberships = [];
  expect(
    (await app.request(`/v1/whatsapp/channel?agencyId=${s.tenantId}`)).status,
  ).toBe(403);
});
