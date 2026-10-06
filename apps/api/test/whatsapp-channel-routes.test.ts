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

it("persists a tenant administrator's support contact and rejects unsafe destinations", async () => {
  const s = await setupChannelFixture();
  const actor = await loadActor(env.DB, s.principal);
  const app = new OpenAPIHono();
  app.use(
    "*",
    authenticationMiddleware(env.DB, { authenticate: async () => actor }),
  );
  registerWhatsappChannelRoutes(app, env.DB);
  const configuration = {
    routingEnabled: true,
    tasks: [],
    staff: [],
    internalCapabilities: [],
    externalCapabilities: [],
    humanSupportContact: "https://support.example.test/help",
  };
  const save = (config: typeof configuration) =>
    app.request("/v1/whatsapp/channel", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agencyId: s.tenantId, configuration: config }),
    });
  expect((await save(configuration)).status).toBe(200);
  const loaded = await app.request(
    `/v1/whatsapp/channel?agencyId=${s.tenantId}`,
  );
  expect(
    ((await loaded.json()) as any).data.configuration.humanSupportContact,
  ).toBe(configuration.humanSupportContact);
  expect(
    (await save({ ...configuration, humanSupportContact: "javascript:bad" }))
      .ok,
  ).toBe(false);
  expect(
    (await save({ ...configuration, humanSupportContact: "" })).status,
  ).toBe(200);
  actor.memberships = [];
  expect((await save(configuration)).status).toBe(403);
});
