import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import {
  createAuthHandler,
  createBetterAuth,
  initializeAuthSchema,
} from "../src/index";
import { CHATGPT_ISSUER } from "../src/chatgpt-sign-in";
import { provenChatgptIdentity } from "../src/microsoft-email-verification";

const bridgeKey = "chatgpt-proof-bridge";
const clientId = "oaiapp_test";
const environment = {
  ...env,
  BETTER_AUTH_SECRET: "chatgpt-verification-secret",
  SAVIA_INTERNAL_BRIDGE_KEY: bridgeKey,
  SAVIA_CHATGPT_CLIENT_ID: clientId,
};
const dependencies = { sendTransactionalEmail: async () => undefined };
async function enableChatgpt(handler: ReturnType<typeof createAuthHandler>) {
  const response = await handler.fetch(
    new Request("http://localhost/_internal/tenant-social/723004", {
      method: "PUT",
      headers: {
        "x-savia-bridge-key": bridgeKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        googleEnabled: false,
        microsoftEnabled: false,
        microsoftTenantId: "",
        allowMicrosoftPersonalAccounts: false,
        chatgptEnabled: true,
        allowRegistration: false,
      }),
    }),
  );
  expect(response.status).toBe(200);
}

afterEach(() => vi.unstubAllGlobals());

describe("ChatGPT email verification callback", () => {
  it("verifies a signed callback and opens Savia's original-browser proof despite upstream verified email", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = {
      ...(await exportJWK(publicKey)),
      kid: "chatgpt-test-key",
      alg: "RS256",
      use: "sig",
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${CHATGPT_ISSUER}/.well-known/openid-configuration`)
        return Response.json({
          issuer: CHATGPT_ISSUER,
          authorization_endpoint: `${CHATGPT_ISSUER}/api/accounts/authorize`,
          token_endpoint: `${CHATGPT_ISSUER}/api/accounts/oauth/token`,
          jwks_uri: `${CHATGPT_ISSUER}/.well-known/jwks.json`,
        });
      if (url === `${CHATGPT_ISSUER}/.well-known/jwks.json`)
        return Response.json({ keys: [jwk] });
      throw new Error(`Unexpected external request: ${url}`);
    });
    await initializeAuthSchema(environment, dependencies);
    const handler = createAuthHandler(environment, dependencies);
    const auth = createBetterAuth(environment, dependencies);
    const context = await auth.$context;
    const adapter = context.adapter;
    await enableChatgpt(handler);
    const provider = context.socialProviders.find(
      (item) => item.id === "chatgpt",
    )!;
    expect(provider).toBeTruthy();

    const start = await auth.handler(
      new Request(`${environment.BETTER_AUTH_URL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          origin: environment.BETTER_AUTH_URL,
          "content-type": "application/json",
          "x-savia-bridge-key": bridgeKey,
          "x-savia-social-tenant-id": "723004",
        },
        body: JSON.stringify({
          provider: "chatgpt",
          callbackURL: `${environment.BETTER_AUTH_URL}/api/auth/sso-complete`,
          disableRedirect: true,
        }),
      }),
    );
    expect(start.status).toBe(200);
    const authorization = new URL(
      ((await start.json()) as { url: string }).url,
    );
    expect(authorization.searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "profile",
      "email",
    ]);
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(authorization.searchParams.get("code_challenge")).toBeTruthy();
    const nonce = authorization.searchParams.get("nonce");
    expect(nonce).toBeTruthy();
    const idToken = await new SignJWT({
      sub: "chatgpt-subject",
      email: "proof-owner@example.test",
      email_verified: true,
      name: "Proof Owner",
      nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "chatgpt-test-key" })
      .setIssuer(CHATGPT_ISSUER)
      .setAudience(clientId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    provider.validateAuthorizationCode = async () => ({ idToken });
    const state = authorization.searchParams.get("state")!;
    const cookie = start.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const callback = await auth.handler(
      new Request(
        `${environment.BETTER_AUTH_URL}/api/auth/callback/chatgpt?code=fixture&state=${encodeURIComponent(state)}`,
        { headers: { cookie } },
      ),
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain(
      "/api/auth/chatgpt-email-verification?id=",
    );
    expect(
      callback.headers
        .getSetCookie()
        .some(
          (value) =>
            value.includes("chatgpt_email_verification") &&
            value.includes("HttpOnly"),
        ),
    ).toBe(true);
    expect(
      callback.headers
        .getSetCookie()
        .some((value) => value.includes("session_token=")),
    ).toBe(false);
    expect(
      await adapter.findOne({
        model: "user",
        where: [{ field: "email", value: "proof-owner@example.test" }],
      }),
    ).toBeNull();
    expect(
      await provenChatgptIdentity(
        {
          id: "a".repeat(64),
          iss: CHATGPT_ISSUER,
          clientId,
          email: "proof-owner@example.test",
        },
        723004,
        environment,
        adapter,
      ),
    ).toBeNull();
  });

  it.each([
    ["nonce", { nonce: "wrong-nonce" }],
    ["issuer", { iss: "https://attacker.example" }],
    ["audience", { aud: "oaiapp_other" }],
  ])(
    "rejects a signed ChatGPT callback with an invalid %s",
    async (_failure, override) => {
      const { privateKey, publicKey } = await generateKeyPair("RS256");
      const jwk = {
        ...(await exportJWK(publicKey)),
        kid: "chatgpt-invalid-key",
        alg: "RS256",
        use: "sig",
      };
      vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === `${CHATGPT_ISSUER}/.well-known/openid-configuration`)
          return Response.json({
            issuer: CHATGPT_ISSUER,
            authorization_endpoint: `${CHATGPT_ISSUER}/api/accounts/authorize`,
            token_endpoint: `${CHATGPT_ISSUER}/api/accounts/oauth/token`,
            jwks_uri: `${CHATGPT_ISSUER}/.well-known/jwks.json`,
          });
        if (url === `${CHATGPT_ISSUER}/.well-known/jwks.json`)
          return Response.json({ keys: [jwk] });
        throw new Error(`Unexpected external request: ${url}`);
      });
      await initializeAuthSchema(environment, dependencies);
      const handler = createAuthHandler(environment, dependencies);
      const auth = createBetterAuth(environment, dependencies);
      const context = await auth.$context;
      await enableChatgpt(handler);
      const provider = context.socialProviders.find(
        (item) => item.id === "chatgpt",
      )!;
      const start = await auth.handler(
        new Request(`${environment.BETTER_AUTH_URL}/api/auth/sign-in/social`, {
          method: "POST",
          headers: {
            origin: environment.BETTER_AUTH_URL,
            "content-type": "application/json",
            "x-savia-bridge-key": bridgeKey,
            "x-savia-social-tenant-id": "723004",
          },
          body: JSON.stringify({
            provider: "chatgpt",
            callbackURL: `${environment.BETTER_AUTH_URL}/api/auth/sso-complete`,
            disableRedirect: true,
          }),
        }),
      );
      const authorization = new URL(
        ((await start.json()) as { url: string }).url,
      );
      const expectedNonce = authorization.searchParams.get("nonce")!;
      const claims = {
        sub: `invalid-${_failure}`,
        email: `invalid-${_failure}@example.test`,
        email_verified: true,
        nonce: expectedNonce,
        ...(override as Record<string, string>),
      };
      const idToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "chatgpt-invalid-key" })
        .setIssuer(override.iss ?? CHATGPT_ISSUER)
        .setAudience(override.aud ?? clientId)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      provider.validateAuthorizationCode = async () => ({ idToken });
      const cookie = start.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const callback = await auth.handler(
        new Request(
          `${environment.BETTER_AUTH_URL}/api/auth/callback/chatgpt?code=fixture&state=${encodeURIComponent(authorization.searchParams.get("state")!)}`,
          { headers: { cookie } },
        ),
      );
      expect(callback.headers.get("location") ?? "").not.toContain(
        "/api/auth/chatgpt-email-verification",
      );
      expect(
        callback.headers
          .getSetCookie()
          .some((value) => value.includes("session_token=")),
      ).toBe(false);
      expect(
        await context.adapter.findOne({
          model: "user",
          where: [{ field: "email", value: claims.email }],
        }),
      ).toBeNull();
    },
  );
});

describe("ChatGPT link provisioning", () => {
  async function fixture() {
    await initializeAuthSchema(environment, dependencies);
    const handler = createAuthHandler(environment, dependencies);
    const auth = createBetterAuth(environment, dependencies);
    const adapter = (await auth.$context).adapter;
    await enableChatgpt(handler);
    const settings = await adapter.findOne<any>({
      model: "tenantSocialSettings",
      where: [{ field: "tenantId", value: 723004 }],
    });
    return { adapter, settings };
  }

  async function consumedPending(
    settings: { revision: string },
    email: string,
    envWithClient: typeof environment,
    adapter: Awaited<
      ReturnType<typeof createBetterAuth>
    >["$context"] extends Promise<infer Context>
      ? Context["adapter"]
      : never,
  ) {
    const { beginChatgptVerification } =
      await import("../src/microsoft-email-verification");
    const pending = await beginChatgptVerification(
      {
        id: crypto
          .randomUUID()
          .replaceAll("-", "")
          .padEnd(64, "a")
          .slice(0, 64),
        iss: CHATGPT_ISSUER,
        clientId,
        email,
        emailVerified: true,
        name: "ChatGPT Member",
      },
      {
        attemptId: crypto.randomUUID(),
        tenantId: 723004,
        provider: "chatgpt",
        revision: settings.revision,
        returnOrigin: "https://team.example.test",
        expiresAt: Date.now() + 600000,
      },
      crypto.randomUUID(),
      envWithClient,
      adapter,
    );
    await environment.AUTH_DB.prepare(
      "UPDATE pending_email_verification SET consumed_at=? WHERE id=?",
    )
      .bind(Date.now(), pending.id)
      .run();
    return pending;
  }

  it("links a precreated verified member while registration is off and rejects new/admin accounts", async () => {
    const { completeChatgptVerification } =
      await import("../src/microsoft-email-verification");
    const { adapter, settings } = await fixture();
    const memberEmail = `precreated-${crypto.randomUUID()}@example.test`;
    const member = await adapter.create<Record<string, unknown>, any>({
      model: "user",
      data: {
        email: memberEmail,
        emailVerified: true,
        emailTenantId: 723004,
        role: "user",
        name: "Precreated member",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    let calls = 0;
    const envWithIdentity = {
      ...environment,
      SAVIA_IDENTITY: {
        fetch: async (request: Request) => {
          calls++;
          const body = (await request.json()) as Record<string, unknown>;
          expect(new URL(request.url).pathname).toBe(
            "/_internal/social-registration/eligible",
          );
          expect(body.provider).toBe("chatgpt");
          expect(body.subject).toBe(member.id);
          return Response.json({ eligible: true });
        },
      },
    };
    const pending = await consumedPending(
      settings,
      memberEmail,
      envWithIdentity,
      adapter,
    );
    await completeChatgptVerification(pending, envWithIdentity, adapter);
    expect(calls).toBe(1);
    expect(
      await provenChatgptIdentity(
        {
          id: pending.providerSubject,
          iss: CHATGPT_ISSUER,
          clientId,
          email: memberEmail,
        },
        723004,
        environment,
        adapter,
      ),
    ).toMatchObject({ id: member.id, email: memberEmail, emailVerified: true });

    const newEmail = `disabled-${crypto.randomUUID()}@example.test`;
    const newPending = await consumedPending(
      settings,
      newEmail,
      environment,
      adapter,
    );
    await expect(
      completeChatgptVerification(newPending, environment, adapter),
    ).rejects.toThrow();
    expect(
      await adapter.findOne({
        model: "user",
        where: [{ field: "email", value: newEmail }],
      }),
    ).toBeNull();

    const adminEmail = `admin-${crypto.randomUUID()}@example.test`;
    await adapter.create<Record<string, unknown>, any>({
      model: "user",
      data: {
        email: adminEmail,
        emailVerified: true,
        emailTenantId: 723004,
        role: "admin",
        name: "Administrator",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const adminPending = await consumedPending(
      settings,
      adminEmail,
      envWithIdentity,
      adapter,
    );
    await expect(
      completeChatgptVerification(adminPending, envWithIdentity, adapter),
    ).rejects.toThrow();
    expect(calls).toBe(1);
    expect(
      await provenChatgptIdentity(
        {
          id: adminPending.providerSubject,
          iss: CHATGPT_ISSUER,
          clientId,
          email: adminEmail,
        },
        723004,
        environment,
        adapter,
      ),
    ).toBeNull();
  });
});
