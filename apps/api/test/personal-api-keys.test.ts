import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  upsertPrincipal,
  loadActor,
  ensureBootstrapAdministrator,
} from "../src/auth/identity-repository";
import { PersonalApiKeys } from "../src/auth/personal-api-keys";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
).sort(([a], [b]) => a.localeCompare(b));
beforeAll(async () => {
  for (const [, sql] of migrations)
    for (const part of sql.split("--> statement-breakpoint")) {
      const statement = part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await env.DB.exec(statement);
    }
});
async function fixture() {
  const principal = await upsertPrincipal(env.DB, {
    issuer: "savia:better-auth",
    subject: crypto.randomUUID(),
    email: `${crypto.randomUUID()}@test.example`,
    displayName: "Key tester",
  });
  await ensureBootstrapAdministrator(env.DB, principal.id);
  return loadActor(env.DB, principal);
}
const input = {
  name: "Companion",
  tenantId: 0,
  scopes: ["recordings:read", "recordings:upload"] as const,
};
describe("personal API key lifecycle", () => {
  it("reveals only once, stores a digest, audits metadata and revokes idempotently", async () => {
    const actor = await fixture(),
      repo = new PersonalApiKeys(env.DB, "https://preview.example", () =>
        Date.parse("2026-10-03T00:00:00Z"),
      );
    const created = await repo.create(actor, {
      ...input,
      scopes: [...input.scopes],
    });
    expect(created.secret).toMatch(/^savia_pat_/);
    expect(created.key.expiresAt).toBe("2026-11-02T00:00:00.000Z");
    const raw = await env.DB.prepare(
      "SELECT * FROM personal_api_keys WHERE id=?",
    )
      .bind(created.key.id)
      .first<any>();
    expect(raw.secret_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(raw)).not.toContain(created.secret);
    expect(await repo.list(actor.principal.id)).toEqual([created.key]);
    expect((await repo.authenticate(created.secret)).actor.principal.id).toBe(
      actor.principal.id,
    );
    await repo.touch(created.key.id);
    expect((await repo.list(actor.principal.id))[0].lastUsedAt).toBe(
      "2026-10-03T00:00:00.000Z",
    );
    await repo.revoke(actor.principal.id, created.key.id);
    await repo.revoke(actor.principal.id, created.key.id);
    await expect(repo.authenticate(created.secret)).rejects.toThrow();
    const audit = await env.DB.prepare(
      "SELECT * FROM access_audit WHERE target_id=?",
    )
      .bind(created.key.id)
      .all();
    expect(audit.results).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain(created.secret);
    expect(JSON.stringify(audit)).not.toContain(raw.secret_digest);
  });
  it("isolates owners, deployments and expiry boundaries", async () => {
    const actor = await fixture(),
      other = await fixture();
    let now = Date.parse("2026-10-03T00:00:00Z");
    const repo = new PersonalApiKeys(env.DB, "preview", () => now);
    const created = await repo.create(actor, {
      ...input,
      scopes: [...input.scopes],
      lifetimeDays: 7,
    });
    expect(await repo.list(other.principal.id)).toEqual([]);
    await repo.revoke(other.principal.id, created.key.id);
    expect((await repo.authenticate(created.secret)).key.id).toBe(
      created.key.id,
    );
    await expect(
      new PersonalApiKeys(env.DB, "production", () => now).authenticate(
        created.secret,
      ),
    ).rejects.toThrow();
    now += 7 * 86400000;
    await expect(repo.authenticate(created.secret)).rejects.toThrow();
  });
  it("rejects invalid names, lifetimes, scopes and tenant membership", async () => {
    const actor = await fixture(),
      repo = new PersonalApiKeys(env.DB, "preview");
    for (const patch of [
      { name: "" },
      { name: "x".repeat(81) },
      { lifetimeDays: 0 },
      { lifetimeDays: 91 },
      { scopes: [] },
      { scopes: ["*"] },
      { tenantId: 9999 },
    ])
      await expect(
        repo.create(actor, {
          ...input,
          scopes: [...input.scopes],
          ...patch,
        } as any),
      ).rejects.toThrow();
  });
  it("rechecks current identity, membership and tenant state", async () => {
    const actor = await fixture(),
      repo = new PersonalApiKeys(env.DB, "preview");
    const { secret } = await repo.create(actor, {
      ...input,
      scopes: [...input.scopes],
    });
    await env.DB.prepare("UPDATE identity_principal SET is_active=0 WHERE id=?")
      .bind(actor.principal.id)
      .run();
    await expect(repo.authenticate(secret)).rejects.toThrow();
    await env.DB.prepare("UPDATE identity_principal SET is_active=1 WHERE id=?")
      .bind(actor.principal.id)
      .run();
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=?",
    )
      .bind(actor.principal.id)
      .run();
    await expect(repo.authenticate(secret)).rejects.toThrow();
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=1 WHERE principal_id=?",
    )
      .bind(actor.principal.id)
      .run();
    await env.DB.prepare("UPDATE tenants SET is_active=0 WHERE id=0").run();
    try {
      await expect(repo.authenticate(secret)).rejects.toThrow();
    } finally {
      await env.DB.prepare("UPDATE tenants SET is_active=1 WHERE id=0").run();
    }
  });
  it("caps concurrent creation at twenty live keys", async () => {
    const actor = await fixture(),
      repo = new PersonalApiKeys(env.DB, "preview");
    for (let i = 0; i < 19; i++)
      await repo.create(actor, { ...input, scopes: [...input.scopes] });
    const results = await Promise.allSettled([
      repo.create(actor, { ...input, scopes: [...input.scopes] }),
      repo.create(actor, { ...input, scopes: [...input.scopes] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await repo.list(actor.principal.id)).toHaveLength(20);
  });
});

it("authenticates a real key and denies it after membership removal", async () => {
  const { betterAuthAuthenticator } = await import("../src/auth/better-auth");
  const actor = await fixture(),
    repo = new PersonalApiKeys(env.DB, "preview");
  const { secret } = await repo.create(actor, {
    ...input,
    scopes: [...input.scopes],
  });
  const auth = betterAuthAuthenticator(undefined, undefined, repo);
  const request = new Request(
    "https://preview.example/v1/companion/recordings",
    { headers: { authorization: `Bearer ${secret}` } },
  );
  expect((await auth.authenticate(request, env.DB)).credential).toMatchObject({
    kind: "personal-api-key",
    tenantId: 0,
  });
  await env.DB.prepare(
    "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=?",
  )
    .bind(actor.principal.id)
    .run();
  await expect(auth.authenticate(request, env.DB)).rejects.toThrow();
});

it("records last use only after a successful authorized response", async () => {
  const { betterAuthAuthenticator } = await import("../src/auth/better-auth");
  const { authenticationMiddleware } = await import("../src/auth/middleware");
  const { OpenAPIHono } = await import("@hono/zod-openapi");
  const actor = await fixture(),
    repo = new PersonalApiKeys(env.DB, "preview");
  const { secret, key } = await repo.create(actor, {
    ...input,
    scopes: ["recordings:read"],
  });
  const app = new OpenAPIHono();
  app.use(
    "*",
    authenticationMiddleware(
      env.DB,
      betterAuthAuthenticator(undefined, undefined, repo),
    ),
  );
  let status: 200 | 403 = 403;
  app.get("/v1/companion/recordings", (c) => c.json({}, status));
  const request = () =>
    app.request("/v1/companion/recordings", {
      headers: { authorization: `Bearer ${secret}` },
    });
  expect((await request()).status).toBe(403);
  expect(
    (await repo.list(actor.principal.id)).find((k) => k.id === key.id)
      ?.lastUsedAt,
  ).toBeNull();
  status = 200;
  expect((await request()).status).toBe(200);
  expect(
    (await repo.list(actor.principal.id)).find((k) => k.id === key.id)
      ?.lastUsedAt,
  ).not.toBeNull();
});
