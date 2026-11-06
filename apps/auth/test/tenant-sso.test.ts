import { describe, expect, it, vi } from "vitest";
import { parseTenantSAMLSettings, assertSAMLUser } from "../src/tenant-sso";

const metadata = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.test/realm"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>Y2VydA==</X509Certificate></X509Data></KeyInfo></KeyDescriptor><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.test/saml"/></IDPSSODescriptor></EntityDescriptor>`;
const input = {
  displayName: "Company",
  domain: "example.test",
  idpMetadata: metadata,
  enabled: true,
  ssoOnly: false,
};
describe("tenant SAML policy", () => {
  it("parses IdP metadata and constrains insecure local test endpoints", () => {
    expect(parseTenantSAMLSettings(input, false).idpEntityId).toBe(
      "https://idp.example.test/realm",
    );
    const local = {
      ...input,
      idpMetadata: metadata.replaceAll(
        "https://idp.example.test",
        "http://127.0.0.1:8098",
      ),
    };
    expect(() => parseTenantSAMLSettings(local, false)).toThrow();
    expect(parseTenantSAMLSettings(local, true).entryPoint).toBe(
      "http://127.0.0.1:8098/saml",
    );
    expect(() =>
      parseTenantSAMLSettings(
        {
          ...input,
          idpMetadata: metadata.replace(
            "https://idp.example.test/saml",
            "http://evil.test/saml",
          ),
        },
        true,
      ),
    ).toThrow();
  });
  it("rejects entities, malformed XML, invalid domains, and SSO-only while disabled", () => {
    for (const patch of [
      { idpMetadata: "<!DOCTYPE x><x/>" },
      { idpMetadata: "<x>" },
      { domain: "*.example.test" },
      { enabled: false, ssoOnly: true },
    ]) {
      expect(() =>
        parseTenantSAMLSettings({ ...input, ...patch }, false),
      ).toThrow();
    }
  });
  it("requires a verified non-platform user in the provider tenant", () => {
    const provider = {
      saviaTenantId: 7,
      saviaEnabled: true,
      domain: "example.test",
    };
    const user = {
      emailTenantId: 7,
      emailVerified: true,
      role: "user",
      email: "a@example.test",
      banned: false,
    };
    expect(() => assertSAMLUser(provider, user)).not.toThrow();
    for (const patch of [
      { emailTenantId: 8 },
      { emailVerified: false },
      { role: "admin" },
      { banned: true },
      { email: "a@else.test" },
    ]) {
      expect(() => assertSAMLUser(provider, { ...user, ...patch })).toThrow();
    }
    expect(() =>
      assertSAMLUser({ ...provider, saviaEnabled: false }, user),
    ).toThrow();
  });
  it("rejects SAML authentication for the reserved platform tenant", () => {
    expect(() =>
      assertSAMLUser(
        { saviaTenantId: 0, saviaEnabled: true, domain: "example.test" },
        {
          emailTenantId: 0,
          emailVerified: true,
          role: "user",
          email: "platform@example.test",
          banned: false,
        },
      ),
    ).toThrow();
  });
});

import { env } from "cloudflare:workers";
import { createAuthHandler, createBetterAuth } from "../src/index";

it("enforces SSO settings, local password policy and lifecycle on Workers D1", async () => {
  const bridge = "sso-test-bridge";
  const environment = { ...env, SAVIA_INTERNAL_BRIDGE_KEY: bridge };
  const handler = createAuthHandler(environment);
  const auth = createBetterAuth(environment);
  const origin = "http://127.0.0.1:8787";
  const tenantId = 400000 + Math.floor(Math.random() * 100000);
  const password = "SSO-Test-Password-123!";
  const email = `sso-${crypto.randomUUID()}@example.test`;
  const call = (path: string, method = "GET", body?: unknown, key = bridge) =>
    handler.fetch(
      new Request(`${origin}${path}`, {
        method,
        headers: {
          origin,
          "content-type": "application/json",
          "x-savia-bridge-key": key,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const created = await call("/_internal/users", "POST", {
    name: "SSO Member",
    email,
    password,
    emailVerified: true,
    tenantId,
  });
  expect(created.status).toBe(201);
  const userId = ((await created.json()) as { user: { id: string } }).user.id;
  const path = `/_internal/tenant-sso/${tenantId}`;
  expect((await call(path, "GET", undefined, "wrong")).status).toBe(403);
  expect((await call("/api/auth/sso/register", "POST", {})).status).toBe(404);
  const beforeSSO = await auth.api.signInEmail({ body: { email, password } });
  const first = await call(path, "PUT", {
    ...input,
    ssoOnly: true,
    actorSubject: userId,
  });
  const adapter = (await auth.$context).adapter;
  expect(
    await adapter.findOne({
      model: "session",
      where: [{ field: "token", value: beforeSSO.token }],
    }),
  ).toBeNull();
  expect(first.status).toBe(200);
  const saved = (await first.json()) as {
    providerId: string;
    entityId: string;
    metadataUrl: string;
  };
  const discovery = await call(
    "/api/auth/savia-sso/connections?domain=example.test",
  );
  expect(await discovery.json()).toMatchObject({
    connections: expect.arrayContaining([
      { providerId: saved.providerId, displayName: "Company" },
    ]),
  });
  const metadataResponse = await handler.fetch(new Request(saved.metadataUrl));
  expect(metadataResponse.status).toBe(200);
  expect(await metadataResponse.text()).toContain(saved.entityId);
  const signIn = await call("/api/auth/sign-in/sso", "POST", {
    providerId: saved.providerId,
    callbackURL: `${origin}/api/auth/sso-complete`,
  });
  expect(signIn.status).toBe(200);
  expect(((await signIn.json()) as { url: string }).url).toContain(
    "https://idp.example.test/saml?",
  );
  // Tokens issued before enabling SSO-only cannot reset the password afterwards.
  const context = await auth.$context;
  const token = crypto.randomUUID();
  await context.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + 60000),
  });
  expect(
    (await call(path, "PUT", { ...input, ssoOnly: true, actorSubject: userId }))
      .status,
  ).toBe(200);
  await expect(
    auth.api.signInEmail({ body: { email, password } }),
  ).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
  await expect(
    auth.api.requestPasswordReset({ body: { email } }),
  ).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
  expect(
    (await call(`/_internal/users/${userId}/password-reset`, "POST")).status,
  ).toBe(403);
  await expect(
    auth.api.resetPassword({
      body: { token, newPassword: "Changed-Test-Password-123!" },
    }),
  ).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
  // Deterministically overlap a policy change/revocation with a late session insert.
  await call(path, "PUT", { ...input, actorSubject: userId });
  const create = adapter.create.bind(adapter);
  let overlap = true;
  const createSpy = vi
    .spyOn(adapter, "create")
    .mockImplementation(async (options) => {
      if (overlap && options.model === "session") {
        overlap = false;
        await environment.AUTH_DB.prepare(
          'UPDATE "ssoProvider" SET "saviaSSOOnly"=1 WHERE "saviaTenantId"=?',
        )
          .bind(tenantId)
          .run();
        await environment.AUTH_DB.prepare(
          'DELETE FROM "session" WHERE "userId"=?',
        )
          .bind(userId)
          .run();
      }
      return create(options);
    });
  try {
    await expect(
      auth.api.signInEmail({ body: { email, password } }),
    ).rejects.toMatchObject({ body: { code: "SSO_REQUIRED" } });
    expect(
      await adapter.findMany({
        model: "session",
        where: [{ field: "userId", value: userId }],
      }),
    ).toEqual([]);
  } finally {
    createSpy.mockRestore();
  }
  // Replacing the authority invalidates the previous provider identity.
  const changed = await call(path, "PUT", {
    ...input,
    idpMetadata: metadata.replace(
      'entityID="https://idp.example.test/realm"',
      'entityID="https://idp.example.test/another-realm"',
    ),
    actorSubject: userId,
  });
  expect(changed.status).toBe(200);
  const changedSettings = (await changed.json()) as { providerId: string };
  expect(changedSettings.providerId).not.toBe(saved.providerId);
  expect(
    (
      await call("/api/auth/sign-in/sso", "POST", {
        providerId: saved.providerId,
        callbackURL: `${origin}/api/auth/sso-complete`,
      })
    ).status,
  ).toBe(403);
  expect(
    (await call(path + "/activity", "PATCH", { active: false })).status,
  ).toBe(204);
  expect(
    (
      await call("/api/auth/sign-in/sso", "POST", {
        providerId: changedSettings.providerId,
        callbackURL: `${origin}/api/auth/sso-complete`,
      })
    ).status,
  ).toBe(403);
  expect(
    await (
      await call("/api/auth/savia-sso/connections?domain=example.test")
    ).json(),
  ).toEqual({ connections: [] });
  expect(
    (await call(path + "/activity", "PATCH", { active: true })).status,
  ).toBe(204);
  expect((await call(path, "DELETE")).status).toBe(200);
  expect(await (await call(path)).json()).toEqual({ configured: false });
});
