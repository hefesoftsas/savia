import { createTestApp } from "./test-app";
import { env } from "cloudflare:workers";
import { beforeAll, expect, it, vi } from "vitest";
import { platformAdministratorAuthenticator } from "./auth-fixtures";
import type { IdentityUserAdministrator } from "../src/auth/better-auth";
import {
  ensureBootstrapAdministrator,
  grantMembership,
  setPrincipalActive,
  upsertPrincipal,
} from "../src/auth/identity-repository";
const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, s]) => s);
beforeAll(async () => {
  for (const sql of migrations)
    for (const statement of sql
      .split("--> statement-breakpoint")
      .map((s) =>
        s
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
});
let counter = 980000;

it("binds a new tenant account to its email settings and sends a password setup link", async () => {
  const subject = "mail-initial-" + crypto.randomUUID();
  const createUser = vi.fn().mockResolvedValue({ subject });
  const sendPasswordReset = vi.fn().mockResolvedValue(undefined);
  const userAdministrator = {
    issuer: "savia:better-auth",
    createUser,
    sendPasswordReset,
    deleteUser: vi.fn(),
  } as unknown as IdentityUserAdministrator;
  const response = await createTestApp({
    auth: platformAdministratorAuthenticator(),
    userAdministrator,
  }).request(
    "/v1/tenants",
    post({
      name: "Email setup fixture",
      idSlug: "email-setup-fixture",
      initialUser: {
        email: "initial-email@example.test",
        firstName: "Initial",
        lastName: "User",
        role: "tenant_admin",
        emailVerified: true,
      },
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { data: { id: number } };
  expect(createUser).toHaveBeenCalledWith(
    expect.objectContaining({
      tenantId: Number(body.data.id),
      emailVerified: true,
    }),
    expect.any(Request),
  );
  expect(sendPasswordReset).toHaveBeenCalledWith(subject, expect.any(Request));
});
async function tenant(name = "Source agency") {
  // Wide spacing: tenant creation allocates MAX(id)+2, so sequential IDs
  // would collide with tenants created by the API under test.
  counter += 1000;
  const id = counter,
    slug = "transfer-" + id,
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(?,?,?,1,?,?,'commercial')",
  )
    .bind(id, slug, name, now, now)
    .run();
  return { id, slug };
}
async function member(
  email: string,
  tenantId: number,
  role: "tenant_admin" | "operator" | "viewer" = "operator",
) {
  const principal = await upsertPrincipal(env.DB, {
    issuer: "savia:better-auth",
    subject: email,
    email,
    displayName: email,
  });
  await grantMembership(env.DB, principal.id, tenantId, role);
  return principal;
}
function app() {
  // No user administrator on purpose: transferring an existing member must
  // not depend on the Better Auth service.
  return createTestApp({ auth: platformAdministratorAuthenticator() });
}
const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
async function tenantByName(name: string) {
  return env.DB.prepare("SELECT id FROM tenants WHERE name=?")
    .bind(name)
    .first<{ id: number }>();
}
async function membershipOf(principalId: string) {
  return env.DB.prepare(
    "SELECT tenant_id,role FROM identity_tenant_membership WHERE principal_id=?",
  )
    .bind(principalId)
    .first<{ tenant_id: number; role: string }>();
}
it("updates the email tenant when transferring an existing account", async () => {
  const source = await tenant();
  await member("smtp-stays@example.test", source.id, "tenant_admin");
  const moving = await member("smtp-moves@example.test", source.id);
  const updateUser = vi.fn().mockResolvedValue({});
  const userAdministrator = {
    issuer: "savia:better-auth",
    updateUser,
  } as unknown as IdentityUserAdministrator;
  const response = await createTestApp({
    auth: platformAdministratorAuthenticator(),
    userAdministrator,
  }).request(
    "/v1/tenants",
    post({
      name: "SMTP transfer",
      existingMember: { principalId: moving.id, role: "tenant_admin" },
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { data: { id: number } };
  expect(updateUser).toHaveBeenCalledWith(
    moving.subject,
    { tenantId: Number(body.data.id) },
    expect.any(Request),
  );
});
it("restores the email tenant when a transfer is rejected", async () => {
  const source = await tenant();
  const moving = await member(
    "smtp-final-member@example.test",
    source.id,
    "tenant_admin",
  );
  const updateUser = vi.fn().mockResolvedValue({});
  const userAdministrator = {
    issuer: "savia:better-auth",
    updateUser,
  } as unknown as IdentityUserAdministrator;
  const response = await createTestApp({
    auth: platformAdministratorAuthenticator(),
    userAdministrator,
  }).request(
    "/v1/tenants",
    post({
      name: "Rejected SMTP transfer",
      existingMember: { principalId: moving.id, role: "tenant_admin" },
    }),
  );
  expect(response.status).toBe(409);
  expect(updateUser).toHaveBeenLastCalledWith(
    moving.subject,
    { tenantId: source.id },
    expect.any(Request),
  );
  expect(await membershipOf(moving.id)).toMatchObject({ tenant_id: source.id });
  expect(await tenantByName("Rejected SMTP transfer")).toBeNull();
});
it("transfers an existing user as first member and keeps the source tenant", async () => {
  const source = await tenant(),
    staying = await member("stays@example.test", source.id, "tenant_admin"),
    moving = await member("moves@example.test", source.id, "operator");
  const response = await app().request(
    "/v1/tenants",
    post({
      name: "Destination agency",
      existingMember: { principalId: moving.id, role: "tenant_admin" },
    }),
  );
  expect(response.status).toBe(201);
  const created = ((await response.json()) as any).data;
  expect(created.name).toBe("Destination agency");
  expect(await membershipOf(moving.id)).toEqual({
    tenant_id: created.id,
    role: "tenant_admin",
  });
  expect(await membershipOf(staying.id)).toEqual({
    tenant_id: source.id,
    role: "tenant_admin",
  });
});
it("rejects unknown or inactive principals without creating a tenant", async () => {
  const unknown = await app().request(
    "/v1/tenants",
    post({
      name: "Nowhere agency",
      existingMember: { principalId: crypto.randomUUID(), role: "viewer" },
    }),
  );
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({
    error: { code: "USER_NOT_FOUND", message: "El usuario no existe." },
  });
  const ghost = await upsertPrincipal(env.DB, {
    issuer: "savia:better-auth",
    subject: "ghost@example.test",
    email: "ghost@example.test",
    displayName: "Ghost",
  });
  await setPrincipalActive(env.DB, ghost.id, false);
  const inactive = await app().request(
    "/v1/tenants",
    post({
      name: "Ghost agency",
      existingMember: { principalId: ghost.id, role: "viewer" },
    }),
  );
  expect(inactive.status).toBe(404);
  expect(await tenantByName("Nowhere agency")).toBe(null);
  expect(await tenantByName("Ghost agency")).toBe(null);
});
it("rejects platform administrators without touching tenants", async () => {
  const source = await tenant();
  await member("admin-source@example.test", source.id, "tenant_admin");
  const principal = await upsertPrincipal(env.DB, {
    issuer: "savia:better-auth",
    subject: "super@example.test",
    email: "super@example.test",
    displayName: "Super",
  });
  await ensureBootstrapAdministrator(env.DB, principal.id);
  const response = await app().request(
    "/v1/tenants",
    post({
      name: "Super agency",
      existingMember: { principalId: principal.id, role: "tenant_admin" },
    }),
  );
  expect(response.status).toBe(409);
  expect(await tenantByName("Super agency")).toBe(null);
  expect(await membershipOf(principal.id)).toEqual({
    tenant_id: 0,
    role: "tenant_admin",
  });
});
it("rejects transferring the last active member and compensates the tenant row", async () => {
  const source = await tenant(),
    only = await member("only@example.test", source.id, "tenant_admin");
  const response = await app().request(
    "/v1/tenants",
    post({
      name: "Lonely agency",
      existingMember: { principalId: only.id, role: "tenant_admin" },
    }),
  );
  expect(response.status).toBe(409);
  expect(await tenantByName("Lonely agency")).toBe(null);
  expect(await membershipOf(only.id)).toEqual({
    tenant_id: source.id,
    role: "tenant_admin",
  });
});
it("requires exactly one member source", async () => {
  const source = await tenant(),
    person = await member("either@example.test", source.id);
  const neither = await app().request(
    "/v1/tenants",
    post({ name: "Neither agency" }),
  );
  expect(neither.status).toBe(400);
  const both = await app().request(
    "/v1/tenants",
    post({
      name: "Both agency",
      initialUser: {
        email: "new@example.test",
        firstName: "New",
        lastName: "User",
        role: "tenant_admin",
      },
      existingMember: { principalId: person.id, role: "viewer" },
    }),
  );
  expect(both.status).toBe(400);
  expect(await tenantByName("Neither agency")).toBe(null);
  expect(await tenantByName("Both agency")).toBe(null);
});

it("assigns a readable slug, resolves collisions and keeps it stable on rename", async () => {
  const source = await tenant("Slug source");
  await member("slug-staying@example.test", source.id, "tenant_admin");
  const first = await member("slug-first@example.test", source.id);
  const second = await member("slug-second@example.test", source.id);
  const create = (principalId: string) =>
    app().request(
      "/v1/tenants",
      post({
        name: "Águila & Compañía",
        existingMember: { principalId, role: "tenant_admin" },
      }),
    );
  const firstResponse = await create(first.id);
  expect(firstResponse.status).toBe(201);
  const a = ((await firstResponse.json()) as any).data;
  expect(a.idSlug).toBe("aguila-compania");
  const secondResponse = await create(second.id);
  expect(secondResponse.status).toBe(201);
  expect(((await secondResponse.json()) as any).data.idSlug).toBe(
    "aguila-compania-2",
  );
  const renamed = await app().request(`/v1/tenants/${a.id}`, {
    ...post({ name: "New business name" }),
    method: "PATCH",
  });
  expect(renamed.status).toBe(200);
  expect(((await renamed.json()) as any).data.idSlug).toBe("aguila-compania");
});

it("keeps old tenant slugs reserved and resolves them after a controlled URL change", async () => {
  const source = await tenant("Legacy slug source");
  const response = await app().request(`/v1/tenants/${source.id}`, {
    ...post({ idSlug: "friendly-legacy-source" }),
    method: "PATCH",
  });
  expect(response.status).toBe(200);
  const current = await app().request(
    `https://${source.slug}.savia-preview.hefesoft.com/v1/tenants/current`,
  );
  expect(current.status).toBe(200);
  expect(((await current.json()) as any).data.slug).toBe(
    "friendly-legacy-source",
  );
  const other = await tenant("Other slug source");
  const conflict = await app().request(`/v1/tenants/${other.id}`, {
    ...post({ idSlug: source.slug }),
    method: "PATCH",
  });
  expect(conflict.status).toBe(409);
});

it("reserves different readable URLs for simultaneous tenant creations", async () => {
  const source = await tenant("Concurrent source");
  await member("parallel-staying@example.test", source.id, "tenant_admin");
  const first = await member("parallel-one@example.test", source.id);
  const second = await member("parallel-two@example.test", source.id);
  const responses = await Promise.all(
    [first, second].map((principal) =>
      app().request(
        "/v1/tenants",
        post({
          name: "Concurrent Team",
          existingMember: { principalId: principal.id, role: "tenant_admin" },
        }),
      ),
    ),
  );
  expect(responses.map((r) => r.status)).toEqual([201, 201]);
  const slugs = await Promise.all(
    responses.map(
      async (response) => ((await response.json()) as any).data.idSlug,
    ),
  );
  expect(slugs.sort()).toEqual(["concurrent-team", "concurrent-team-2"]);
});

it("does not restore a stale URL when a name-only edit races with a URL migration", async () => {
  const source = await tenant("Concurrent rename source");
  let release!: () => void;
  let captured!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const prepare = env.DB.prepare.bind(env.DB);
  let intercept = true;
  const spy = vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
    const statement = prepare(sql);
    if (intercept && sql.includes("WHERE t.id=? AND t.kind='commercial'")) {
      intercept = false;
      return {
        bind: (...args: unknown[]) => ({
          first: async () => {
            const row = await statement.bind(...args).first();
            captured();
            await blocked;
            return row;
          },
        }),
      } as unknown as D1PreparedStatement;
    }
    return statement;
  });
  try {
    const nameUpdate = app().request(`/v1/tenants/${source.id}`, {
      ...post({ name: "Renamed concurrently" }),
      method: "PATCH",
    });
    await read;
    const urlUpdate = await app().request(`/v1/tenants/${source.id}`, {
      ...post({ idSlug: "stable-concurrent-url" }),
      method: "PATCH",
    });
    expect(urlUpdate.status).toBe(200);
    release();
    expect((await nameUpdate).status).toBe(200);
    const row = await prepare("SELECT id_slug AS slug FROM tenants WHERE id=?")
      .bind(source.id)
      .first<{ slug: string }>();
    expect(row?.slug).toBe("stable-concurrent-url");
  } finally {
    release();
    spy.mockRestore();
  }
});
