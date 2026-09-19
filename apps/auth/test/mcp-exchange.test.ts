import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, jwtVerify } from "jose";
import worker, { createBetterAuth } from "../src/index";
import { oauthRuntime } from "../src/oauth";

const runtime = oauthRuntime(env);
const resource = `${runtime.apiResource}/mcp`;
const claim = "https://savia.hefesoft.com/";

async function token(overrides: Record<string, unknown> = {}) {
  return (
    await createBetterAuth(env).api.signJWT({
      body: {
        payload: {
          iss: runtime.issuer,
          aud: resource,
          sub: "mcp-user",
          scope: "savia.api.read offline_access",
          exp: Math.floor(Date.now() / 1000) + 300,
          [`${claim}email`]: "mcp@example.test",
          [`${claim}name`]: "MCP User",
          [`${claim}roles`]: ["user"],
          [`${claim}two-factor-enabled`]: false,
          ...overrides,
        },
      },
    })
  ).token;
}
async function exchange(accessToken?: string) {
  return worker.fetch(
    new Request("https://savia-auth.internal/_internal/oauth/mcp-exchange", {
      method: "POST",
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    }),
    env,
  );
}
beforeAll(async () => {
  await worker.fetch(
    new Request("https://savia-auth.internal/_internal/session"),
    env,
  );
});

describe("MCP token exchange", () => {
  it("issues a different short-lived API token without increasing privileges", async () => {
    const external = await token();
    const response = await exchange(external);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string };
    expect(body.access_token).not.toBe(external);
    const keys = await createBetterAuth(env).api.getJwks();
    const { payload } = await jwtVerify(
      body.access_token,
      createLocalJWKSet(keys),
      { issuer: runtime.issuer, audience: runtime.apiResource },
    );
    expect(payload.sub).toBe("mcp-user");
    expect(payload.scope).toBe("savia.api.read");
    expect(payload.exp! - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(
      120,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("never extends the incoming token lifetime", async () => {
    const exp = Math.floor(Date.now() / 1000) + 30;
    const response = await exchange(await token({ exp }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { access_token: string };
    const { payload } = await jwtVerify(
      body.access_token,
      createLocalJWKSet(await createBetterAuth(env).api.getJwks()),
    );
    expect(payload.exp).toBe(exp);
  });
  it("rejects missing, expired, API-audience and forged tokens", async () => {
    for (const value of [
      undefined,
      "forged",
      await token({ aud: runtime.apiResource }),
      await token({ exp: 1 }),
      await token({ iss: "https://wrong.test" }),
      await token({ cnf: { jkt: "bound-key" } }),
    ]) {
      expect((await exchange(value)).status).toBe(401);
    }
  });
  it("requires a read grant and complete identity claims", async () => {
    expect((await exchange(await token({ scope: "openid" }))).status).toBe(403);
    expect(
      (await exchange(await token({ [`${claim}email`]: undefined }))).status,
    ).toBe(401);
  });
  it("publishes DCR and registers untrusted MCP clients with PKCE", async () => {
    const metadata = await worker.fetch(
      new Request(
        `${runtime.apiResource}/.well-known/oauth-authorization-server/api/auth`,
      ),
      env,
    );
    const discovery = (await metadata.json()) as Record<string, any>;
    expect(discovery.registration_endpoint).toContain("/oauth2/register");
    expect(discovery.code_challenge_methods_supported).toContain("S256");
    const registration = await worker.fetch(
      new Request(discovery.registration_endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "MCP test client",
          redirect_uris: ["https://client.example/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          scope: "savia.api.read offline_access",
        }),
      }),
      env,
    );
    expect(registration.status).toBe(201);
    const client = (await registration.json()) as { client_id: string };
    const row = await env.AUTH_DB.prepare(
      'SELECT "skipConsent", "requirePKCE" FROM "oauthClient" WHERE "clientId" = ?',
    )
      .bind(client.client_id)
      .first();
    expect(row?.skipConsent).not.toBe(1);
    const authorizationUrl = new URL(discovery.authorization_endpoint);
    authorizationUrl.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "https://client.example/callback",
      response_type: "code",
      scope: "savia.api.read",
      resource,
    }).toString();
    const withoutPkce = await worker.fetch(new Request(authorizationUrl), env);
    const failure = new URL(withoutPkce.headers.get("location")!);
    expect(failure.searchParams.get("error")).toBe("invalid_request");
    expect(failure.searchParams.get("error_description")).toMatch(
      /pkce|code.challenge/i,
    );
  });
});

it("completes authorization-code PKCE, consent and refresh for a dynamically registered MCP client", async () => {
  const auth = createBetterAuth(env);
  const email = `mcp-flow-${crypto.randomUUID()}@example.test`;
  await auth.api.createUser({
    body: {
      email,
      name: "MCP Flow User",
      password: "TestPassword321!",
      role: "user",
      data: { emailVerified: true },
    },
  });
  const signIn = await worker.fetch(
    new Request(`${runtime.apiResource}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: runtime.apiResource,
      },
      body: JSON.stringify({ email, password: "TestPassword321!" }),
    }),
    env,
  );
  expect(signIn.status).toBe(200);
  const cookie = signIn.headers.get("set-cookie")!;
  const registration = await worker.fetch(
    new Request(`${runtime.issuer}/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Full flow",
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "openid savia.api.read offline_access",
      }),
    }),
    env,
  );
  expect(registration.status).toBe(201);
  const { client_id } = (await registration.json()) as { client_id: string };
  const verifier = "v".repeat(64);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const query = new URLSearchParams({
    client_id,
    response_type: "code",
    redirect_uri: "https://client.example/callback",
    scope: "openid savia.api.read offline_access",
    resource,
    state: "test-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const authorize = await worker.fetch(
    new Request(`${runtime.issuer}/oauth2/authorize?${query}`, {
      headers: { cookie },
    }),
    env,
  );
  expect(authorize.status).toBe(302);
  const consentUrl = new URL(
    authorize.headers.get("location")!,
    runtime.apiResource,
  );
  expect(consentUrl.pathname).toBe("/api/auth/consent");
  const consent = await worker.fetch(
    new Request(`${runtime.issuer}/oauth2/consent`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin: runtime.apiResource,
      },
      body: JSON.stringify({
        accept: true,
        oauth_query: consentUrl.search.slice(1),
      }),
    }),
    env,
  );
  expect(consent.status).toBe(200);
  const approved = (await consent.json()) as { url: string };
  const callback = new URL(approved.url);
  expect(callback.searchParams.get("state")).toBe("test-state");
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();
  const tokenRequest = (body: URLSearchParams) =>
    worker.fetch(
      new Request(`${runtime.issuer}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
      env,
    );
  const issued = await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id,
      code: code!,
      redirect_uri: "https://client.example/callback",
      code_verifier: verifier,
      resource,
    }),
  );
  expect(issued.status).toBe(200);
  const credentials = (await issued.json()) as {
    access_token: string;
    refresh_token: string;
  };
  expect(credentials.refresh_token).toBeTruthy();
  expect((await exchange(credentials.access_token)).status).toBe(200);
  const refreshed = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id,
      refresh_token: credentials.refresh_token,
      resource,
    }),
  );
  expect(refreshed.status).toBe(200);
  const renewed = (await refreshed.json()) as { access_token: string };
  expect((await exchange(renewed.access_token)).status).toBe(200);
});
