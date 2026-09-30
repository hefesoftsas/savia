import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createAuthHandler, createBetterAuth } from "../src/index";

describe("federated first login", () => {
  async function fixture(
    allowRegistration: boolean,
    apiFails: boolean | "throw" | "upgraded" = false,
    verified = true,
    trusted = true,
    stale = false,
    provider: "google" | "microsoft" = "google",
    personalAllowed = false,
  ) {
    const email = `register-${crypto.randomUUID()}@example.test`;
    const tenantId = 700000 + Math.floor(Math.random() * 100000);
    const finalize = vi.fn(async (request: Request) => {
      if (apiFails === "throw") throw new Error("Identity bridge unavailable");
      if (apiFails === "upgraded" && request.method === "POST") {
        await context.adapter.update({
          model: "user",
          where: [{ field: "email", value: email }],
          update: { role: "admin" },
        });
      }
      return request.method === "DELETE"
        ? Response.json({ removed: true })
        : new Response(null, { status: apiFails ? 503 : 201 });
    });
    const environment: any = {
      ...env,
      SAVIA_INTERNAL_BRIDGE_KEY: "registration-test",
      SAVIA_GOOGLE_CLIENT_ID: "test",
      SAVIA_GOOGLE_CLIENT_SECRET: "secret",
      SAVIA_MICROSOFT_CLIENT_ID: "ms-test",
      SAVIA_MICROSOFT_CLIENT_SECRET: "ms-secret",
      SAVIA_IDENTITY: { fetch: finalize },
    };
    await createAuthHandler(environment).fetch(
      new Request("http://127.0.0.1:8787/_internal/tenant-social/1", {
        headers: { "x-savia-bridge-key": "registration-test" },
      }),
    );
    const auth = createBetterAuth(environment);
    const context = await auth.$context;
    await context.adapter.create({
      model: "tenantSocialSettings",
      data: {
        tenantId,
        googleEnabled: true,
        microsoftEnabled: true,
        microsoftTenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        allowMicrosoftPersonalAccounts: personalAllowed,
        allowRegistration,
        active: true,
        revision: "r1",
      },
    });
    const google = context.socialProviders.find((p) => p.id === provider)!;
    google.validateAuthorizationCode = async () => ({
      accessToken: "fixture-token",
    });
    const providerSubject = crypto.randomUUID();
    google.getUserInfo = async () => ({
      user: {
        id: providerSubject,
        email,
        name: "New Member",
        emailVerified: verified,
      },
      data: {
        sub: providerSubject,
        oid: providerSubject,
        tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
        email_verified: verified,
        email,
      },
    });
    const start = await auth.handler(
      new Request("http://127.0.0.1:8787/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:8787",
          "content-type": "application/json",
          "x-savia-bridge-key": trusted ? "registration-test" : "spoofed",
          "x-savia-social-tenant-id": String(tenantId),
        },
        body: JSON.stringify({
          provider,
          callbackURL: "http://127.0.0.1:8787/api/auth/sso-complete",
          disableRedirect: true,
        }),
      }),
    );
    const startBody: any = await start.json();
    const state = new URL(startBody.url).searchParams.get("state")!;
    const cookie = start.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    if (stale)
      await context.adapter.update({
        model: "tenantSocialSettings",
        where: [{ field: "tenantId", value: tenantId }],
        update: { revision: "r2" },
      });
    const response = await auth.handler(
      new Request(
        `http://127.0.0.1:8787/api/auth/callback/${provider}?code=fixture&state=${encodeURIComponent(state)}`,
        { headers: { cookie } },
      ),
    );
    const user = await context.adapter.findOne<any>({
      model: "user",
      where: [{ field: "email", value: email }],
    });
    const sessions = user
      ? await context.adapter.findMany({
          model: "session",
          where: [{ field: "userId", value: user.id }],
        })
      : [];
    const replay = async () => {
      await auth.handler(
        new Request(
          `http://127.0.0.1:8787/api/auth/callback/${provider}?code=fixture&state=${encodeURIComponent(state)}`,
          { headers: { cookie } },
        ),
      );
      return context.adapter.findMany({
        model: "session",
        where: [{ field: "userId", value: user?.id ?? "" }],
      });
    };
    return { finalize, user, sessions, response, tenantId, replay };
  }
  it("requires both personal-account and registration opt-ins for Microsoft creation", async () => {
    const allowed = await fixture(
      true,
      false,
      true,
      true,
      false,
      "microsoft",
      true,
    );
    expect(allowed.user).toMatchObject({
      role: "user",
      emailTenantId: allowed.tenantId,
      emailVerified: true,
    });
    expect(allowed.sessions).toHaveLength(1);
    expect(await allowed.finalize.mock.calls[0][0].json()).toMatchObject({
      provider: "microsoft",
      tenantId: allowed.tenantId,
    });
    for (const [registration, personal, verified] of [
      [false, true, true],
      [true, false, true],
      [true, true, false],
    ]) {
      const denied = await fixture(
        registration,
        false,
        verified,
        true,
        false,
        "microsoft",
        personal,
      );
      expect(denied.user).toBeNull();
      expect(denied.sessions).toHaveLength(0);
      expect(denied.finalize).not.toHaveBeenCalled();
    }
  });
  it("registers a verified viewer only with tenant opt-in", async () => {
    const f = await fixture(true);
    expect(f.user).toMatchObject({
      emailVerified: true,
      emailTenantId: f.tenantId,
      role: "user",
    });
    expect(f.sessions).toHaveLength(1);
    expect(f.finalize).toHaveBeenCalledOnce();
    const request = f.finalize.mock.calls[0][0];
    expect(await request.json()).toMatchObject({
      tenantId: f.tenantId,
      provider: "google",
      revision: "r1",
    });
  });
  it("rejects a consumed callback without creating another session", async () => {
    const f = await fixture(true);
    expect(await f.replay()).toHaveLength(1);
    expect(f.finalize).toHaveBeenCalledOnce();
  });
  it("requires precreation when registration is off", async () => {
    const f = await fixture(false);
    expect(f.user).toBeNull();
    expect(f.sessions).toHaveLength(0);
    expect(f.finalize).not.toHaveBeenCalled();
  });
  it("does not issue a session and removes a new auth user when membership fails", async () => {
    const f = await fixture(true, true);
    expect(f.user).toBeNull();
    expect(f.sessions).toHaveLength(0);
    expect(f.finalize.mock.calls.some(([r]) => r.method === "POST")).toBe(true);
  });
  it("blocks the new auth account when compensation cannot reach the identity bridge", async () => {
    const f = await fixture(true, "throw");
    expect(f.user).toMatchObject({ banned: true });
    expect(f.sessions).toHaveLength(0);
  });
  it("preserves an auth account changed by an administrator during finalization", async () => {
    const f = await fixture(true, "upgraded");
    expect(f.user).toMatchObject({ role: "admin", banned: false });
    expect(f.sessions).toHaveLength(0);
    expect(f.finalize.mock.calls.some(([r]) => r.method === "DELETE")).toBe(
      false,
    );
  });
  it.each([
    ["unverified provider email", false, true, false],
    ["spoofed tenant context", true, false, false],
    ["policy changed during provider authentication", true, true, true],
  ])(
    "rejects %s without provisioning",
    async (_name, verified, trusted, stale) => {
      const f = await fixture(
        true,
        false,
        verified as boolean,
        trusted as boolean,
        stale as boolean,
      );
      expect(f.user).toBeNull();
      expect(f.sessions).toHaveLength(0);
      expect(f.finalize).not.toHaveBeenCalled();
    },
  );
});
