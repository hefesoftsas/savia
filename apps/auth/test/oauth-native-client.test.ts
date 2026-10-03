import { beforeAll, describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
import { oauthManagementResponse, oauthProviderOptions } from "../src/oauth";
import { env } from "cloudflare:workers";
import worker, { createBetterAuth } from "../src/index";
import { oauthRuntime } from "../src/oauth";

const callback = "com.hefesoft.savia.companion.preview:/oauth/callback";
let createdClientBody: Record<string, unknown> | undefined;
let updatedClientBody: Record<string, unknown> | undefined;
beforeAll(async () => {
  await worker.fetch(
    new Request("https://savia-auth.internal/_internal/session"),
    env,
  );
});
const admin = {
  api: {
    async getSession() {
      return { user: { role: "admin" } };
    },
    async adminCreateOAuthClient({ body }: { body: Record<string, unknown> }) {
      createdClientBody = body;
      return { client_id: "native-client", ...body };
    },
    async adminUpdateOAuthClient(input: Record<string, unknown>) {
      updatedClientBody = input;
      return {};
    },
    async deleteOAuthClient() {},
    async rotateClientSecret() {
      return { client_secret: "secret" };
    },
  },
};
const database = {
  prepare() {
    return {
      bind() {
        return this;
      },
      async first() {
        return null;
      },
      async all() {
        return { results: [] };
      },
    };
  },
} as unknown as D1Database;

async function create(body: Record<string, unknown>) {
  return oauthManagementResponse(
    admin,
    database,
    new Request("https://savia-auth.internal/_internal/oauth/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const nativeClient = {
  applicationType: "native",
  clientAuthentication: "none",
  clientName: "Companion Preview",
  redirectUris: [callback],
  scopes: ["openid", "profile", "offline_access", "recordings:read"],
  trusted: false,
  grantTypes: ["authorization_code", "refresh_token"],
};

describe("managed native OAuth clients", () => {
  it("registers the exact public callback with PKCE and refresh grants", async () => {
    const response = await create(nativeClient);
    expect(response?.status, await response?.clone().text()).toBe(201);
    const result = (await response!.json()) as {
      data: Record<string, unknown>;
    };
    expect(result.data.applicationType).toBe("native");
    expect(result.data.clientAuthentication).toBe("none");
    expect(result.data.redirectUris).toEqual([callback]);
    expect(result.data.grantTypes).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(createdClientBody).toMatchObject({
      application_type: "native",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [callback],
      require_pkce: true,
      token_endpoint_auth_method: "none",
    });
  });

  it.each([
    "com.hefesoft.savia.companion.preview://*/oauth/callback",
    "com.hefesoft.savia.companion.preview:/oauth/callback#fragment",
    "com.hefesoft.savia.companion.preview:/oauth/callback#",
    "com.hefesoft.savia.companion.preview:/oauth/callback?",
    "com.hefesoft.savia.companion.preview://user@host/callback",
    "https://client.example/callback",
  ])("rejects invalid or mixed native callback %s", async (redirectUri) => {
    const response = await create({
      ...nativeClient,
      redirectUris: [redirectUri],
    });
    expect(response?.status).toBe(400);
  });

  it.each([
    "javascript:/oauth/callback",
    "data:/oauth/callback",
    "com.example.app:oauth/callback",
    "com.example.app://oauth/callback",
    "http://client.example/callback",
  ])("rejects unsafe native scheme/path %s", async (redirectUri) => {
    const response = await create({
      ...nativeClient,
      redirectUris: [redirectUri],
    });
    expect(response?.status).toBe(400);
  });

  it("rejects a secret authentication method for declared native clients", async () => {
    const response = await create({
      ...nativeClient,
      clientAuthentication: "client_secret_basic",
    });
    expect(response?.status).toBe(400);
  });

  it("rejects converting a confidential web client to native on PATCH", async () => {
    updatedClientBody = undefined;
    const webClientDatabase = {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            return {
              clientId: "confidential-web",
              name: "Confidential Web Client",
              redirectUris: JSON.stringify(["https://client.example/callback"]),
              grantTypes: JSON.stringify(["authorization_code"]),
              scopes: JSON.stringify(["openid", "savia.api.read"]),
              tokenEndpointAuthMethod: "client_secret_basic",
              applicationType: "web",
              skipConsent: 0,
            };
          },
          async all() {
            return { results: [] };
          },
        };
      },
    } as unknown as D1Database;
    const response = await oauthManagementResponse(
      admin,
      webClientDatabase,
      new Request(
        "https://savia-auth.internal/_internal/oauth/clients/confidential-web",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            applicationType: "native",
            redirectUris: [callback],
          }),
        },
      ),
    );
    expect(response?.status).toBe(400);
    expect(updatedClientBody).toBeUndefined();
  });

  it("preserves name-only updates for a legacy native loopback client", async () => {
    updatedClientBody = undefined;
    const loopbackClientDatabase = {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            return {
              clientId: "loopback-native",
              name: "Legacy Loopback Client",
              redirectUris: JSON.stringify([
                "http://localhost:5173/auth/callback",
              ]),
              grantTypes: JSON.stringify(["authorization_code"]),
              scopes: JSON.stringify(["openid", "savia.api.read"]),
              tokenEndpointAuthMethod: "none",
              applicationType: "native",
              skipConsent: 0,
            };
          },
          async all() {
            return { results: [] };
          },
        };
      },
    } as unknown as D1Database;
    const response = await oauthManagementResponse(
      admin,
      loopbackClientDatabase,
      new Request(
        "https://savia-auth.internal/_internal/oauth/clients/loopback-native",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clientName: "Renamed Loopback Client" }),
        },
      ),
    );
    expect(response?.status).toBe(200);
    expect(updatedClientBody).toMatchObject({
      body: {
        update: {
          application_type: "native",
          redirect_uris: ["http://localhost:5173/auth/callback"],
        },
      },
    });
  });

  it("rejects mixed registered redirects for a native client", async () => {
    const response = await create({
      ...nativeClient,
      redirectUris: [callback, "https://client.example/callback"],
    });
    expect(response?.status).toBe(400);
  });

  it("keeps existing web client defaults on authorization code only", async () => {
    const response = await create({
      ...nativeClient,
      applicationType: undefined,
      clientAuthentication: "client_secret_basic",
      redirectUris: ["https://client.example/callback"],
      grantTypes: undefined,
    });
    expect(response?.status, await response?.clone().text()).toBe(201);
    const result = (await response!.json()) as {
      data: Record<string, unknown>;
    };
    expect(result.data.applicationType).toBe("web");
    expect(result.data.grantTypes).toEqual(["authorization_code"]);
    expect(
      oauthProviderOptions({ BETTER_AUTH_URL: "https://savia.test" })
        .grantTypes,
    ).toContain("refresh_token");
  });

  it("publishes recording scopes on the Savia API resource", () => {
    const options = oauthProviderOptions({
      BETTER_AUTH_URL: "https://savia.test",
    });
    expect(options.scopes).toEqual(
      expect.arrayContaining([
        "recordings:read",
        "recordings:upload",
        "recordings:process",
      ]),
    );
    expect(options.clientRegistrationDefaultScopes).not.toEqual(
      expect.arrayContaining([
        "recordings:read",
        "recordings:upload",
        "recordings:process",
      ]),
    );
    expect(options.clientRegistrationAllowedScopes).toEqual(
      expect.arrayContaining([
        "recordings:read",
        "recordings:upload",
        "recordings:process",
      ]),
    );
    expect(
      options.resources?.find(
        (resource) => resource.identifier === "https://savia.test",
      )?.allowedScopes,
    ).toEqual(
      expect.arrayContaining([
        "recordings:read",
        "recordings:upload",
        "recordings:process",
      ]),
    );
    expect(
      options.resources?.find(
        (resource) => resource.identifier === "https://savia.test/mcp",
      )?.allowedScopes,
    ).not.toEqual(
      expect.arrayContaining([
        "recordings:read",
        "recordings:upload",
        "recordings:process",
      ]),
    );
  });
});

it("preserves the API audience through native code exchange, rotation, and revocation", async () => {
  const runtime = oauthRuntime(env);
  const auth = createBetterAuth(env);
  const email = `native-flow-${crypto.randomUUID()}@example.test`;
  await auth.api.createUser({
    body: {
      email,
      name: "Native Flow User",
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
  const callbackUri = "com.hefesoft.savia.companion.preview:/oauth/callback";
  const registration = await worker.fetch(
    new Request(`${runtime.issuer}/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Native Companion flow",
        application_type: "native",
        redirect_uris: [callbackUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope:
          "openid profile offline_access recordings:read recordings:upload recordings:process",
      }),
    }),
    env,
  );
  expect(registration.status, await registration.clone().text()).toBe(201);
  const { client_id: clientId } = (await registration.json()) as {
    client_id: string;
  };
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
    client_id: clientId,
    response_type: "code",
    redirect_uri: callbackUri,
    scope:
      "openid profile offline_access recordings:read recordings:upload recordings:process",
    resource: runtime.apiResource,
    state: "native-test-state",
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
  const callback = new URL(((await consent.json()) as { url: string }).url);
  expect(`${callback.protocol}${callback.pathname}`).toBe(callbackUri);
  const code = callback.searchParams.get("code")!;
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
      client_id: clientId,
      code,
      redirect_uri: callbackUri,
      code_verifier: verifier,
      // AppAuth carries the authorized resource in the code; its combined
      // exchange does not repeat custom authorization parameters.
    }),
  );
  expect(issued.status).toBe(200);
  const credentials = (await issued.json()) as {
    refresh_token: string;
    access_token: string;
  };
  expect([decodeJwt(credentials.access_token).aud].flat()).toContain(
    runtime.apiResource,
  );
  expect(credentials.refresh_token).toBeTruthy();
  const firstRefresh = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: credentials.refresh_token,
      resource: runtime.apiResource,
    }),
  );
  expect(firstRefresh.status).toBe(200);
  const rotated = (await firstRefresh.json()) as {
    refresh_token: string;
    access_token: string;
  };
  expect([decodeJwt(rotated.access_token).aud].flat()).toContain(
    runtime.apiResource,
  );
  expect(rotated.refresh_token).not.toBe(credentials.refresh_token);
  const revoke = await worker.fetch(
    new Request(`${runtime.issuer}/oauth2/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: rotated.refresh_token,
        token_type_hint: "refresh_token",
        client_id: clientId,
      }),
    }),
    env,
  );
  expect(revoke.status, await revoke.clone().text()).toBe(200);
  expect(
    (
      await tokenRequest(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: credentials.refresh_token,
          resource: runtime.apiResource,
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await tokenRequest(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: rotated.refresh_token,
          resource: runtime.apiResource,
        }),
      )
    ).status,
  ).toBe(400);
});
