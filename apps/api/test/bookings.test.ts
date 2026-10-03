import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { AppActor, Authenticator } from "../src/auth/types";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);
beforeAll(async () => {
  for (const sql of migrations)
    for (const entry of sql.split("--> statement-breakpoint")) {
      const statement = entry
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (statement) await env.DB.exec(statement);
    }
});
let sequence = 997000;
async function fixture(captchaOptions?: Parameters<typeof createApp>[22]) {
  const tenantId = ++sequence,
    principalId = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(tenantId, `booking-${tenantId}`, "Booking tenant", now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",
  )
    .bind(
      principalId,
      "savia:better-auth",
      principalId,
      `${principalId}@example.test`,
      "Professional",
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'tenant_admin',1,?,?)",
  )
    .bind(crypto.randomUUID(), principalId, tenantId, now, now)
    .run();
  const actor: AppActor = {
    principal: {
      id: principalId,
      issuer: "savia:better-auth",
      subject: principalId,
      email: `${principalId}@example.test`,
      displayName: "Professional",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    globalRoles: [],
    memberships: [
      {
        id: principalId,
        principalId,
        tenantId,
        agencyId: tenantId,
        role: "tenant_admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  const args: Parameters<typeof createApp> = [env.DB];
  args[3] = { authenticate: async () => actor } as Authenticator;
  args[22] = captchaOptions ?? {
    publicOrigin: "http://localhost:5173",
    disableCaptcha: true,
  };
  const app = createApp(...args),
    base = `/v1/tenants/${tenantId}/booking`;
  const response = await app.request(base);
  expect(response.status).toBe(200);
  const boot = ((await response.json()) as any).data;
  const professionalId = crypto.randomUUID(),
    serviceId = crypto.randomUUID();
  const settings = {
    ...boot.settings,
    enabled: true,
    published: true,
    title: "Appointments",
    timeZone: "UTC",
    leadMinutes: 0,
    horizonDays: 60,
    cancellationMinutes: 0,
    reminderMinutes: 1440,
    professionals: [
      {
        id: professionalId,
        principalId,
        enabled: true,
        weekly: Array.from({ length: 7 }, (_, day) => ({
          day,
          start: "09:00",
          end: "17:00",
        })),
        exceptions: [],
      },
    ],
    services: [
      {
        id: serviceId,
        name: "Consultation",
        description: "",
        durationMinutes: 30,
        bufferMinutes: 15,
        enabled: true,
        professionalIds: [professionalId],
      },
    ],
  };
  const saved = await app.request(base, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
  expect(saved.status).toBe(200);
  const data = ((await saved.json()) as any).data;
  const token = new URL(data.publicUrl).pathname.split("/").at(-1)!;
  const publicBase = `/api/public/bookings/${token}`;
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const slots = await app.request(
    `${publicBase}/slots?serviceId=${serviceId}&professionalId=${professionalId}&date=${date}`,
  );
  expect(slots.status).toBe(200);
  const startsAt = ((await slots.json()) as any).data.slots[0].startsAt;
  const payload = {
    serviceId,
    professionalId,
    startsAt,
    customerName: "Customer",
    customerEmail: "customer@example.test",
    captchaToken: "",
  };
  const reserve = (key = crypto.randomUUID(), body = payload) =>
    app.request(`${publicBase}/reservations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": key,
        "cf-connecting-ip": `192.0.${Math.floor(tenantId / 256) % 256}.${tenantId % 256}`,
      },
      body: JSON.stringify(body),
    });
  return {
    app,
    actor,
    tenantId,
    principalId,
    professionalId,
    serviceId,
    base,
    publicBase,
    settings: data.settings,
    payload,
    reserve,
  };
}

it("configures only active same-tenant Savia professionals and rejects stale settings", async () => {
  const f = await fixture(),
    other = await fixture();
  const save = (body: any) =>
    f.app.request(f.base, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (
      await save({
        ...f.settings,
        professionals: [
          { ...f.settings.professionals[0], principalId: other.principalId },
        ],
      })
    ).status,
  ).toBe(422);
  expect((await save({ ...f.settings, version: 0 })).status).toBe(409);
  expect((await f.app.request(other.base)).status).toBe(403);
});

it("publishes only safe catalog data and reserves without exposing principal or customer lists", async () => {
  const f = await fixture(),
    catalog = await f.app.request(f.publicBase);
  expect(catalog.status).toBe(200);
  const text = await catalog.text();
  expect(text).not.toContain(f.principalId);
  expect(text).not.toContain("customerEmail");
  const r = await f.reserve();
  expect(r.status).toBe(201);
  const data = ((await r.json()) as any).data;
  expect(data.reservation.status).toBe("confirmed");
  expect(data.managementUrl).toContain("/public/bookings/manage/");
  expect(JSON.stringify(data)).not.toContain(f.principalId);
});

it("atomically prevents concurrent overlapping bookings including trailing buffers", async () => {
  const f = await fixture();
  const results = await Promise.all([f.reserve(), f.reserve()]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const next = new Date(
    Date.parse(f.payload.startsAt) + 30 * 60000,
  ).toISOString();
  expect(
    (await f.reserve(crypto.randomUUID(), { ...f.payload, startsAt: next }))
      .status,
  ).toBe(409);
  const rows = await env.DB.prepare(
    "SELECT id FROM tenant_bookings WHERE tenant_id=?",
  )
    .bind(f.tenantId)
    .all();
  expect(rows.results).toHaveLength(1);
});

it("replays identical request keys and rejects changed payloads without duplicate jobs", async () => {
  const f = await fixture(),
    key = crypto.randomUUID();
  const first = await f.reserve(key);
  expect(first.status).toBe(201);
  const original = await first.json();
  const replay = await f.reserve(key);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(original);
  expect(
    (await f.reserve(key, { ...f.payload, customerName: "Different customer" }))
      .status,
  ).toBe(409);
  const jobs = await env.DB.prepare(
    "SELECT kind FROM tenant_booking_jobs WHERE tenant_id=?",
  )
    .bind(f.tenantId)
    .all();
  expect(
    jobs.results.filter((row: any) => row.kind === "confirmation"),
  ).toHaveLength(1);
});

it("rejects disabled membership after an availability read", async () => {
  const f = await fixture();
  await env.DB.prepare(
    "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=?",
  )
    .bind(f.principalId)
    .run();
  expect((await f.reserve()).status).toBe(404);
  const rows = await env.DB.prepare(
    "SELECT id FROM tenant_bookings WHERE tenant_id=?",
  )
    .bind(f.tenantId)
    .all();
  expect(rows.results).toHaveLength(0);
});

it("supports private management capabilities, cancellation and reuse of released slots", async () => {
  const f = await fixture(),
    r = await f.reserve(),
    data = ((await r.json()) as any).data;
  const token = new URL(data.managementUrl).pathname.split("/").at(-1);
  const manage = `/api/public/bookings/manage/${token}`;
  expect((await f.app.request(manage)).status).toBe(200);
  expect(
    (await f.app.request(`/api/public/bookings/manage/${crypto.randomUUID()}`))
      .status,
  ).toBe(404);
  const cancel = await f.app.request(`${manage}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1 }),
  });
  expect(cancel.status).toBe(200);
  expect(((await cancel.json()) as any).data.status).toBe("cancelled");
  expect((await f.reserve()).status).toBe(201);
});

it("reschedules atomically and preserves old occupancy when the new slot conflicts", async () => {
  const f = await fixture(),
    first = ((await (await f.reserve()).json()) as any).data;
  const secondAt = new Date(
    Date.parse(f.payload.startsAt) + 60 * 60000,
  ).toISOString();
  expect(
    (await f.reserve(crypto.randomUUID(), { ...f.payload, startsAt: secondAt }))
      .status,
  ).toBe(201);
  const token = new URL(first.managementUrl).pathname.split("/").at(-1);
  const change = (version: number, startsAt: string) =>
    f.app.request(`/api/public/bookings/manage/${token}/reschedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, startsAt }),
    });
  expect((await change(1, secondAt)).status).toBe(409);
  expect((await f.reserve()).status).toBe(409);
  const next = new Date(
    Date.parse(f.payload.startsAt) + 120 * 60000,
  ).toISOString();
  expect((await change(1, next)).status).toBe(200);
  expect((await change(1, f.payload.startsAt)).status).toBe(409);
  expect((await f.reserve()).status).toBe(201);
});

it("consumes an ALTCHA proof once while allowing an identical request retry", async () => {
  const secret = "savia-booking-test-secret-more-than-32-characters",
    origin = "https://booking.savia.test";
  const f = await fixture({
    publicOrigin: origin,
    captchaProvider: "altcha",
    altchaSecret: secret,
  });
  const { createChallenge, solveChallenge } = await import("altcha-lib");
  const { deriveKey } = await import("altcha-lib/algorithms/pbkdf2");
  const challenge = await createChallenge({
    algorithm: "PBKDF2/SHA-256",
    cost: 1000,
    counter: 1,
    deriveKey,
    hmacSignatureSecret: secret,
    expiresAt: new Date(Date.now() + 300000),
    data: {
      formId: f.publicBase.split("/").at(-1),
      origin,
      action: "public_submit",
    },
  });
  const solution = await solveChallenge({ challenge, deriveKey });
  const payload = {
      ...f.payload,
      captchaToken: btoa(JSON.stringify({ challenge, solution })),
    },
    key = crypto.randomUUID();
  expect((await f.reserve(key, payload)).status).toBe(201);
  expect((await f.reserve(key, payload)).status).toBe(200);
  expect(
    (
      await f.reserve(crypto.randomUUID(), {
        ...payload,
        startsAt: new Date(
          Date.parse(payload.startsAt) + 60 * 60000,
        ).toISOString(),
      })
    ).status,
  ).toBe(403);
});

it("restricts ordinary members to their own agenda and availability", async () => {
  const f = await fixture(),
    other = await fixture();
  f.actor.memberships[0].role = "member";
  const boot = await f.app.request(f.base);
  expect(boot.status).toBe(200);
  expect(((await boot.json()) as any).data.canManage).toBe(false);
  expect(
    (
      await f.app.request(f.base, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(f.settings),
      })
    ).status,
  ).toBe(403);
  const own = await f.app.request(`${f.base}/availability`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      version: f.settings.version,
      weekly: f.settings.professionals[0].weekly,
      exceptions: [],
    }),
  });
  expect(own.status).toBe(200);
  expect((await f.app.request(`${other.base}/reservations`)).status).toBe(403);
});

it("returns own current interval for private rescheduling but keeps it unavailable publicly", async () => {
  const f = await fixture(),
    data = ((await (await f.reserve()).json()) as any).data;
  const token = new URL(data.managementUrl).pathname.split("/").at(-1);
  const date = f.payload.startsAt.slice(0, 10);
  const own = await f.app.request(
    `/api/public/bookings/manage/${token}/slots?date=${date}`,
  );
  expect(own.status).toBe(200);
  expect(
    ((await own.json()) as any).data.slots.some(
      (s: any) => s.startsAt === f.payload.startsAt,
    ),
  ).toBe(true);
  const publicSlots = await f.app.request(
    `${f.publicBase}/slots?serviceId=${f.serviceId}&professionalId=${f.professionalId}&date=${date}`,
  );
  expect(
    ((await publicSlots.json()) as any).data.slots.some(
      (s: any) => s.startsAt === f.payload.startsAt,
    ),
  ).toBe(false);
});

it("preserves existing management and authorized history after tenant deactivation", async () => {
  const f = await fixture(),
    data = ((await (await f.reserve()).json()) as any).data;
  const token = new URL(data.managementUrl).pathname.split("/").at(-1);
  await env.DB.prepare("UPDATE tenants SET is_active=0 WHERE id=?")
    .bind(f.tenantId)
    .run();
  expect((await f.reserve()).status).toBe(404);
  expect(
    (await f.app.request(`/api/public/bookings/manage/${token}`)).status,
  ).toBe(200);
  expect((await f.app.request(`${f.base}/reservations`)).status).toBe(200);
  const cancelled = await f.app.request(
    `/api/public/bookings/manage/${token}/cancel`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    },
  );
  expect(cancelled.status).toBe(200);
});

it("defers reservation mutations while a delivery lease is active", async () => {
  const f = await fixture(),
    data = ((await (await f.reserve()).json()) as any).data;
  const token = new URL(data.managementUrl).pathname.split("/").at(-1);
  await env.DB.prepare(
    "INSERT INTO tenant_booking_delivery_locks(tenant_id,booking_id,lease_until,lease_token) VALUES(?,?,?,?)",
  )
    .bind(f.tenantId, data.reservation.id, Date.now() + 90000, "processing")
    .run();
  const cancel = () =>
    f.app.request(`/api/public/bookings/manage/${token}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
  expect((await cancel()).status).toBe(409);
  await env.DB.prepare(
    "DELETE FROM tenant_booking_delivery_locks WHERE tenant_id=?",
  )
    .bind(f.tenantId)
    .run();
  expect((await cancel()).status).toBe(200);
});

async function personalLink(
  f: Awaited<ReturnType<typeof fixture>>,
  overrides = {},
) {
  const r = await f.app.request(`${f.base}/public-links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: { kind: "professional", professionalId: f.professionalId },
      serviceId: null,
      expiresAt: null,
      dailyLimit: 25,
      ...overrides,
    }),
  });
  expect(r.status).toBe(201);
  const link = ((await r.json()) as any).data;
  return {
    ...link,
    base: `/api/public/bookings/${new URL(link.publicUrl).pathname.split("/").at(-1)}`,
  };
}
it("personal links fix their professional and reject caller scope widening on every route", async () => {
  const f = await fixture(),
    link = await personalLink(f);
  const catalog = ((await (await f.app.request(link.base)).json()) as any).data;
  expect(catalog.fixedProfessionalId).toBe(f.professionalId);
  expect(catalog.linkScope.kind).toBe("professional");
  expect(JSON.stringify(catalog)).not.toContain(f.principalId);
  const otherId = crypto.randomUUID(),
    date = f.payload.startsAt.slice(0, 10);
  expect(
    (
      await f.app.request(
        `${link.base}/slots?serviceId=${f.serviceId}&professionalId=${otherId}&date=${date}`,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await f.app.request(`${link.base}/reservations`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ ...f.payload, professionalId: otherId }),
      })
    ).status,
  ).toBe(404);
  await env.DB.prepare(
    "UPDATE identity_tenant_membership SET is_active=0 WHERE tenant_id=?",
  )
    .bind(f.tenantId)
    .run();
  expect((await f.app.request(`${link.base}/challenge`)).status).toBe(404);
});
it("expired or revoked personal links stop new bookings while management links survive", async () => {
  const f = await fixture(),
    link = await personalLink(f);
  const r = await f.app.request(`${link.base}/reservations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(f.payload),
  });
  expect(r.status).toBe(201);
  const managementUrl = ((await r.json()) as any).data.managementUrl;
  const revoke = await f.app.request(
    `${f.base}/public-links/${link.id}/revoke`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: link.version }),
    },
  );
  expect(revoke.status).toBe(200);
  for (const suffix of [
    "",
    "/challenge",
    `/slots?serviceId=${f.serviceId}&professionalId=${f.professionalId}&date=${f.payload.startsAt.slice(0, 10)}`,
  ])
    expect((await f.app.request(link.base + suffix)).status).toBe(404);
  expect(
    (
      await f.app.request(
        new URL(managementUrl).pathname.replace("/public/", "/api/public/"),
      )
    ).status,
  ).toBe(200);
  const expiring = await personalLink(f);
  await env.DB.prepare(
    "UPDATE tenant_booking_public_links SET expires_at=? WHERE id=?",
  )
    .bind("2000-01-01T00:00:00.000Z", expiring.id)
    .run();
  expect((await f.app.request(expiring.base)).status).toBe(404);
});
it("legacy URLs remain team-scoped and have independent revocation controls", async () => {
  const f = await fixture();
  expect(
    ((await (await f.app.request(f.publicBase)).json()) as any).data.linkScope
      .kind,
  ).toBe("team");
  const listed = (
    (await (await f.app.request(`${f.base}/public-links`)).json()) as any
  ).data.links;
  const legacy = listed.find(
    (l: any) =>
      new URL(l.publicUrl).pathname === f.publicBase.replace("/api", ""),
  );
  expect(legacy).toBeTruthy();
  await f.app.request(`${f.base}/public-links/${legacy.id}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: legacy.version }),
  });
  expect((await f.app.request(f.publicBase)).status).toBe(404);
});
it("link daily admission counts failed attempts once and preserves identical reservation retries", async () => {
  const f = await fixture(),
    link = await personalLink(f, { dailyLimit: 2 }),
    key = crypto.randomUUID();
  const submit = (id: string, payload = f.payload) =>
    f.app.request(`${link.base}/reservations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": id,
        "cf-connecting-ip": "192.0.2.42",
      },
      body: JSON.stringify(payload),
    });
  expect((await submit(key)).status).toBe(201);
  expect((await submit(key)).status).toBe(200);
  expect((await submit(crypto.randomUUID())).status).toBe(409);
  expect((await submit(crypto.randomUUID())).status).toBe(429);
  expect((await submit(key)).status).toBe(200);
  expect(
    (await submit(key, { ...f.payload, customerName: "Different" })).status,
  ).toBe(409);
});
it("anonymous booking bodies are capped at 32 KiB", async () => {
  const f = await fixture();
  const r = await f.app.request(`${f.publicBase}/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(33000) }),
  });
  expect(r.status).toBe(413);
});

it("returns bookable calendar dates and scoped UTC slots in one bounded range", async () => {
  const f = await fixture(),
    link = await personalLink(f),
    from = f.payload.startsAt.slice(0, 10),
    to = new Date(Date.parse(from) + 2 * 86400000).toISOString().slice(0, 10);
  const r = await f.app.request(
    `${link.base}/availability?serviceId=${f.serviceId}&from=${from}&to=${to}&displayTimeZone=America%2FBogota`,
  );
  expect(r.status).toBe(200);
  const data = ((await r.json()) as any).data;
  expect(data.displayTimeZone).toBe("America/Bogota");
  expect(data.days).toHaveLength(3);
  expect(
    data.days[0].slots.some(
      (slot: any) => slot.startsAt === f.payload.startsAt,
    ),
  ).toBe(true);
  expect(JSON.stringify(data)).not.toContain(f.principalId);
  expect(
    (
      await f.app.request(
        `${link.base}/availability?serviceId=${f.serviceId}&professionalId=${crypto.randomUUID()}&from=${from}&to=${to}`,
      )
    ).status,
  ).toBe(404);
  const far = new Date(Date.parse(from) + 31 * 86400000)
    .toISOString()
    .slice(0, 10);
  expect(
    (
      await f.app.request(
        `${link.base}/availability?serviceId=${f.serviceId}&from=${from}&to=${far}`,
      )
    ).status,
  ).toBe(422);
});

it("service-scoped personal links reject a different configured service", async () => {
  const f = await fixture(),
    other = crypto.randomUUID();
  const changed = await f.app.request(f.base, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...f.settings,
      services: [
        ...f.settings.services,
        { ...f.settings.services[0], id: other, name: "Another service" },
      ],
    }),
  });
  expect(changed.status).toBe(200);
  const link = await personalLink(f, { serviceId: f.serviceId });
  const catalog = ((await (await f.app.request(link.base)).json()) as any).data;
  expect(catalog.services).toHaveLength(1);
  expect(catalog.fixedServiceId).toBe(f.serviceId);
  expect(
    (
      await f.app.request(
        `${link.base}/availability?serviceId=${other}&from=${f.payload.startsAt.slice(0, 10)}&to=${f.payload.startsAt.slice(0, 10)}`,
      )
    ).status,
  ).toBe(404);
});
it("a professional can share only their own agenda and cannot revoke another scope", async () => {
  const f = await fixture();
  f.actor.memberships[0].role = "viewer";
  const link = await personalLink(f);
  expect(
    (
      await f.app.request(`${f.base}/public-links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: { kind: "team" } }),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await f.app.request(`${f.base}/public-links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: { kind: "professional", professionalId: crypto.randomUUID() },
        }),
      })
    ).status,
  ).toBe(403);
  const list = (
    (await (await f.app.request(`${f.base}/public-links`)).json()) as any
  ).data.links;
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe(link.id);
  expect(
    (
      await f.app.request(
        `${f.base}/public-links/${crypto.randomUUID()}/revoke`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: 1 }),
        },
      )
    ).status,
  ).toBe(404);
});

it("does not publish a personal link for a professional without an eligible service", async () => {
  const f = await fixture(),
    other = await fixture();
  await env.DB.prepare(
    "UPDATE identity_tenant_membership SET tenant_id=?,role='viewer' WHERE principal_id=?",
  )
    .bind(f.tenantId, other.principalId)
    .run();
  const save = await f.app.request(f.base, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...f.settings,
      professionals: [
        ...f.settings.professionals,
        other.settings.professionals[0],
      ],
    }),
  });
  expect(save.status).toBe(200);
  expect(
    (
      await f.app.request(`${f.base}/public-links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: { kind: "professional", professionalId: other.professionalId },
        }),
      })
    ).status,
  ).toBe(422);
});
