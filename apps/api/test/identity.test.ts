import { installInsuranceFixture } from "./insurance-fixtures";
import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./combined-app";
import {
  ensureBootstrapAdministrator,
  findPrincipalBySubject,
  upsertPrincipal,
} from "../src/auth/identity-repository";
import {
  createOAuthResourceAuthenticator,
  serviceBoundOAuthAccessTokenVerifier,
} from "../src/auth/oauth-resource";
import {
  agencyMemberAuthenticator,
  platformAdministratorAuthenticator,
} from "./auth-fixtures";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

function migrationStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

async function applyMigrations() {
  for (const migration of migrationSqls) {
    for (const statement of migrationStatements(migration)) {
      await env.DB.exec(statement);
    }
  }
}

async function seedAgency(id = 101): Promise<void> {
  await installInsuranceFixture(env.DB, "domain:platform", `agency:${id}`);
  await env.DB.prepare(
    "INSERT INTO tenants (id, id_slug, name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, '2026-01-01', '2026-01-01')",
  )
    .bind(id, `identity-acme-${id}`, `Identity Acme ${id}`)
    .run();
  const sql = `
    INSERT INTO agencies (
      id, tenant_id, id_slug, created_at, updated_at, name, address, id_check_digit,
      id_number, lr_id_number, lr_id_type, lr_name, payments_email, is_active,
      email, is_in_house, email_domain, birthday_from_email, payment_from_email,
      renewal_from_email, home_url, short_name, seller_required, has_compliance,
      surnames, type, theme
    ) VALUES (
      ${id}, ${id}, 'identity-acme-${id}', '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z', 'Identity Acme ${id}', 'Calle 1 # 2-3', '4',
      '900123456', '12345678', 'CC', 'Ada Lovelace', 'payments@acme.test', 1,
      'hello@acme.test', 0, 'acme.test', 'birthdays@acme.test',
      'payments@acme.test', 'renewals@acme.test', 'https://acme.test', 'Acme ${id}',
      0, 0, 'Lovelace', 'broker', 'default'
    );
  `;
  await env.DB.exec(sql.replace(/\s+/g, " ").trim());
}

const oauthIssuer = "https://auth.savia.test/api/auth";
const oauthResource = "https://api.savia.test";
const oauthBearer = "header.payload.signature";

function validOAuthClaims(overrides: Record<string, unknown> = {}) {
  return {
    sub: "oauth-administrator",
    scope: "savia.api.read",
    "https://savia.hefesoft.com/roles": ["admin"],
    "https://savia.hefesoft.com/email": "oauth.admin@savia.test",
    "https://savia.hefesoft.com/name": "OAuth Administrator",
    "https://savia.hefesoft.com/two-factor-enabled": true,
    ...overrides,
  };
}

function oauthAuthenticator(claims = validOAuthClaims()) {
  return createOAuthResourceAuthenticator({
    issuer: oauthIssuer,
    resource: oauthResource,
    verifyAccessToken: async () => claims,
  });
}

const oauthClientAdministrator = {
  async list() {
    return [
      {
        applicationType: "web",
        clientAuthentication: "none",
        clientId: "existing-public-client",
        clientName: "Existing public client",
        redirectUris: ["https://existing.savia.test/callback"],
        scopes: ["openid", "savia.api.read"],
        trusted: false,
      },
    ];
  },
  async create(input: {
    clientAuthentication: string;
    clientName: string;
    redirectUris: string[];
    scopes: string[];
    trusted: boolean;
  }) {
    return {
      applicationType: "web",
      clientAuthentication: input.clientAuthentication,
      clientId: "created-client",
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      scopes: input.scopes,
      trusted: input.trusted,
      ...(input.clientAuthentication === "none"
        ? {}
        : { clientSecret: "returned-once" }),
    };
  },
  async update(
    clientId: string,
    input: { clientName?: string; redirectUris?: string[]; scopes?: string[] },
  ) {
    return {
      applicationType: "web",
      clientAuthentication: "none",
      clientId,
      clientName: input.clientName ?? "Updated client",
      redirectUris: input.redirectUris ?? [
        "https://updated.savia.test/callback",
      ],
      scopes: input.scopes ?? ["openid", "savia.api.read"],
      trusted: false,
    };
  },
  async disable() {},
  async rotateSecret(clientId: string) {
    return { clientId, clientSecret: "rotated-once" };
  },
};

function identityUserAdministrator(
  overrides: Partial<{
    createUser(): Promise<{
      subject: string;
      email: string;
      displayName: string;
    }>;
    listUsers(): Promise<
      Array<{
        subject: string;
        email: string;
        displayName: string;
        role: "admin" | "user";
        isBanned: boolean;
        twoFactorEnabled: boolean;
      }>
    >;
    sendPasswordReset(subject: string): Promise<void>;
  }> = {},
) {
  const accounts = new Map<
    string,
    {
      subject: string;
      email: string;
      displayName: string;
      role: "admin" | "user";
      isBanned: boolean;
      twoFactorEnabled: boolean;
    }
  >();
  return {
    issuer: "savia:better-auth",
    async listUsers() {
      return [...accounts.values()];
    },
    async getUser(subject: string) {
      return {
        subject,
        email: "new.user@acme.test",
        displayName: "New User",
        role: "user" as const,
        isBanned: false,
        twoFactorEnabled: false,
      };
    },
    async createUser(input: {
      email: string;
      firstName: string;
      lastName: string;
      platformAdmin: boolean;
      temporaryPassword?: string;
    }) {
      const account = {
        subject: "better-auth-new-user",
        email: input.email,
        displayName: `${input.firstName} ${input.lastName}`,
        role: input.platformAdmin ? ("admin" as const) : ("user" as const),
        isBanned: false,
        twoFactorEnabled: false,
      };
      accounts.set(account.subject, account);
      return account;
    },
    async updateUser(subject: string) {
      return {
        subject,
        email: "new.user@acme.test",
        displayName: "New User",
        role: "user" as const,
        isBanned: false,
        twoFactorEnabled: false,
      };
    },
    async setAccountActive(subject: string) {
      return {
        subject,
        email: "new.user@acme.test",
        displayName: "New User",
        role: "user" as const,
        isBanned: false,
        twoFactorEnabled: false,
      };
    },
    async revokeSessions() {},
    async sendPasswordReset() {},
    async deleteUser(subject: string) {
      accounts.delete(subject);
    },
    ...overrides,
  };
}

describe("Identity and access", () => {
  beforeAll(applyMigrations);
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM document_ownership");
    await env.DB.exec("DELETE FROM customer_naturalperson");
    await env.DB.exec("DELETE FROM customer_legalperson");
    await env.DB.exec("DELETE FROM customer_clientagency");
    await env.DB.exec("DELETE FROM identity_tenant_membership");
    await env.DB.exec("DELETE FROM identity_global_role");
    await env.DB.exec("DELETE FROM identity_principal");
    await env.DB.exec("DELETE FROM agencies");
    // These fixtures recreate tenant IDs; clear their scoped ACL state as well.
    await env.DB.exec("DELETE FROM access_roles WHERE scope LIKE 'tenant:%'");
    await env.DB.exec(
      "DELETE FROM access_revisions WHERE scope LIKE 'tenant:%'",
    );
    await env.DB.exec("DELETE FROM tenants");
  });

  it("rejects an API request that has no active Better Auth session", async () => {
    const app = createApp(env.DB, env.DOCUMENTS);

    const response = await app.request("/v1/domains");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "AUTHENTICATION_UNAVAILABLE",
        message: "Authentication is not configured",
      },
    });
  });

  it("proxies Better Auth and accepts its private session service", async () => {
    const authService = {
      async fetch(request: Request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/api/auth/sign-in/email") {
          expect(await request.json()).toEqual({
            email: "admin@savia.test",
            password: "session-token",
          });
        }
        if (pathname === "/api/auth/request-password-reset") {
          expect(await request.json()).toEqual({
            email: "admin@savia.test",
          });
        }
        if (pathname === "/_internal/session") {
          expect(request.headers.get("cookie")).toContain(
            "savia.session_token=session-token",
          );
          return Response.json({
            user: {
              id: "better-auth-administrator",
              email: "admin@savia.test",
              name: "Savia Test Administrator",
              role: "admin",
              twoFactorEnabled: true,
            },
          });
        }
        return Response.json({ path: pathname });
      },
    };
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      undefined,
      undefined,
      undefined,
      authService,
    );

    const authResponse = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "admin@savia.test",
        password: "session-token",
      }),
    });
    expect(authResponse.status).toBe(200);
    expect(await authResponse.json()).toEqual({
      path: "/api/auth/sign-in/email",
    });

    const passwordResetResponse = await app.request(
      "/api/auth/request-password-reset",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@savia.test" }),
      },
    );
    expect(passwordResetResponse.status).toBe(200);
    expect(await passwordResetResponse.json()).toEqual({
      path: "/api/auth/request-password-reset",
    });

    const identityResponse = await app.request("/v1/identity/me", {
      headers: { cookie: "savia.session_token=session-token" },
    });
    expect(identityResponse.status).toBe(200);
    expect(await identityResponse.json()).toEqual({
      data: expect.objectContaining({
        attributes: expect.objectContaining({ email: "admin@savia.test" }),
      }),
    });
  });

  it("grants platform access to a Better Auth administrator after a legacy administrator", async () => {
    const legacyPrincipal = await upsertPrincipal(env.DB, {
      issuer: "savia:better-auth",
      subject: "legacy-administrator",
      email: "legacy.admin@savia.test",
      displayName: "Legacy Administrator",
    });
    await ensureBootstrapAdministrator(env.DB, legacyPrincipal.id);
    const authService = {
      async fetch(request: Request) {
        if (new URL(request.url).pathname === "/_internal/session") {
          return Response.json({
            user: {
              id: "better-auth-administrator",
              email: "admin@savia.test",
              name: "Savia Test Administrator",
              role: "admin",
              twoFactorEnabled: true,
            },
          });
        }
        return Response.json({ user: null });
      },
    };
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      undefined,
      undefined,
      undefined,
      authService,
    );

    const response = await app.request("/v1/tenants", {
      headers: { cookie: "savia.session_token=session-token" },
    });

    expect(response.status).toBe(200);
  });

  it("prevents a platform administrator without MFA enrollment from using Savia", async () => {
    const authService = {
      async fetch(request: Request) {
        if (new URL(request.url).pathname === "/_internal/session") {
          return Response.json({
            user: {
              id: "better-auth-administrator-without-mfa",
              email: "admin-without-mfa@savia.test",
              name: "Savia Test Administrator",
              role: "admin",
              twoFactorEnabled: false,
            },
          });
        }
        return Response.json({ user: null });
      },
    };
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      undefined,
      undefined,
      undefined,
      authService,
    );

    const response = await app.request("/v1/identity/me");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "MFA_ENROLLMENT_REQUIRED",
        message:
          "Platform administrators must enroll TOTP multi-factor authentication",
      },
    });
  });

  it("accepts a verified OAuth access token for reads and rejects missing write scope", async () => {
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      oauthAuthenticator(),
    );

    const [read, write] = await Promise.all([
      app.request("/v1/identity/me", {
        headers: { authorization: `Bearer ${oauthBearer}` },
      }),
      app.request("/v1/domains", {
        method: "POST",
        headers: { authorization: `Bearer ${oauthBearer}` },
      }),
    ]);

    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({
      data: expect.objectContaining({
        attributes: expect.objectContaining({
          email: "oauth.admin@savia.test",
        }),
      }),
    });
    expect(write.status).toBe(403);
    expect(await write.json()).toEqual({
      error: {
        code: "INSUFFICIENT_SCOPE",
        message: "The access token does not grant savia.api.write",
      },
    });
  });

  it("rejects OAuth tokens with malformed claims, missing read scope, or failed verification", async () => {
    const cases = [
      {
        authenticator: oauthAuthenticator(
          validOAuthClaims({ scope: "savia.api.write" }),
        ),
        expected: { status: 403, code: "INSUFFICIENT_SCOPE" },
      },
      {
        authenticator: oauthAuthenticator(
          validOAuthClaims({ "https://savia.hefesoft.com/roles": "admin" }),
        ),
        expected: { status: 401, code: "AUTHENTICATION_REQUIRED" },
      },
      {
        authenticator: createOAuthResourceAuthenticator({
          issuer: oauthIssuer,
          resource: oauthResource,
          verifyAccessToken: async () => {
            throw new Error("wrong audience");
          },
        }),
        expected: { status: 401, code: "AUTHENTICATION_REQUIRED" },
      },
      {
        authenticator: createOAuthResourceAuthenticator({
          issuer: oauthIssuer,
          resource: oauthResource,
          verifyAccessToken: async () => {
            throw new Error("expired token");
          },
        }),
        expected: { status: 401, code: "AUTHENTICATION_REQUIRED" },
      },
    ];

    for (const scenario of cases) {
      const app = createApp(
        env.DB,
        env.DOCUMENTS,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        scenario.authenticator,
      );
      const response = await app.request("/v1/identity/me", {
        headers: { authorization: `Bearer ${oauthBearer}` },
      });
      expect(response.status).toBe(scenario.expected.status);
      expect(await response.json()).toEqual({
        error: expect.objectContaining({ code: scenario.expected.code }),
      });
    }
  });

  it("records the verification error category without exposing a rejected bearer token", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const authenticator = createOAuthResourceAuthenticator({
      issuer: oauthIssuer,
      resource: oauthResource,
      verifyAccessToken: async () => {
        throw new TypeError("signature verification failed");
      },
    });

    try {
      await expect(
        authenticator.authenticate(
          new Request("https://api.savia.test/v1/identity/me", {
            headers: { authorization: `Bearer ${oauthBearer}` },
          }),
        ),
      ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

      expect(consoleError).toHaveBeenCalledWith(
        "Savia OAuth access token validation failed: TypeError",
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("records a JWKS retrieval failure without exposing its response", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const authenticator = createOAuthResourceAuthenticator({
      issuer: oauthIssuer,
      resource: oauthResource,
      verifyAccessToken: async () => {
        throw new Error("Jwks failed: upstream response omitted");
      },
    });

    try {
      await expect(
        authenticator.authenticate(
          new Request("https://savia.example.test/v1/identity/me", {
            headers: { authorization: "Bearer ignored" },
          }),
        ),
      ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

      expect(consoleError).toHaveBeenCalledWith(
        "Savia OAuth access token validation failed: jwks_fetch_failed",
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("verifies an access token with JWKS from the authentication service binding", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "test-key";
    const token = await new SignJWT(validOAuthClaims())
      .setProtectedHeader({ alg: "EdDSA", kid: publicJwk.kid })
      .setIssuer(oauthIssuer)
      .setAudience(oauthResource)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe("https://savia-auth.internal/api/auth/jwks");
      return Response.json({ keys: [publicJwk] });
    });
    const authenticator = createOAuthResourceAuthenticator({
      issuer: oauthIssuer,
      resource: oauthResource,
      verifyAccessToken: serviceBoundOAuthAccessTokenVerifier({ fetch }),
    });

    await expect(
      authenticator.authenticate(
        new Request("https://api.savia.test/v1/identity/me", {
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    ).resolves.toMatchObject({ subject: "oauth-administrator" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("publishes protected-resource metadata for OAuth clients", async () => {
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      oauthAuthenticator(),
    );

    const response = await app.request("/.well-known/oauth-protected-resource");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: oauthResource,
      authorization_servers: [oauthIssuer],
      scopes_supported: ["savia.api.read", "savia.api.write"],
    });
  });

  it("allows only platform administrators to manage OAuth clients and never returns a public secret", async () => {
    const administratorApp = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
      undefined,
      undefined,
      undefined,
      undefined,
      oauthClientAdministrator,
    );
    const memberApp = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      agencyMemberAuthenticator(),
      undefined,
      undefined,
      undefined,
      undefined,
      oauthClientAdministrator,
    );

    const [listed, forbidden, created] = await Promise.all([
      administratorApp.request("/v1/identity/oauth-clients"),
      memberApp.request("/v1/identity/oauth-clients"),
      administratorApp.request("/v1/identity/oauth-clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientName: "Front office",
          redirectUris: ["https://front.savia.test/callback"],
          scopes: ["openid", "savia.api.read"],
          clientAuthentication: "none",
          trusted: false,
        }),
      }),
    ]);

    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      data: [expect.objectContaining({ clientId: "existing-public-client" })],
    });
    expect(forbidden.status).toBe(403);
    expect(created.status).toBe(201);
    const createdData = await created.json<{ data: Record<string, unknown> }>();
    expect(createdData.data).toEqual(
      expect.objectContaining({ clientId: "created-client" }),
    );
    expect(createdData.data).not.toHaveProperty("clientSecret");
  });

  it("reveals a confidential client secret only at creation or rotation", async () => {
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
      undefined,
      undefined,
      undefined,
      undefined,
      oauthClientAdministrator,
    );

    const created = await app.request("/v1/identity/oauth-clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Back office",
        redirectUris: ["https://back.savia.test/callback"],
        scopes: ["openid", "savia.api.read", "savia.api.write"],
        clientAuthentication: "client_secret_post",
        trusted: false,
      }),
    });
    const rotated = await app.request(
      "/v1/identity/oauth-clients/confidential-client/rotate-secret",
      { method: "POST" },
    );

    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      data: expect.objectContaining({ clientSecret: "returned-once" }),
    });
    expect(rotated.status).toBe(200);
    expect(await rotated.json()).toEqual({
      data: { clientId: "confidential-client", clientSecret: "rotated-once" },
    });
  });

  it("returns the authenticated principal and its authorization data", async () => {
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
    );

    const response = await app.request("/v1/identity/me");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        id: "test-platform-admin",
        kind: "identity-principal",
        attributes: {
          email: "admin@savia.test",
          displayName: "Savia Test Administrator",
          isActive: true,
          globalRoles: ["platform_admin"],
        },
        relationships: { memberships: [] },
      },
    });
  });

  it("allows only platform administrators to list Savia users", async () => {
    const administratorApp = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
      identityUserAdministrator(),
    );
    const memberApp = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      agencyMemberAuthenticator(),
    );

    const [administratorResponse, memberResponse] = await Promise.all([
      administratorApp.request("/v1/identity/users"),
      memberApp.request("/v1/identity/users"),
    ]);

    expect(administratorResponse.status).toBe(200);
    expect(await administratorResponse.json()).toEqual({ data: [] });
    expect(memberResponse.status).toBe(403);
    expect(await memberResponse.json()).toEqual({
      error: {
        code: "AUTHORIZATION_FORBIDDEN",
        message: "A platform administrator role is required",
      },
    });
  });

  it("provisions a Better Auth user and stores only its identity and membership", async () => {
    await seedAgency();
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
      identityUserAdministrator(),
    );

    const response = await app.request("/v1/identity/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "new.user@acme.test",
        firstName: "New",
        lastName: "User",
        platformAdmin: false,
        membership: { agencyId: 101, role: "operator" },
      }),
    });

    expect(response.status).toBe(201);
    const created = await response.json<{
      data: { id: string; kind: string; attributes: { email: string } };
    }>();
    expect(created.data).toEqual(
      expect.objectContaining({
        kind: "identity-principal",
        attributes: expect.objectContaining({ email: "new.user@acme.test" }),
      }),
    );
    expect(JSON.stringify(created)).not.toContain("password");

    const users = await app.request("/v1/identity/users");
    expect(await users.json()).toEqual({
      data: [
        expect.objectContaining({
          id: created.data.id,
          relationships: {
            memberships: [
              expect.objectContaining({
                role: "operator",
                relationships: { tenant: { id: "101" }, agency: { id: "101" } },
              }),
            ],
          },
        }),
      ],
    });

    await seedAgency(102);
    const membershipResponse = await app.request(
      `/v1/identity/users/${created.data.id}/memberships`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agencyId: 102, role: "viewer" }),
      },
    );
    expect(membershipResponse.status).toBe(409);
    expect(await membershipResponse.json()).toMatchObject({
      error: { code: "LAST_ACTIVE_MEMBER" },
    });

    const deleteResponse = await app.request(
      `/v1/identity/users/${created.data.id}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(409);
    expect(await deleteResponse.json()).toMatchObject({
      error: { code: "LAST_ACTIVE_MEMBER" },
    });
  });

  it("rejects provisioning an ordinary user without a tenant", async () => {
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
      identityUserAdministrator(),
    );

    const response = await app.request("/v1/identity/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "no-tenant@savia.test",
        firstName: "No",
        lastName: "Tenant",
      }),
    });

    expect(response.status).toBe(400);
  });

  it("moves a promoted administrator to the internal tenant", async () => {
    await seedAgency();
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
      identityUserAdministrator(),
    );
    const created = await app.request("/v1/identity/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "promote@savia.test",
        firstName: "Promote",
        lastName: "User",
        membership: { tenantId: 101, role: "tenant_admin" },
      }),
    });
    const { data } = await created.json<{ data: { id: string } }>();
    await env.DB.exec(
      "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES('supporting-member','test','supporting-member','supporting@savia.test','Supporting Member',1,'2026-09-15','2026-09-15')",
    );
    await env.DB.exec(
      "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES('supporting-membership','supporting-member',101,'viewer',1,'2026-09-15','2026-09-15')",
    );

    const response = await app.request(`/v1/identity/users/${data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platformAdmin: true }),
    });

    expect(response.status).toBe(200);
    expect(
      (await response.json()).data.relationships.memberships[0],
    ).toMatchObject({
      relationships: { tenant: { id: "0" } },
    });
  });

  it("uses a temporary password for a provisioned user without emailing a reset", async () => {
    await seedAgency();
    let provisionInput:
      | {
          email: string;
          firstName: string;
          lastName: string;
          platformAdmin: boolean;
          temporaryPassword?: string;
        }
      | undefined;
    const sendPasswordReset = vi.fn(async () => undefined);
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
      identityUserAdministrator({
        async createUser(input) {
          provisionInput = input;
          return {
            subject: "better-auth-temporary-password-user",
            email: input.email,
            displayName: `${input.firstName} ${input.lastName}`,
          };
        },
        sendPasswordReset,
      }),
    );

    const response = await app.request("/v1/identity/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "agency.admin@acme.test",
        firstName: "Agency",
        lastName: "Admin",
        platformAdmin: false,
        temporaryPassword: "Temporary-password-123",
        membership: { agencyId: 101, role: "agency_admin" },
      }),
    });

    expect(response.status).toBe(201);
    expect(provisionInput).toMatchObject({
      email: "agency.admin@acme.test",
      temporaryPassword: "Temporary-password-123",
    });
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });

  it("lists Better Auth accounts without retired identity providers", async () => {
    const current = await upsertPrincipal(env.DB, {
      issuer: "savia:better-auth",
      subject: "better-auth-current-user",
      email: "current.user@savia.test",
      displayName: "Current User",
    });
    await upsertPrincipal(env.DB, {
      issuer: "retired:identity-provider",
      subject: "retired-user",
      email: "retired.user@savia.test",
      displayName: "Retired User",
    });
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
      identityUserAdministrator({
        async listUsers() {
          return [
            {
              subject: "better-auth-current-user",
              email: "current.user@savia.test",
              displayName: "Current User",
              role: "admin",
              isBanned: false,
              twoFactorEnabled: true,
            },
          ];
        },
      }),
    );

    const response = await app.request("/v1/identity/users");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        expect.objectContaining({
          id: current.id,
          attributes: expect.objectContaining({
            email: "current.user@savia.test",
            account: {
              role: "admin",
              isBanned: false,
              twoFactorEnabled: true,
            },
          }),
        }),
      ],
    });
  });

  it("updates access, account state, sessions, and recovery delivery for a managed user", async () => {
    await seedAgency();
    const administrator = identityUserAdministrator();
    const updateUser = vi.spyOn(administrator, "updateUser");
    const setAccountActive = vi.spyOn(administrator, "setAccountActive");
    const revokeSessions = vi.spyOn(administrator, "revokeSessions");
    const sendPasswordReset = vi.spyOn(administrator, "sendPasswordReset");
    const app = createApp(
      env.DB,
      env.DOCUMENTS,
      undefined,
      platformAdministratorAuthenticator(),
      administrator,
    );

    const created = await app.request("/v1/identity/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "new.user@acme.test",
        firstName: "New",
        lastName: "User",
        membership: { agencyId: 101, role: "viewer" },
      }),
    });
    const { data } = await created.json<{ data: { id: string } }>();

    const updated = await app.request(`/v1/identity/users/${data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Updated", lastName: "User" }),
    });
    expect(updated.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(
      "better-auth-new-user",
      { displayName: "Updated User", platformAdmin: undefined },
      expect.any(Request),
    );

    const suspended = await app.request(
      `/v1/identity/users/${data.id}/suspension`,
      { method: "POST" },
    );
    expect(suspended.status).toBe(409);
    expect(await suspended.json()).toMatchObject({
      error: { code: "LAST_ACTIVE_MEMBER" },
    });
    expect(setAccountActive).not.toHaveBeenCalledWith(
      "better-auth-new-user",
      false,
      expect.any(Request),
    );

    expect(
      (
        await app.request(`/v1/identity/users/${data.id}/sessions/revoke`, {
          method: "POST",
        })
      ).status,
    ).toBe(204);
    expect(revokeSessions).toHaveBeenCalledWith(
      "better-auth-new-user",
      expect.any(Request),
    );

    expect(
      (
        await app.request(`/v1/identity/users/${data.id}/password-reset`, {
          method: "POST",
        })
      ).status,
    ).toBe(204);
    expect(sendPasswordReset).toHaveBeenCalledTimes(2);

    expect(
      (
        await app.request(`/v1/identity/users/${data.id}/memberships/101`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(409);
  });

  it("keeps one principal when the same Better Auth session arrives concurrently", async () => {
    const identity = {
      issuer: "savia:better-auth",
      subject: "same-better-auth-subject",
      email: "same@savia.test",
      displayName: "Same Login",
    };

    const [first, second] = await Promise.all([
      upsertPrincipal(env.DB, identity),
      upsertPrincipal(env.DB, identity),
    ]);

    expect(second.id).toBe(first.id);
    const users = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM identity_principal WHERE issuer = ? AND subject = ?",
    )
      .bind(identity.issuer, identity.subject)
      .first<{ total: number }>();
    expect(users?.total).toBe(1);
  });

  it("finds an existing principal by subject", async () => {
    const identity = {
      issuer: "savia:better-auth",
      subject: "find-subject-test",
      email: "find@savia.test",
      displayName: "Find Me",
    };
    const created = await upsertPrincipal(env.DB, identity);
    const found = await findPrincipalBySubject(
      env.DB,
      identity.issuer,
      identity.subject,
    );
    expect(found?.id).toBe(created.id);
    expect(found?.email).toBe(identity.email);

    const notFound = await findPrincipalBySubject(
      env.DB,
      identity.issuer,
      "non-existent",
    );
    expect(notFound).toBeUndefined();
  });
});
