import { env } from "cloudflare:workers";
import { solveChallenge } from "altcha-lib";
import { deriveKey } from "altcha-lib/algorithms/pbkdf2";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it, vi } from "vitest";
import { registerPublicTenantRegistrationRoutes } from "../src/tenant-registration/public-routes";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, source]) => source);

beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((entry) =>
        entry
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});

let nextTenantId = 991000;
async function createTenant(options: { active?: boolean } = {}) {
  const id = ++nextTenantId;
  const slug = `registration-${id}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,kind,is_active,created_at,updated_at) VALUES(?,?,?,'commercial',?,?,?)",
  )
    .bind(
      id,
      slug,
      "Registration tenant",
      options.active === false ? 0 : 1,
      now,
      now,
    )
    .run();
  return { id, slug, host: `${slug}.api.savia.test` };
}

const baseSettings = {
  allowEmailRegistration: true,
  passwordAllowed: true,
  captchaMode: "inherit",
  siteKey: "",
  secretKey: "",
  secretConfigured: false,
  emailReady: true,
  revision: "registration-revision",
};
const captchaOptions = {
  captchaProvider: "altcha" as const,
  altchaSecret: "registration-altcha-secret-at-least-32-chars",
  publicOrigin: "https://api.savia.test",
  rateLimiter: { limit: async () => ({ success: true }) },
};

function createApp(
  authFetch: (request: Request) => Promise<Response>,
  settings: Record<string, unknown> = baseSettings,
  options:
    | typeof captchaOptions
    | {
        captchaProvider: "altcha";
        altchaSecret: string;
        publicOrigin: string;
      } = captchaOptions,
) {
  const app = new OpenAPIHono();
  const auth = { fetch: vi.fn(authFetch) };
  registerPublicTenantRegistrationRoutes(
    app,
    env.DB,
    auth,
    "test-bridge-key",
    options,
  );
  return { app, auth };
}

function settingsAndStartBridge(
  settings: Record<string, unknown>,
  start: (request: Request) => Promise<Response> = async () =>
    Response.json({ accepted: true }),
) {
  return async (request: Request) => {
    if (new URL(request.url).pathname.endsWith("/start")) return start(request);
    return Response.json(settings);
  };
}

async function solvedToken(app: OpenAPIHono, tenantId: number, host: string) {
  const challengeResponse = await app.request(
    `https://${host}/v1/public/registration/challenge`,
  );
  expect(challengeResponse.status).toBe(200);
  const challenge = await challengeResponse.json<any>();
  const solution = await solveChallenge({ challenge, deriveKey });
  if (!solution) throw new Error("ALTCHA challenge did not solve");
  return btoa(JSON.stringify({ challenge, solution }));
}

const signupBody = (captchaToken: string, requestId = crypto.randomUUID()) => ({
  name: "New Account",
  email: "new@example.test",
  password: "correct horse battery staple",
  passwordConfirmation: "correct horse battery staple",
  captchaToken,
  requestId,
});

async function submit(
  app: OpenAPIHono,
  host: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const origin = `https://${host}`;
  return app.request(`${origin}/v1/public/registration`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

it("resolves public registration only from the actual active tenant hostname", async () => {
  const tenant = await createTenant();
  const other = await createTenant();
  const { app } = createApp(settingsAndStartBridge(baseSettings));
  const response = await app.request(
    `https://${tenant.host}/v1/public/registration`,
    {
      headers: { "x-savia-tenant-slug": other.slug },
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    tenantId: tenant.id,
    tenantName: "Registration tenant",
    loginUrl: "/api/auth/login",
    captchaProvider: "altcha",
  });
  expect(
    (
      await app.request("https://api.savia.test/v1/public/registration", {
        headers: { "x-savia-tenant-slug": tenant.slug },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await app.request(`https://${tenant.host}/v1/public/registration`, {
        headers: { "x-savia-tenant-slug": other.slug },
      })
    ).status,
  ).toBe(200);
});

it("fails closed for disabled, SSO-only, inactive, and unready tenants", async () => {
  const tenant = await createTenant();
  const inactive = await createTenant({ active: false });
  const disabledApp = createApp(
    settingsAndStartBridge({ ...baseSettings, allowEmailRegistration: false }),
  ).app;
  const ssoApp = createApp(
    settingsAndStartBridge({ ...baseSettings, passwordAllowed: false }),
  ).app;
  const unreadyApp = createApp(
    settingsAndStartBridge({ ...baseSettings, emailReady: false }),
  ).app;
  const inactiveApp = createApp(settingsAndStartBridge(baseSettings)).app;
  const missingLimiterApp = createApp(
    settingsAndStartBridge(baseSettings),
    baseSettings,
    {
      captchaProvider: "altcha",
      altchaSecret: captchaOptions.altchaSecret,
      publicOrigin: captchaOptions.publicOrigin,
    },
  ).app;
  const missingProviderApp = createApp(
    settingsAndStartBridge(baseSettings),
    baseSettings,
    { ...captchaOptions, captchaProvider: "altcha", altchaSecret: "short" },
  ).app;
  for (const app of [disabledApp, ssoApp, unreadyApp])
    expect(
      (await app.request(`https://${tenant.host}/v1/public/registration`))
        .status,
    ).toBe(404);
  expect(
    (
      await inactiveApp.request(
        `https://${inactive.host}/v1/public/registration`,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await missingLimiterApp.request(
        `https://${tenant.host}/v1/public/registration`,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await missingProviderApp.request(
        `https://${tenant.host}/v1/public/registration`,
      )
    ).status,
  ).toBe(404);
});

it("accepts a verified signup generically and replays an accepted request idempotently", async () => {
  const tenant = await createTenant();
  const start = vi.fn(async (_request: Request) =>
    Response.json({ accepted: true }),
  );
  const { app, auth } = createApp(settingsAndStartBridge(baseSettings, start));
  const token = await solvedToken(app, tenant.id, tenant.host);
  const body = signupBody(token);
  const first = await submit(app, tenant.host, body);
  const replay = await submit(app, tenant.host, body);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ accepted: true });
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual({ accepted: true });
  expect(start).toHaveBeenCalledTimes(1);
  const startRequest = start.mock.calls[0]?.[0];
  expect(startRequest?.headers.get("x-savia-bridge-key")).toBe(
    "test-bridge-key",
  );
  const startBody = await startRequest?.clone().json();
  expect(startBody).toMatchObject({
    attemptId: body.requestId,
    tenantId: tenant.id,
    name: body.name,
    email: body.email,
    revision: baseSettings.revision,
    origin: `https://${tenant.host}`,
  });
  expect(startBody.password).toBe(body.password);
  const proofRow = await env.DB.prepare(
    "SELECT fingerprint FROM registration_captcha_consumption WHERE request_id=?",
  )
    .bind(body.requestId)
    .first<{ fingerprint: string }>();
  expect(proofRow?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(proofRow?.fingerprint).not.toContain(body.password);
});

it("keeps a verified proof retryable after the auth bridge fails", async () => {
  const tenant = await createTenant();
  let attempt = 0;
  const start = vi.fn(async () =>
    ++attempt === 1
      ? new Response("unavailable", { status: 503 })
      : Response.json({ accepted: true }),
  );
  const { app } = createApp(settingsAndStartBridge(baseSettings, start));
  const token = await solvedToken(app, tenant.id, tenant.host);
  const body = signupBody(token);
  expect((await submit(app, tenant.host, body)).status).toBe(503);
  const retry = await submit(app, tenant.host, body);
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ accepted: true });
  expect(start).toHaveBeenCalledTimes(2);
});

it("rejects origin mismatch, replay under another request id, and mismatched retry payload", async () => {
  const tenant = await createTenant();
  const start = vi.fn(async () => Response.json({ accepted: true }));
  const { app } = createApp(settingsAndStartBridge(baseSettings, start));
  const token = await solvedToken(app, tenant.id, tenant.host);
  const body = signupBody(token);
  expect(
    (
      await submit(app, tenant.host, body, {
        origin: "https://other.api.savia.test",
      })
    ).status,
  ).toBe(403);
  expect((await submit(app, tenant.host, body)).status).toBe(200);
  expect((await submit(app, tenant.host, signupBody(token))).status).toBe(403);
  expect(
    (await submit(app, tenant.host, { ...body, email: "changed@example.test" }))
      .status,
  ).toBe(403);
  expect(start).toHaveBeenCalledTimes(1);
});

it("requires a configured abuse limiter before exposing registration or issuing a challenge", async () => {
  const tenant = await createTenant();
  const { app } = createApp(
    settingsAndStartBridge(baseSettings),
    baseSettings,
    {
      captchaProvider: "altcha",
      altchaSecret: captchaOptions.altchaSecret,
      publicOrigin: captchaOptions.publicOrigin,
    },
  );
  const response = await app.request(
    `https://${tenant.host}/v1/public/registration/challenge`,
  );
  expect(response.status).toBe(404);
});

it("bounds expired proof cleanup to 100 rows per public request", async () => {
  const tenant = await createTenant();
  const { app } = createApp(settingsAndStartBridge(baseSettings));
  const expiredAt = Date.now() - 1;
  const rows = Array.from({ length: 101 }, (_, index) =>
    env.DB.prepare(
      "INSERT INTO registration_captcha_consumption(proof_hash,request_id,tenant_id,fingerprint,status,expires_at) VALUES(?,?,?,?,?,?)",
    ).bind(
      `expired-proof-${tenant.id}-${index}`,
      crypto.randomUUID(),
      tenant.id,
      "f".repeat(64),
      "failed",
      expiredAt,
    ),
  );
  await env.DB.batch(rows);
  const response = await app.request(
    `https://${tenant.host}/v1/public/registration/challenge`,
  );
  expect(response.status).toBe(200);
  const remaining = await env.DB.prepare(
    "SELECT count(*) AS count FROM registration_captcha_consumption WHERE tenant_id=? AND expires_at<=?",
  )
    .bind(tenant.id, Date.now())
    .first<{ count: number }>();
  expect(remaining?.count).toBe(1);
});
