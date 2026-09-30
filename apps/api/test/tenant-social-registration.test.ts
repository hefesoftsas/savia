import { env } from "cloudflare:workers";
import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, expect, it, vi } from "vitest";
import {
  finalizeSocialRegistration,
  registerSocialRegistrationRoutes,
} from "../src/tenant-social/registration";

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

let nextTenantId = 994000;
async function createTenant(maxActiveUsers: number | null = null) {
  const id = ++nextTenantId;
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(id, `registration-${id}`, "Registration tenant", now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_user_limits(tenant_id,max_active_users) VALUES(?,?)",
  )
    .bind(id, maxActiveUsers)
    .run();
  return id;
}

const payload = (
  tenantId: number,
  overrides: Record<string, unknown> = {},
) => ({
  attemptId: `attempt-${tenantId}`,
  tenantId,
  subject: `auth-subject-${tenantId}`,
  email: `new-${tenantId}@example.test`,
  displayName: "New Social User",
  provider: "google",
  revision: "revision-1",
  ...overrides,
});

function createApp(
  policy?: Record<string, unknown>,
  bridgeKey: string | undefined = "test-bridge-key",
  db: D1Database = env.DB,
) {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const auth = {
    fetch: vi.fn(async (request: Request) => {
      requests.push({ url: request.url, headers: request.headers });
      return Response.json(
        policy ?? {
          configured: true,
          active: true,
          allowRegistration: true,
          googleEnabled: true,
          microsoftEnabled: false,
          revision: "revision-1",
        },
      );
    }),
  };
  const app = new OpenAPIHono();
  registerSocialRegistrationRoutes(app, db, auth, bridgeKey);
  return { app, auth, requests };
}

it("requires the configured bridge key before looking up registration policy", async () => {
  const tenantId = await createTenant();
  const { app, auth } = createApp(undefined, undefined);

  const response = await app.request("/_internal/social-registration", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload(tenantId)),
  });

  expect(response.status).toBe(401);
  expect(auth.fetch).not.toHaveBeenCalled();
});

it("finalizes a verified social identity once with viewer membership and replays idempotently", async () => {
  const tenantId = await createTenant();
  const { app, auth, requests } = createApp();
  const request = () =>
    app.request("/_internal/social-registration", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-savia-bridge-key": "test-bridge-key",
      },
      body: JSON.stringify(payload(tenantId)),
    });

  const first = await request();
  const firstResult = await first.json<any>();
  const replay = await request();
  const replayResult = await replay.json<any>();

  expect(first.status).toBe(200);
  expect(firstResult).toMatchObject({ created: true });
  expect(replay.status).toBe(200);
  expect(replayResult).toMatchObject({
    principalId: firstResult.principalId,
    membershipId: firstResult.membershipId,
    created: false,
  });
  expect(auth.fetch).toHaveBeenCalledTimes(2);
  expect(requests[0]?.url).toBe(
    `https://savia-auth.internal/_internal/tenant-social/${tenantId}`,
  );
  expect(requests[0]?.headers.get("x-savia-bridge-key")).toBe(
    "test-bridge-key",
  );
  const member = await env.DB.prepare(
    "SELECT p.email,m.role FROM identity_principal p JOIN identity_tenant_membership m ON m.principal_id=p.id WHERE p.subject=? AND m.tenant_id=?",
  )
    .bind(`auth-subject-${tenantId}`, tenantId)
    .first<{ email: string; role: string }>();
  expect(member).toEqual({
    email: `new-${tenantId}@example.test`,
    role: "viewer",
  });
  const globalRoles = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM identity_global_role WHERE principal_id=?",
  )
    .bind(firstResult.principalId)
    .first<{ count: number }>();
  expect(globalRoles?.count).toBe(0);
});

it.each([
  [
    "inactive principal",
    "UPDATE identity_principal SET is_active=0 WHERE subject=?",
  ],
  [
    "inactive membership",
    "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=(SELECT id FROM identity_principal WHERE subject=?)",
  ],
  [
    "elevated membership",
    "UPDATE identity_tenant_membership SET role='tenant_admin' WHERE principal_id=(SELECT id FROM identity_principal WHERE subject=?)",
  ],
  [
    "changed email",
    "UPDATE identity_principal SET email='changed@example.test' WHERE subject=?",
  ],
  [
    "changed subject",
    "UPDATE identity_principal SET subject='changed-auth-subject' WHERE subject=?",
  ],
])("rejects a ledger retry after its %s changes", async (_change, mutation) => {
  const tenantId = await createTenant();
  const { app } = createApp();
  const request = () =>
    app.request("/_internal/social-registration", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-savia-bridge-key": "test-bridge-key",
      },
      body: JSON.stringify(payload(tenantId)),
    });

  expect((await request()).status).toBe(200);
  await env.DB.prepare(mutation).bind(`auth-subject-${tenantId}`).run();
  const retry = await request();

  expect(retry.status).toBe(409);
});

it("accepts a concurrent same-attempt insert only while its resulting membership is active", async () => {
  const tenantId = await createTenant();
  const input = payload(tenantId);
  let simulateRace = true;
  const db = {
    prepare: (sql: string) => env.DB.prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      if (simulateRace) {
        simulateRace = false;
        await finalizeSocialRegistration(env.DB, input as any);
        throw new Error(
          "UNIQUE constraint failed: social_registration_ledger.attempt_id",
        );
      }
      return env.DB.batch(statements);
    },
  } as unknown as D1Database;
  const { app } = createApp(undefined, "test-bridge-key", db);

  const response = await app.request("/_internal/social-registration", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-savia-bridge-key": "test-bridge-key",
    },
    body: JSON.stringify(input),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ created: false });

  await env.DB.prepare(
    "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=(SELECT id FROM identity_principal WHERE subject=?)",
  )
    .bind(input.subject)
    .run();
  const staleReplay = await app.request("/_internal/social-registration", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-savia-bridge-key": "test-bridge-key",
    },
    body: JSON.stringify(input),
  });
  expect(staleReplay.status).toBe(409);
});

it("rejects an attempt replay with a different subject without changing the original membership", async () => {
  const tenantId = await createTenant();
  const { app } = createApp();
  const post = (input: ReturnType<typeof payload>) =>
    app.request("/_internal/social-registration", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-savia-bridge-key": "test-bridge-key",
      },
      body: JSON.stringify(input),
    });

  expect((await post(payload(tenantId))).status).toBe(200);
  const conflict = await post(
    payload(tenantId, { subject: "different-auth-subject" }),
  );
  expect(conflict.status).toBe(409);
  const members = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM identity_tenant_membership m JOIN identity_principal p ON p.id=m.principal_id WHERE m.tenant_id=? AND p.subject LIKE 'auth-subject-%'",
  )
    .bind(tenantId)
    .first<{ count: number }>();
  expect(members?.count).toBe(1);
});

it("rejects stale or disabled registration policy before writing identity rows", async () => {
  const tenantId = await createTenant();
  const { app } = createApp({
    configured: true,
    active: true,
    allowRegistration: true,
    googleEnabled: true,
    microsoftEnabled: false,
    revision: "revision-2",
  });

  const response = await app.request("/_internal/social-registration", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-savia-bridge-key": "test-bridge-key",
    },
    body: JSON.stringify(payload(tenantId)),
  });

  expect(response.status).toBe(409);
  const principal = await env.DB.prepare(
    "SELECT id FROM identity_principal WHERE subject=?",
  )
    .bind(`auth-subject-${tenantId}`)
    .first();
  expect(principal).toBeNull();
});

it("rejects inactive tenants, disabled registration, and disabled providers", async () => {
  const variants = [
    { active: false, allowRegistration: true, googleEnabled: true },
    { active: true, allowRegistration: false, googleEnabled: true },
    { active: true, allowRegistration: true, googleEnabled: false },
  ];
  for (const [index, variant] of variants.entries()) {
    const tenantId = await createTenant();
    const { app } = createApp({
      ...variant,
      configured: true,
      microsoftEnabled: false,
      revision: "revision-1",
    });

    const response = await app.request("/_internal/social-registration", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-savia-bridge-key": "test-bridge-key",
      },
      body: JSON.stringify(
        payload(tenantId, { attemptId: `policy-case-${index}` }),
      ),
    });

    expect(response.status).toBe(409);
    const principal = await env.DB.prepare(
      "SELECT id FROM identity_principal WHERE subject=?",
    )
      .bind(`auth-subject-${tenantId}`)
      .first();
    expect(principal).toBeNull();
  }
});

it("rejects an identity already present in another tenant without moving it", async () => {
  const sourceTenantId = await createTenant();
  const targetTenantId = await createTenant();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,'savia:better-auth',?,?,?,1,?,?)",
  )
    .bind(
      "existing-social-principal",
      "existing-social-subject",
      "existing@example.test",
      "Existing",
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'viewer',1,?,?)",
  )
    .bind(
      "existing-social-membership",
      "existing-social-principal",
      sourceTenantId,
      now,
      now,
    )
    .run();
  const { app } = createApp();

  const response = await app.request("/_internal/social-registration", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-savia-bridge-key": "test-bridge-key",
    },
    body: JSON.stringify(
      payload(targetTenantId, {
        subject: "existing-social-subject",
        email: "existing@example.test",
      }),
    ),
  });

  expect(response.status).toBe(409);
  const membership = await env.DB.prepare(
    "SELECT tenant_id FROM identity_tenant_membership WHERE principal_id=?",
  )
    .bind("existing-social-principal")
    .first<{ tenant_id: number }>();
  expect(membership?.tenant_id).toBe(sourceTenantId);
});

it("lets the database capacity guard admit at most one concurrent last-seat registration", async () => {
  const tenantId = await createTenant(1);
  const { app } = createApp();
  const post = (suffix: string) =>
    app.request("/_internal/social-registration", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-savia-bridge-key": "test-bridge-key",
      },
      body: JSON.stringify(
        payload(tenantId, {
          attemptId: `last-seat-${suffix}`,
          subject: `last-seat-subject-${suffix}`,
          email: `last-seat-${suffix}@example.test`,
        }),
      ),
    });

  const responses = await Promise.all([post("one"), post("two")]);

  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 409,
  ]);
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM identity_tenant_membership WHERE tenant_id=? AND is_active=1",
  )
    .bind(tenantId)
    .first<{ count: number }>();
  expect(count?.count).toBe(1);
});

it("compensates only the rows created by a finalized attempt", async () => {
  const tenantId = await createTenant();
  const { app } = createApp();
  const headers = {
    "content-type": "application/json",
    "x-savia-bridge-key": "test-bridge-key",
  };

  const finalized = await app.request("/_internal/social-registration", {
    method: "POST",
    headers,
    body: JSON.stringify(payload(tenantId)),
  });
  expect(finalized.status).toBe(200);
  const removed = await app.request(
    `/_internal/social-registration/${encodeURIComponent(`attempt-${tenantId}`)}`,
    { method: "DELETE", headers },
  );
  expect(removed.status).toBe(200);
  expect(await removed.json()).toEqual({ ok: true, removed: true });
  const remaining = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM identity_principal WHERE subject=?",
  )
    .bind(`auth-subject-${tenantId}`)
    .first<{ count: number }>();
  expect(remaining?.count).toBe(0);
});

it("acknowledges compensation when the attempt ledger is already absent", async () => {
  const tenantId = await createTenant();
  const { app } = createApp();
  const response = await app.request(
    `/_internal/social-registration/${encodeURIComponent(`attempt-${tenantId}`)}`,
    {
      method: "DELETE",
      headers: { "x-savia-bridge-key": "test-bridge-key" },
    },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, removed: true });

  const attempt = await app.request("/_internal/social-registration", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-savia-bridge-key": "test-bridge-key",
    },
    body: JSON.stringify(payload(tenantId)),
  });
  expect(attempt.status).toBe(409);
  const principal = await env.DB.prepare(
    "SELECT id FROM identity_principal WHERE subject=?",
  )
    .bind(`auth-subject-${tenantId}`)
    .first();
  expect(principal).toBeNull();
});

it("fences a DELETE that lands after finalization preflight but before its write batch", async () => {
  const tenantId = await createTenant();
  let announceBatch!: () => void;
  let releaseBatch!: () => void;
  const batchReached = new Promise<void>((resolve) => {
    announceBatch = resolve;
  });
  const batchGate = new Promise<void>((resolve) => {
    releaseBatch = resolve;
  });
  const racingDb = {
    prepare: (sql: string) => env.DB.prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      announceBatch();
      await batchGate;
      return env.DB.batch(statements);
    },
  } as unknown as D1Database;
  const { app } = createApp(undefined, "test-bridge-key", racingDb);
  const post = app.request("/_internal/social-registration", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-savia-bridge-key": "test-bridge-key",
    },
    body: JSON.stringify(payload(tenantId)),
  });

  let batchTimeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    batchReached,
    new Promise<never>((_, reject) => {
      batchTimeout = setTimeout(
        () => reject(new Error("Finalization did not reach its write batch.")),
        1_000,
      );
    }),
  ]).finally(() => {
    if (batchTimeout) clearTimeout(batchTimeout);
  });
  const deletion = await app.request(
    `/_internal/social-registration/${encodeURIComponent(`attempt-${tenantId}`)}`,
    {
      method: "DELETE",
      headers: { "x-savia-bridge-key": "test-bridge-key" },
    },
  );
  expect(deletion.status).toBe(200);
  expect(await deletion.json()).toEqual({ ok: true, removed: true });
  releaseBatch();

  const finalized = await post;
  expect(finalized.status).toBe(409);
  const principal = await env.DB.prepare(
    "SELECT id FROM identity_principal WHERE subject=?",
  )
    .bind(`auth-subject-${tenantId}`)
    .first();
  expect(principal).toBeNull();
});

it("preserves a principal whose membership was elevated before compensation", async () => {
  const tenantId = await createTenant();
  const { app } = createApp();
  const headers = {
    "content-type": "application/json",
    "x-savia-bridge-key": "test-bridge-key",
  };
  const finalized = await app.request("/_internal/social-registration", {
    method: "POST",
    headers,
    body: JSON.stringify(payload(tenantId)),
  });
  const result = await finalized.json<any>();
  await env.DB.prepare(
    "UPDATE identity_tenant_membership SET role='tenant_admin' WHERE id=?",
  )
    .bind(result.membershipId)
    .run();

  const removed = await app.request(
    `/_internal/social-registration/${encodeURIComponent(`attempt-${tenantId}`)}`,
    { method: "DELETE", headers },
  );

  expect(removed.status).toBe(200);
  expect(await removed.json()).toEqual({ ok: true, removed: false });
  const principal = await env.DB.prepare(
    "SELECT id FROM identity_principal WHERE id=?",
  )
    .bind(result.principalId)
    .first();
  expect(principal).not.toBeNull();
});
