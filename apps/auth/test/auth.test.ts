import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import authWorker, { createBetterAuth } from "../src/index";
import { oauthProviderOptions, oauthRuntime } from "../src/oauth";

const origin = "http://127.0.0.1:8787";

async function authRequest(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${origin}${path}`;
  return authWorker.fetch(new Request(url, init), env);
}

async function internalAuthRequest(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return authWorker.fetch(
    new Request(`https://savia-auth.internal${path}`, init),
    env,
  );
}

function originalTotpSecret(totpURI: string): string {
  const encoded = new URL(totpURI).searchParams.get("secret");
  if (!encoded) throw new Error("TOTP URI does not contain a secret");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of encoded) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("TOTP URI contains an invalid secret");
    buffer = (buffer << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

async function submitOAuthLogin(script: string): Promise<{
  requests: string[];
  assignedUrl: string | undefined;
}> {
  const requests: string[] = [];
  let submit:
    ((event: { preventDefault(): void }) => Promise<void>) | undefined;
  let assignedUrl: string | undefined;
  const loginForm = {
    dataset: { oauthForm: "sign-in" },
    hidden: false,
    querySelector: () => ({ disabled: false }),
    addEventListener: (
      event: string,
      listener: (input: { preventDefault(): void }) => Promise<void>,
    ) => {
      if (event === "submit") submit = listener;
    },
  };
  const document = {
    querySelector: (selector: string) => {
      if (selector === "#oauth-status") return { textContent: "" };
      if (selector === '[data-oauth-form="sign-in"]') return loginForm;
      return null;
    },
    querySelectorAll: () => [loginForm],
  };
  class TestFormData {
    constructor(_: unknown) {}
    get(name: string) {
      return name === "email" ? "user@example.test" : "password";
    }
  }
  const execute = new Function(
    "window",
    "document",
    "fetch",
    "FormData",
    script,
  );
  execute(
    {
      location: {
        search: "?sig=signed&ba_param=client_id&client_id=scalar",
        assign: (url: string) => {
          assignedUrl = url;
        },
      },
    },
    document,
    async (path: string) => {
      requests.push(path);
      return Response.json(
        path.endsWith("oauth2/continue")
          ? { url: "http://127.0.0.1:8787/docs?code=authorized" }
          : {},
      );
    },
    TestFormData,
  );
  await submit?.({ preventDefault() {} });
  return { requests, assignedUrl };
}

async function submitExpiredOAuthLogin(
  script: string,
  configuredRestartUrl: string,
): Promise<{
  restartUrl: string | undefined;
  status: string;
}> {
  let submit:
    ((event: { preventDefault(): void }) => Promise<void>) | undefined;
  let restartUrl: string | undefined;
  const status = { textContent: "" };
  const loginForm = {
    dataset: { oauthForm: "sign-in" },
    hidden: false,
    querySelector: () => ({ disabled: false }),
    addEventListener: (
      event: string,
      listener: (input: { preventDefault(): void }) => Promise<void>,
    ) => {
      if (event === "submit") submit = listener;
    },
  };
  const document = {
    body: { dataset: { oauthRestartUrl: configuredRestartUrl } },
    querySelector: (selector: string) => {
      if (selector === "#oauth-status") return status;
      if (selector === '[data-oauth-form="sign-in"]') return loginForm;
      return null;
    },
    querySelectorAll: () => [loginForm],
  };
  class TestFormData {
    constructor(_: unknown) {}
    get(name: string) {
      return name === "email" ? "user@example.test" : "password";
    }
  }
  const execute = new Function(
    "window",
    "document",
    "fetch",
    "FormData",
    script,
  );
  execute(
    {
      location: {
        search: "?sig=expired&ba_param=client_id&client_id=admin",
        assign: () => undefined,
        replace: (url: string) => {
          restartUrl = url;
        },
      },
    },
    document,
    async () => Response.json({ error: "invalid_signature" }, { status: 400 }),
    TestFormData,
  );
  await submit?.({ preventDefault() {} });
  return { restartUrl, status: status.textContent };
}

function passwordVisibilityControl(script: string): {
  click(): void;
  password: { type: string };
  attributes: Map<string, string>;
} {
  let click: (() => void) | undefined;
  const password = { type: "password" };
  const attributes = new Map<string, string>();
  const control = {
    addEventListener: (event: string, listener: () => void) => {
      if (event === "click") click = listener;
    },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  };
  const document = {
    querySelector: (selector: string) => {
      if (selector === "#oauth-status") return { textContent: "" };
      if (selector === "#password") return password;
      if (selector === "[data-oauth-password-toggle]") return control;
      return null;
    },
    querySelectorAll: () => [],
  };
  const execute = new Function(
    "window",
    "document",
    "fetch",
    "FormData",
    script,
  );
  execute(
    { location: { search: "" } },
    document,
    async () => Response.json({}),
    class TestFormData {},
  );

  if (!click) {
    throw new Error(
      "The password visibility control did not bind a click event.",
    );
  }

  return { click, password, attributes };
}

describe("Savia Better Auth worker", () => {
  it("publishes OAuth discovery, JWKS, and fixed public clients for Scalar and the admin", async () => {
    const [oidc, authorizationServer, jwks, scalar, admin] = await Promise.all([
      authRequest("/api/auth/.well-known/openid-configuration"),
      authRequest("/.well-known/oauth-authorization-server/api/auth"),
      authRequest("/api/auth/jwks"),
      authRequest("/_internal/oauth/scalar-client"),
      internalAuthRequest("/_internal/oauth/admin-client"),
    ]);

    expect(oidc.status).toBe(200);
    expect(authorizationServer.status).toBe(200);
    expect(jwks.status).toBe(200);
    expect(await jwks.json()).toEqual({ keys: expect.any(Array) });
    const scalarClient = (await scalar.json()) as { clientId: string };
    const adminClient = (await admin.json()) as { clientId: string };

    expect(scalarClient).toEqual({
      clientId: expect.any(String),
      redirectUri: "http://127.0.0.1:8787/docs",
      resource: "http://127.0.0.1:8787",
      scopes: expect.arrayContaining(["openid", "savia.api.read"]),
    });
    expect(adminClient).toEqual({
      clientId: expect.any(String),
      redirectUri: "http://127.0.0.1:5173/auth/callback",
      resource: "http://127.0.0.1:8787",
      scopes: expect.arrayContaining([
        "openid",
        "savia.api.read",
        "savia.api.write",
        "offline_access",
      ]),
    });
    const clientResourceLinks = await env.AUTH_DB.prepare(
      'SELECT "clientId" AS client_id FROM "oauthClientResource" WHERE "resourceId" = ?',
    )
      .bind("http://127.0.0.1:8787")
      .all<{ client_id: string }>();
    expect(clientResourceLinks.results.map((link) => link.client_id)).toEqual(
      expect.arrayContaining([scalarClient.clientId, adminClient.clientId]),
    );
    const apiResource = await env.AUTH_DB.prepare(
      'SELECT "allowedScopes" AS allowed_scopes FROM "oauthResource" WHERE identifier = ?',
    )
      .bind("http://127.0.0.1:8787")
      .first<{ allowed_scopes: string }>();
    expect(JSON.parse(apiResource?.allowed_scopes ?? "[]")).toContain(
      "offline_access",
    );
  });

  it("upgrades the existing admin client with the refresh-token scope", async () => {
    const current = (await (
      await internalAuthRequest("/_internal/oauth/admin-client")
    ).json()) as { clientId: string };
    await env.AUTH_DB.prepare(
      'UPDATE "oauthClient" SET scopes = ? WHERE "clientId" = ?',
    )
      .bind(
        JSON.stringify([
          "openid",
          "profile",
          "email",
          "savia.api.read",
          "savia.api.write",
        ]),
        current.clientId,
      )
      .run();

    await internalAuthRequest("/_internal/oauth/admin-client");

    const upgraded = await env.AUTH_DB.prepare(
      'SELECT scopes FROM "oauthClient" WHERE "clientId" = ?',
    )
      .bind(current.clientId)
      .first<{ scopes: string }>();
    expect(JSON.parse(upgraded?.scopes ?? "[]")).toContain("offline_access");
  });

  it("enables the refresh-token grant for Savia OAuth sessions", () => {
    expect(oauthProviderOptions(env).grantTypes).toEqual(
      expect.arrayContaining(["authorization_code", "refresh_token"]),
    );
  });

  it("derives fixed OAuth client redirects from the public Savia origin", () => {
    const runtime = oauthRuntime({
      ...env,
      BETTER_AUTH_URL: "https://savia.example.workers.dev",
      SAVIA_API_RESOURCE: "https://savia.example.workers.dev",
      SAVIA_ADMIN_REDIRECT_URI:
        "https://savia.example.workers.dev/auth/callback",
      SAVIA_SCALAR_REDIRECT_URI: "https://savia.example.workers.dev/docs",
    } as Parameters<typeof oauthRuntime>[0]);

    expect(runtime).toMatchObject({
      adminRedirectUri: "https://savia.example.workers.dev/auth/callback",
      apiResource: "https://savia.example.workers.dev",
      scalarRedirectUri: "https://savia.example.workers.dev/docs",
    });
  });

  it("rejects a Scalar callback outside the public Savia origin", () => {
    expect(() =>
      createBetterAuth({
        ...env,
        SAVIA_SCALAR_REDIRECT_URI: "https://evil.example/callback",
      } as Parameters<typeof createBetterAuth>[0]),
    ).toThrow("SAVIA_SCALAR_REDIRECT_URI");
  });

  it("serves same-origin OAuth login and consent screens without credentials in HTML", async () => {
    const [login, consent] = await Promise.all([
      authRequest("/api/auth/login?client_id=scalar&sig=signed"),
      authRequest("/api/auth/consent?client_id=scalar&scope=openid"),
    ]);

    expect(login.headers.get("content-type")).toContain("text/html");
    expect(login.headers.get("cache-control")).toBe("no-store");
    expect(login.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(login.headers.get("content-security-policy")).toContain(
      "img-src 'self' data:",
    );
    const loginHtml = await login.text();
    expect(loginHtml).toContain('action="sign-in"');
    expect(loginHtml).not.toContain(env.BETTER_AUTH_BOOTSTRAP_PASSWORD);
    expect(consent.headers.get("content-type")).toContain("text/html");
    expect(await consent.text()).toContain("Autorizar acceso");
  });

  it("serves the Shadcn login surface with a same-origin stylesheet", async () => {
    const [login, styles] = await Promise.all([
      authRequest("/api/auth/login?client_id=scalar&sig=signed"),
      authRequest("/api/auth/oauth-ui.css"),
    ]);

    expect(login.headers.get("content-type")).toContain("text/html");
    expect(await login.text()).toContain(
      'rel="stylesheet" href="/api/auth/oauth-ui.css"',
    );
    expect(styles.headers.get("content-type")).toContain("text/css");
    const stylesheet = await styles.text();
    expect(stylesheet).toContain("--background:");
    expect(stylesheet).toMatch(
      /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/,
    );
  });

  it("serves tenant-branded login surface when accessed via tenant subdomain", async () => {
    const login = await authRequest(
      "https://merkaseguros.savia.app.hefesoft.com/api/auth/login?client_id=scalar&sig=signed",
    );
    expect(login.headers.get("content-type")).toContain("text/html");
    const html = await login.text();
    expect(html).toContain("Espacio de trabajo · merkaseguros");
    expect(html).toContain("Iniciar sesión en merkaseguros | Savia");
  });

  it("exposes an accessible control to reveal the login password", async () => {
    const login = await authRequest(
      "/api/auth/login?client_id=scalar&sig=signed",
    );
    const loginHtml = await login.text();

    expect(loginHtml).toContain("data-oauth-password-toggle");
    expect(loginHtml).toContain('aria-controls="password"');
    expect(loginHtml).toContain('aria-label="Mostrar contraseña"');
  });

  it("keeps a high-contrast focus outline on the password visibility control", async () => {
    const styles = await (await authRequest("/api/auth/oauth-ui.css")).text();

    expect(styles).toMatch(
      /\.oauth-password-toggle:focus-visible\s*\{\s*outline: 2px solid var\(--primary\);\s*outline-offset: 2px;\s*\}/,
    );
  });

  it("toggles the login password visibility and accessible state", async () => {
    const script = await (await authRequest("/api/auth/oauth-ui.js")).text();
    const control = passwordVisibilityControl(script);

    control.click();
    expect(control.password.type).toBe("text");
    expect(control.attributes).toEqual(
      new Map([
        ["aria-label", "Ocultar contraseña"],
        ["aria-pressed", "true"],
      ]),
    );

    control.click();
    expect(control.password.type).toBe("password");
    expect(control.attributes).toEqual(
      new Map([
        ["aria-label", "Mostrar contraseña"],
        ["aria-pressed", "false"],
      ]),
    );
  });

  it("continues OAuth after a password sign-in that returns only a session", async () => {
    const script = await (await authRequest("/api/auth/oauth-ui.js")).text();

    await expect(submitOAuthLogin(script)).resolves.toEqual({
      requests: ["/api/auth/sign-in/email", "/api/auth/oauth2/continue"],
      assignedUrl: "http://127.0.0.1:8787/docs?code=authorized",
    });
  });

  it("restarts configured admin access after a signed authorization expires", async () => {
    const [login, scriptResponse] = await Promise.all([
      authRequest("/api/auth/login?client_id=admin&sig=expired"),
      authRequest("/api/auth/oauth-ui.js"),
    ]);
    const loginHtml = await login.text();
    const configuredRestartUrl = loginHtml.match(
      /data-oauth-restart-url="([^"]+)"/,
    )?.[1];

    expect(configuredRestartUrl).toBe("http://127.0.0.1:5173/#/login");

    await expect(
      submitExpiredOAuthLogin(
        await scriptResponse.text(),
        configuredRestartUrl ?? "",
      ),
    ).resolves.toEqual({
      restartUrl: "http://127.0.0.1:5173/#/login",
      status: "",
    });
  });

  it("requires unenrolled administrators to enroll TOTP before OAuth continues", async () => {
    const postLogin = oauthProviderOptions(env).postLogin as {
      shouldRedirect: (input: { user: Record<string, unknown> }) => boolean;
    };

    expect(
      postLogin.shouldRedirect({
        user: { role: "admin", twoFactorEnabled: false },
      }),
    ).toBe(true);
    expect(
      postLogin.shouldRedirect({
        user: { role: "user", twoFactorEnabled: false },
      }),
    ).toBe(false);
  });

  it("keeps OAuth client management private and rejects unsafe or fixed clients", async () => {
    const signIn = await authRequest("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "savia.admin@example.test",
        password: env.BETTER_AUTH_BOOTSTRAP_PASSWORD,
      }),
    });
    const cookie = signIn.headers.get("set-cookie") ?? "";
    const privateHeaders = {
      "content-type": "application/json",
      cookie,
    };
    const [publicRequest, unsafeClient, clients] = await Promise.all([
      authRequest("/_internal/oauth/clients", { headers: privateHeaders }),
      internalAuthRequest("/_internal/oauth/clients", {
        method: "POST",
        headers: privateHeaders,
        body: JSON.stringify({
          clientAuthentication: "none",
          clientName: "Unsafe client",
          redirectUris: ["http://evil.example/callback"],
          scopes: ["openid", "savia.api.read"],
          trusted: false,
        }),
      }),
      internalAuthRequest("/_internal/oauth/clients", {
        headers: privateHeaders,
      }),
    ]);

    expect(publicRequest.status).toBe(404);
    expect(unsafeClient.status).toBe(400);
    const listed = (await clients.json()) as {
      data: Array<{ clientId: string; clientName: string }>;
    };
    const scalar = listed.data.find(
      (client) => client.clientName === "Savia Scalar",
    );
    expect(scalar).toBeDefined();
    const removeScalar = await internalAuthRequest(
      `/_internal/oauth/clients/${encodeURIComponent(scalar?.clientId ?? "")}`,
      { method: "DELETE", headers: privateHeaders },
    );
    expect(removeScalar.status).toBe(400);
  });

  it("creates the bootstrap administrator and resolves cookie and bearer sessions", async () => {
    const signIn = await authRequest("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "savia.admin@example.test",
        password: env.BETTER_AUTH_BOOTSTRAP_PASSWORD,
      }),
    });

    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie");
    const bearerToken = signIn.headers.get("set-auth-token");
    expect(cookie).toContain("savia.session_token=");
    expect(bearerToken).toBeTruthy();

    const [cookieSession, bearerSession] = await Promise.all([
      authRequest("/_internal/session", { headers: { cookie: cookie ?? "" } }),
      authRequest("/_internal/session", {
        headers: { authorization: `Bearer ${bearerToken}` },
      }),
    ]);

    expect(await cookieSession.json()).toMatchObject({
      user: {
        email: "savia.admin@example.test",
        role: "admin",
      },
    });
    expect(await bearerSession.json()).toMatchObject({
      user: {
        email: "savia.admin@example.test",
        role: "admin",
      },
    });
  });

  it("terminates a Better Auth session on sign-out with trusted origin", async () => {
    const signIn = await authRequest("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "savia.admin@example.test",
        password: env.BETTER_AUTH_BOOTSTRAP_PASSWORD,
      }),
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie")!;
    expect(cookie).toContain("savia.session_token=");

    const activeSession = await authRequest("/_internal/session", {
      headers: { cookie },
    });
    expect(await activeSession.json()).toMatchObject({
      user: { email: "savia.admin@example.test" },
    });

    const signOut = await internalAuthRequest("/api/auth/sign-out", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: "http://127.0.0.1:5173",
        cookie,
      },
      body: "{}",
    });
    expect(signOut.status).toBe(200);
    expect(await signOut.json()).toEqual({ success: true });

    const sessionAfterSignOut = await authRequest("/_internal/session", {
      headers: { cookie },
    });
    expect(await sessionAfterSignOut.json()).toEqual({ user: null });
  });

  it("seeds the three local accounts with the bootstrap password", async () => {
    await authRequest("/_internal/session");
    const accounts = [
      {
        email: "savia.admin@example.test",
        role: "admin",
      },
      {
        email: "agency-admin-flow-20260902@savia.test",
        role: "user",
      },
      {
        email: "agency-viewer-flow-20260902@savia.test",
        role: "user",
      },
    ] as const;

    for (const account of accounts) {
      const signIn = await authRequest("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: account.email,
          password: env.BETTER_AUTH_BOOTSTRAP_PASSWORD,
        }),
      });
      expect(signIn.status, account.email).toBe(200);
      const session = await authRequest("/_internal/session", {
        headers: { cookie: signIn.headers.get("set-cookie") ?? "" },
      });
      expect(await session.json()).toMatchObject({
        user: { email: account.email, role: account.role },
      });
    }
  });

  it("includes the Better Auth image in the internal session", async () => {
    const image =
      "https://api.savia.test/v1/account/avatar?v=avatar-version";
    await env.AUTH_DB.prepare('UPDATE "user" SET image = ? WHERE email = ?')
      .bind(image, "savia.admin@example.test")
      .run();
    const signIn = await authRequest("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "savia.admin@example.test",
        password: env.BETTER_AUTH_BOOTSTRAP_PASSWORD,
      }),
    });

    const session = await authRequest("/_internal/session", {
      headers: { cookie: signIn.headers.get("set-cookie") ?? "" },
    });

    expect(await session.json()).toEqual({
      user: expect.objectContaining({ image }),
    });
  });

  it("creates a password-reset email through the configured transactional sender", async () => {
    await authRequest("/_internal/session");
    const delivered: Array<{
      to: string;
      subject: string;
      text: string;
    }> = [];
    const auth = createBetterAuth(env, {
      sendTransactionalEmail: async (email) => {
        delivered.push(email);
      },
    });

    const response = await auth.handler(
      new Request(`${origin}/api/auth/request-password-reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "savia.admin@example.test" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: true,
      message:
        "If this email exists in our system, check your email for the reset link",
    });
    expect(delivered).toEqual([
      {
        to: "savia.admin@example.test",
        subject: "Restablece tu contraseña de Savia",
        text: expect.stringContaining("/reset-password/"),
      },
    ]);
  });

  it("starts TOTP enrollment only from an authenticated Savia session", async () => {
    const signIn = await authRequest("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "savia.admin@example.test",
        password: env.BETTER_AUTH_BOOTSTRAP_PASSWORD,
      }),
    });
    const cookie = signIn.headers.get("set-cookie");

    const enrollment = await authRequest("/api/auth/two-factor/enable", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookie ?? "",
        origin,
      },
      body: JSON.stringify({ password: env.BETTER_AUTH_BOOTSTRAP_PASSWORD, method: "totp" }),
    });

    expect(enrollment.status).toBe(200);
    expect(await enrollment.json()).toEqual({
      method: "totp",
      totpURI: expect.stringMatching(/^otpauth:\/\/totp\/Savia:/),
      totpQrDataUrl: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
      backupCodes: expect.arrayContaining([expect.any(String)]),
    });
  });

  it("withholds a session token until an enrolled administrator completes TOTP", async () => {
    const initialSignIn = await authRequest("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "savia.admin@example.test",
        password: env.BETTER_AUTH_BOOTSTRAP_PASSWORD,
      }),
    });
    const enrollment = await authRequest("/api/auth/two-factor/enable", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: initialSignIn.headers.get("set-cookie") ?? "",
        origin,
      },
      body: JSON.stringify({
        password: env.BETTER_AUTH_BOOTSTRAP_PASSWORD,
        method: "totp",
      }),
    });
    expect(enrollment.status).toBe(200);
    const enrollmentData = (await enrollment.json()) as { totpURI: string };
    const generated = await createBetterAuth(env).api.generateTOTP({
      body: { secret: originalTotpSecret(enrollmentData.totpURI) },
    });

    const completion = await authRequest("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: initialSignIn.headers.get("set-cookie") ?? "",
        origin,
      },
      body: JSON.stringify({ code: generated.code }),
    });
    const bearerToken = completion.headers.get("set-auth-token");
    expect(completion.status).toBe(200);
    expect(bearerToken).toBeTruthy();

    const confirmedSession = await authRequest("/_internal/session", {
      headers: { authorization: `Bearer ${bearerToken}` },
    });
    expect(await confirmedSession.json()).toMatchObject({
      user: { twoFactorEnabled: true },
    });

    const challengedSignIn = await authRequest("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "savia.admin@example.test",
        password: env.BETTER_AUTH_BOOTSTRAP_PASSWORD,
      }),
    });
    expect(challengedSignIn.status).toBe(200);
    expect(challengedSignIn.headers.get("set-auth-token")).toBeNull();
    expect(await challengedSignIn.json()).toEqual({
      twoFactorRedirect: true,
      twoFactorMethods: ["totp"],
    });
  });

  it("links fixed OAuth clients without requiring an interactive MFA session", async () => {
    const scalar = await env.AUTH_DB.prepare(
      'SELECT "clientId" AS client_id FROM "oauthClient" WHERE name = ?',
    )
      .bind("Savia Scalar")
      .first<{ client_id: string }>();
    expect(scalar?.client_id).toEqual(expect.any(String));

    await env.AUTH_DB.prepare(
      'DELETE FROM "oauthClientResource" WHERE "clientId" = ? AND "resourceId" = ?',
    )
      .bind(scalar?.client_id, origin)
      .run();

    const discovery = await authRequest(
      "/api/auth/.well-known/openid-configuration",
    );

    expect(discovery.status).toBe(200);
    const linked = await env.AUTH_DB.prepare(
      'SELECT 1 AS linked FROM "oauthClientResource" WHERE "clientId" = ? AND "resourceId" = ?',
    )
      .bind(scalar?.client_id, origin)
      .first<{ linked: number }>();
    expect(linked).toEqual({ linked: 1 });
  });

  it("updates imported fixed OAuth client redirects to the public origin", async () => {
    const [admin, scalar] = await Promise.all([
      env.AUTH_DB.prepare(
        'SELECT "clientId" AS client_id FROM "oauthClient" WHERE name = ? LIMIT 1',
      )
        .bind("Savia Admin")
        .first<{ client_id: string }>(),
      env.AUTH_DB.prepare(
        'SELECT "clientId" AS client_id FROM "oauthClient" WHERE name = ? LIMIT 1',
      )
        .bind("Savia Scalar")
        .first<{ client_id: string }>(),
    ]);
    expect(admin?.client_id).toEqual(expect.any(String));
    expect(scalar?.client_id).toEqual(expect.any(String));

    await env.AUTH_DB.prepare(
      'UPDATE "oauthClient" SET "redirectUris" = ? WHERE "clientId" IN (?, ?)',
    )
      .bind(
        JSON.stringify(["https://stale.example.test/callback"]),
        admin?.client_id,
        scalar?.client_id,
      )
      .run();

    const discovery = await authRequest(
      "/api/auth/.well-known/openid-configuration",
    );
    expect(discovery.status).toBe(200);

    const clients = await env.AUTH_DB.prepare(
      'SELECT name, "redirectUris" AS redirect_uris FROM "oauthClient" WHERE "clientId" IN (?, ?) ORDER BY name',
    )
      .bind(admin?.client_id, scalar?.client_id)
      .all<{ name: string; redirect_uris: string }>();
    expect(clients.results).toEqual([
      {
        name: "Savia Admin",
        redirect_uris: JSON.stringify(["http://127.0.0.1:5173/auth/callback"]),
      },
      {
        name: "Savia Scalar",
        redirect_uris: JSON.stringify(["http://127.0.0.1:8787/docs"]),
      },
    ]);
  });

  it("allows trusted origins from tenant subdomains under the canonical host", async () => {
    const response = await authWorker.fetch(
      new Request("http://127.0.0.1:8787/api/auth/ok", {
        headers: {
          origin: "https://merkaseguros.savia.app.hefesoft.com",
        },
      }),
      env,
    );
    expect(response.status).toBe(200);
  });
});

