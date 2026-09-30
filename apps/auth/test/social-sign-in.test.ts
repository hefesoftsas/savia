import { describe, it, expect } from "vitest";
import { socialProviders, parseSocialSettings } from "../src/social-sign-in";

describe("social sign-in configuration", () => {
  it("enables only complete deployment credentials and uses organization-only Microsoft", () => {
    expect(socialProviders({})).toEqual({});
    expect(() => socialProviders({ SAVIA_GOOGLE_CLIENT_ID: "id" })).toThrow();
    const providers = socialProviders({
      SAVIA_GOOGLE_CLIENT_ID: "g",
      SAVIA_GOOGLE_CLIENT_SECRET: "gs",
      SAVIA_MICROSOFT_CLIENT_ID: "m",
      SAVIA_MICROSOFT_CLIENT_SECRET: "ms",
    });
    expect(providers.google).toMatchObject({ disableSignUp: true });
    expect(providers.microsoft).toMatchObject({
      tenantId: "organizations",
      disableSignUp: true,
      disableDefaultScope: true,
      scope: ["openid", "profile", "email"],
    });
  });
  it("requires an explicit enterprise directory and rejects malformed settings", () => {
    expect(
      parseSocialSettings({
        googleEnabled: true,
        microsoftEnabled: false,
        microsoftTenantId: "",
      }),
    ).toMatchObject({ googleEnabled: true });
    for (const value of [
      null,
      {},
      {
        googleEnabled: true,
        microsoftEnabled: true,
        microsoftTenantId: "common",
      },
      {
        googleEnabled: true,
        microsoftEnabled: true,
        microsoftTenantId: "9188040d-6c67-4c5b-b112-36a304b66dad",
      },
    ])
      expect(() => parseSocialSettings(value)).toThrow();
  });
});

import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { createAuthHandler, createBetterAuth } from "../src/index";
import {
  validateSocialIdentity,
  socialHooks,
  socialSessionProof,
  recordSocialChallenge,
} from "../src/social-sign-in";

it("enforces tenant social policies, callback identity, MFA binding and lifecycle on D1", async () => {
  const bridge = "social-test-bridge";
  const environment = {
    ...env,
    SAVIA_INTERNAL_BRIDGE_KEY: bridge,
    SAVIA_GOOGLE_CLIENT_ID: "google-test",
    SAVIA_GOOGLE_CLIENT_SECRET: "google-secret",
    SAVIA_MICROSOFT_CLIENT_ID: "ms-test",
    SAVIA_MICROSOFT_CLIENT_SECRET: "ms-secret",
  };
  const handler = createAuthHandler(environment);
  const origin = "http://127.0.0.1:8787";
  const tenantId = 600000 + Math.floor(Math.random() * 100000);
  const email = `social-${crypto.randomUUID()}@example.test`;
  const directory = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const call = (path: string, method = "GET", body?: unknown, key = bridge) =>
    handler.fetch(
      new Request(origin + path, {
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
    name: "Social Member",
    email,
    password: "Social-Test-Password-123!",
    emailVerified: true,
    tenantId,
  });
  expect(created.status).toBe(201);
  const auth = createBetterAuth(environment);
  const context = await auth.$context;
  const adapter = context.adapter;
  const local = await adapter.findOne<any>({
    model: "user",
    where: [{ field: "email", value: email }],
  });
  const path = `/_internal/tenant-social/${tenantId}`;
  expect((await call(path, "GET", undefined, "invalid")).status).toBe(403);
  expect(await (await call(path)).json()).toMatchObject({
    configured: false,
    googleAvailable: true,
    microsoftAvailable: true,
  });
  expect(
    (
      await call(path, "PUT", {
        googleEnabled: true,
        microsoftEnabled: true,
        microsoftTenantId: directory,
      })
    ).status,
  ).toBe(200);
  const saved = await (await call(path)).json();
  expect(JSON.stringify(saved)).not.toContain("google-secret");
  const endpoint: any = {
    context: { ...context },
    path: "/callback/google",
    params: { id: "google" },
  };
  const identity = (
    provider: string,
    patch: Record<string, unknown> = {},
    profile: Record<string, unknown> = {},
  ) => ({
    user: { email, emailVerified: true, ...patch },
    source: {
      action: "link-account" as const,
      method: "oauth",
      oauth: { providerId: provider, profile },
    },
  });
  expect(
    await validateSocialIdentity(identity("google"), endpoint),
  ).toBeUndefined();
  const proof = socialSessionProof(endpoint.context)!;
  expect(proof.userId).toBe(local.id);
  await socialHooks.session!.create!.before!(
    { userId: local.id } as any,
    endpoint,
  );
  await expect(
    socialHooks.session!.create!.before!(
      { userId: "another-user" } as any,
      endpoint,
    ),
  ).rejects.toThrow();
  expect(
    await validateSocialIdentity(
      identity("google", { emailVerified: false }),
      endpoint,
    ),
  ).toMatchObject({ error: "social_sign_in_denied" });
  expect(
    await validateSocialIdentity(
      identity("google", { email: "unknown@example.test" }),
      endpoint,
    ),
  ).toMatchObject({ error: "social_sign_in_denied" });
  expect(
    await validateSocialIdentity(
      identity(
        "microsoft",
        {},
        { tid: "11111111-2222-3333-4444-555555555555" },
      ),
      endpoint,
    ),
  ).toMatchObject({ error: "social_sign_in_denied" });
  expect(
    await validateSocialIdentity(
      identity("microsoft", {}, { tid: directory }),
      endpoint,
    ),
  ).toBeUndefined();
  const challenge = `2fa-${crypto.randomUUID()}`;
  await adapter.create({
    model: "verification",
    data: {
      identifier: challenge,
      value: local.id,
      expiresAt: new Date(Date.now() + 300000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await recordSocialChallenge(
    adapter,
    challenge,
    socialSessionProof(endpoint.context)!,
  );
  const mfa: any = {
    context: { ...context },
    path: "/two-factor/verify-totp",
    getSignedCookie: async () => challenge,
  };
  await socialHooks.session!.create!.before!({ userId: local.id } as any, mfa);
  // A settings revision invalidates previously issued challenges, even if enabled stays true.
  await call(path, "PUT", {
    googleEnabled: true,
    microsoftEnabled: true,
    microsoftTenantId: directory,
  });
  await expect(
    socialHooks.session!.create!.before!({ userId: local.id } as any, mfa),
  ).rejects.toThrow();
  // Lifecycle updates shared with SAML must also deactivate social login.
  expect(
    (
      await call(`/_internal/tenant-sso/${tenantId}/activity`, "PATCH", {
        active: false,
      })
    ).status,
  ).toBe(204);
  expect(
    await validateSocialIdentity(identity("google"), {
      ...endpoint,
      context: { ...context },
    }),
  ).toMatchObject({ error: "social_sign_in_denied" });
  await call(`/_internal/tenant-sso/${tenantId}/activity`, "PATCH", {
    active: true,
  });
  expect(
    await validateSocialIdentity(identity("google"), endpoint),
  ).toBeUndefined();
  // A late inserted session cannot survive a concurrent provider disable.
  const ssoPolicy = await adapter.create<any>({
    model: "ssoProvider",
    data: {
      providerId: `savia-saml-${tenantId}-policy`,
      issuer: "https://idp.example.test",
      domain: "example.test",
      userId: local.id,
      saviaTenantId: tenantId,
      saviaEnabled: true,
      saviaTenantActive: true,
      saviaSSOOnly: true,
      saviaRevision: crypto.randomUUID(),
    },
  });
  expect(
    await validateSocialIdentity(identity("google"), endpoint),
  ).toMatchObject({ error: "social_sign_in_denied" });
  expect(
    await validateSocialIdentity(
      identity("microsoft", {}, { tid: directory }),
      endpoint,
    ),
  ).toMatchObject({ error: "social_sign_in_denied" });
  await adapter.delete({
    model: "ssoProvider",
    where: [{ field: "id", value: ssoPolicy.id }],
  });
  for (const patch of [
    { banned: true },
    { emailVerified: false },
    { role: "admin" },
    { emailTenantId: 0 },
    { emailTenantId: tenantId + 1 },
  ]) {
    await adapter.update({
      model: "user",
      where: [{ field: "id", value: local.id }],
      update: patch,
    });
    expect(
      await validateSocialIdentity(identity("google"), endpoint),
    ).toMatchObject({ error: "social_sign_in_denied" });
    await adapter.update({
      model: "user",
      where: [{ field: "id", value: local.id }],
      update: {
        banned: false,
        emailVerified: true,
        role: "user",
        emailTenantId: tenantId,
      },
    });
  }
  expect(
    await validateSocialIdentity(identity("google"), endpoint),
  ).toBeUndefined();
  const late = await adapter.create<any>({
    model: "session",
    data: {
      userId: local.id,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await call(path, "PUT", {
    googleEnabled: false,
    microsoftEnabled: false,
    microsoftTenantId: directory,
  });
  await expect(
    socialHooks.session!.create!.after!(late, endpoint),
  ).rejects.toThrow();
  expect(
    await adapter.findOne({
      model: "session",
      where: [{ field: "id", value: late.id }],
    }),
  ).toBeNull();
  expect(
    (
      await call("/api/auth/sign-in/social", "POST", {
        provider: "google",
        idToken: { token: "untrusted" },
      })
    ).status,
  ).toBe(403);
  expect(
    (await call("/api/auth/link-social", "POST", { provider: "google" }))
      .status,
  ).toBe(403);
  await call(path, "DELETE");
  expect(await (await call(path)).json()).toMatchObject({
    configured: false,
    googleEnabled: false,
  });
  // Deactivation before a provider's first save must leave an authoritative tombstone.
  await call(`/_internal/tenant-sso/${tenantId}/activity`, "PATCH", {
    active: false,
  });
  await call(path, "PUT", {
    googleEnabled: true,
    microsoftEnabled: false,
    microsoftTenantId: "",
  });
  expect(
    await validateSocialIdentity(identity("google"), endpoint),
  ).toMatchObject({ error: "social_sign_in_denied" });
  // A subsequent settings update cannot reactivate an existing disabled provider either.
  await call(path, "PUT", {
    googleEnabled: true,
    microsoftEnabled: false,
    microsoftTenantId: "",
  });
  expect(
    await validateSocialIdentity(identity("google"), endpoint),
  ).toMatchObject({ error: "social_sign_in_denied" });
  await call(`/_internal/tenant-sso/${tenantId}/activity`, "PATCH", {
    active: true,
  });
  expect(
    await validateSocialIdentity(identity("google"), endpoint),
  ).toBeUndefined();
});

import { symmetricEncrypt } from "better-auth/crypto";
import { samlMFAResponse } from "../src/saml-two-factor";

it.each(["google", "microsoft"] as const)(
  "runs the native %s callback through state validation and local MFA without exposing a premature session",
  async (providerName) => {
    const environment = {
      ...env,
      SAVIA_INTERNAL_BRIDGE_KEY: "social-callback",
      SAVIA_GOOGLE_CLIENT_ID: "google-callback",
      SAVIA_GOOGLE_CLIENT_SECRET: "secret",
      SAVIA_MICROSOFT_CLIENT_ID: "microsoft-callback",
      SAVIA_MICROSOFT_CLIENT_SECRET: "secret",
    };
    const initializer = createAuthHandler(environment);
    const origin = "http://127.0.0.1:8787";
    const tenantId = 800000 + Math.floor(Math.random() * 100000);
    const email = `callback-${crypto.randomUUID()}@example.test`;
    const bridge = (path: string, body: unknown) =>
      initializer.fetch(
        new Request(origin + path, {
          method: "POST",
          headers: {
            "x-savia-bridge-key": "social-callback",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    expect(
      (
        await bridge("/_internal/users", {
          name: "Callback User",
          email,
          password: "Callback-Test-Password-123!",
          emailVerified: true,
          tenantId,
        })
      ).status,
    ).toBe(201);
    const auth = createBetterAuth(environment);
    const context = await auth.$context;
    const local = await context.adapter.findOne<any>({
      model: "user",
      where: [{ field: "email", value: email }],
    });
    await context.adapter.update({
      model: "user",
      where: [{ field: "id", value: local.id }],
      update: { twoFactorEnabled: true },
    });
    await context.adapter.create({
      model: "tenantSocialSettings",
      data: {
        tenantId,
        googleEnabled: true,
        microsoftEnabled: true,
        microsoftTenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        active: true,
        revision: crypto.randomUUID(),
      },
    });
    const google = context.socialProviders.find((p) => p.id === providerName)!;
    const token = vi
      .spyOn(google, "validateAuthorizationCode")
      .mockResolvedValue({
        accessToken: "synthetic-provider-token",
        scopes: ["openid", "email", "profile"],
      });
    const profile = vi.spyOn(google, "getUserInfo").mockResolvedValue({
      user: {
        id: "stable-google-subject",
        name: "Callback User",
        email,
        emailVerified: true,
      },
      data: {
        sub: "stable-google-subject",
        oid: "11111111-2222-3333-4444-555555555555",
        tid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        email,
        email_verified: true,
      },
    });
    try {
      const start = await auth.handler(
        new Request(origin + "/api/auth/sign-in/social", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({
            provider: providerName,
            callbackURL: origin + "/api/auth/sso-complete",
          }),
        }),
      );
      expect(start.status).toBe(200);
      const authorization = new URL(
        ((await start.json()) as { url: string }).url,
      );
      expect(authorization.hostname).toBe(
        providerName === "google"
          ? "accounts.google.com"
          : "login.microsoftonline.com",
      );
      expect(authorization.searchParams.get("state")).toBeTruthy();
      const cookies = start.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; ");
      const callbackRequest = new Request(
        origin +
          "/api/auth/callback/" +
          providerName +
          "?code=synthetic-code&state=" +
          authorization.searchParams.get("state"),
        { headers: { cookie: cookies } },
      );
      const callback = await samlMFAResponse(
        callbackRequest,
        await auth.handler(callbackRequest),
      );
      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toContain("mode=sso-mfa");
      const mfaCookies = callback.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; ");
      expect(mfaCookies).toContain("two_factor");
      const session = await auth.handler(
        new Request(origin + "/api/auth/get-session", {
          headers: { cookie: mfaCookies },
        }),
      );
      expect(await session.json()).toBeNull();
      const markers = await context.adapter.findMany<any>({
        model: "verification",
        where: [{ field: "value", operator: "contains", value: local.id }],
      });
      expect(
        markers.some((m) => m.identifier.startsWith("savia-social-mfa:")),
      ).toBe(true);
      const secret = "social-mfa-secret-1234567890";
      await context.adapter.create({
        model: "twoFactor",
        data: {
          userId: local.id,
          secret: await symmetricEncrypt({
            key: environment.BETTER_AUTH_SECRET,
            data: secret,
          }),
          backupCodes: await symmetricEncrypt({
            key: environment.BETTER_AUTH_SECRET,
            data: "[]",
          }),
          verified: true,
        },
      });
      const { code } = await auth.api.generateTOTP({ body: { secret } });
      const verified = await auth.handler(
        new Request(origin + "/api/auth/two-factor/verify-totp", {
          method: "POST",
          headers: {
            origin,
            cookie: mfaCookies,
            "content-type": "application/json",
          },
          body: JSON.stringify({ code }),
        }),
      );
      expect(verified.status).toBe(200);
      const verifiedCookies = verified.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; ");
      const confirmed = await auth.handler(
        new Request(origin + "/api/auth/get-session", {
          headers: { cookie: verifiedCookies },
        }),
      );
      expect(await confirmed.json()).toMatchObject({
        user: { id: local.id, email },
      });
      const bad = await auth.handler(
        new Request(
          origin +
            "/api/auth/callback/" +
            providerName +
            "?code=synthetic&state=invalid",
          { headers: { cookie: cookies } },
        ),
      );
      expect(bad.headers.get("location")).toContain("error=");
    } finally {
      token.mockRestore();
      profile.mockRestore();
    }
  },
);
