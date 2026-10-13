import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createAccessFixture } from "./access-control-fixtures";
import { createTestApp } from "./test-app";
import { betterAuthAuthenticator } from "../src/auth/better-auth";
import {
  PersonalApiKeys,
  type ApiKeyScope,
} from "../src/auth/personal-api-keys";
let f: Awaited<ReturnType<typeof createAccessFixture>>;
let keys: PersonalApiKeys;
let now = Date.now();
const base = "/v1/studio/101/api/plugin-development";
beforeAll(async () => {
  f = await createAccessFixture();
  keys = new PersonalApiKeys(f.db, "preview", () => now);
});
async function key(
  scopes: ApiKeyScope[],
  role: "agency_admin" | "viewer" = "agency_admin",
) {
  return keys.create(await f.actor(role), {
    name: "VS Code",
    tenantId: 101,
    scopes,
    lifetimeDays: 7,
  });
}
function request(
  secret: string,
  path = base + "/capabilities",
  method = "GET",
) {
  return createTestApp({
    documents: env.DOCUMENTS,
    auth: betterAuthAuthenticator(undefined, undefined, keys),
  }).request(path, { method, headers: { authorization: `Bearer ${secret}` } });
}
it("keeps administrator read keys read-only and publish keys unable to download source", async () => {
  const read = await key(["plugins:read"]);
  const response = await request(read.secret);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({
    tenantId: 101,
    principalId: f.principalId("agency_admin"),
    read: true,
    destinations: [],
  });
  expect(
    (await request(read.secret, base + "/custom.example/publish", "POST"))
      .status,
  ).toBe(403);
  const publish = await key(["plugins:publish"]);
  expect((await request(publish.secret, base + "/catalog")).status).toBe(403);
  expect(
    (
      await request(
        publish.secret,
        base + "/custom.example/checkout?version=1.0.0",
      )
    ).status,
  ).toBe(403);
  expect(await (await request(publish.secret)).json()).toMatchObject({
    read: false,
    destinations: ["tenant"],
  });
});
it("rejects missing management ACL, wrong tenants, aliases and general Studio operations", async () => {
  const member = await key(["plugins:read", "plugins:publish"], "viewer");
  expect((await request(member.secret)).status).toBe(403);
  const admin = await key(["plugins:read", "plugins:publish"]);
  for (const path of [
    base.replace("101", "102") + "/capabilities",
    "/v1/dynamic-crm/101/api/plugin-development/catalog",
    "/v1/studio/101/api/objects",
  ])
    expect((await request(admin.secret, path)).status).toBe(403);
});
it("honors expiry, revocation, deployment binding and removed membership for plugin keys", async () => {
  const first = await key(["plugins:read"]);
  expect((await request(first.secret)).status).toBe(200);
  await keys.revoke(f.principalId("agency_admin"), first.key.id);
  expect((await request(first.secret)).status).toBe(401);
  const second = await key(["plugins:read"]);
  await expect(
    new PersonalApiKeys(f.db, "production", () => now).authenticate(
      second.secret,
    ),
  ).rejects.toThrow();
  await f.db
    .prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=?",
    )
    .bind(f.principalId("agency_admin"))
    .run();
  expect((await request(second.secret)).status).toBe(401);
  await f.db
    .prepare(
      "UPDATE identity_tenant_membership SET is_active=1 WHERE principal_id=?",
    )
    .bind(f.principalId("agency_admin"))
    .run();
  now += 7 * 24 * 60 * 60 * 1000;
  expect((await request(second.secret)).status).toBe(401);
});
