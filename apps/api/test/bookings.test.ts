import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { createApp } from "../src/app";
import {
  AuthenticationError,
  type AppActor,
  type Authenticator,
} from "../src/auth/types";

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

it("lists a professional's own confirmed agenda with interval overlap and safe fields", async () => {
  const f = await fixture();
  const reservation = ((await (await f.reserve()).json()) as any).data
    .reservation;
  const disabled = {
    ...f.settings,
    enabled: false,
    published: false,
    professionals: f.settings.professionals.map((professional: any) => ({
      ...professional,
      enabled: false,
    })),
    services: f.settings.services.map((service: any) => ({
      ...service,
      enabled: false,
    })),
  };
  await env.DB.prepare(
    "UPDATE tenant_booking_settings SET config=? WHERE tenant_id=?",
  )
    .bind(JSON.stringify(disabled), f.tenantId)
    .run();
  const from = new Date(
    Date.parse(reservation.startsAt) + 5 * 60000,
  ).toISOString();
  const to = new Date(Date.parse(reservation.endsAt) + 5 * 60000).toISOString();
  const response = await f.app.request(
    `/v1/personal-integrations/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&timeZone=UTC`,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = (await response.json()) as any;
  expect(body.data).toHaveLength(1);
  expect(body.data[0]).toMatchObject({
    id: reservation.id,
    tenantId: f.tenantId,
    tenantSlug: `booking-${f.tenantId}`,
    tenantName: "Booking tenant",
    serviceName: "Consultation",
    professionalName: "Professional",
    customerName: "Customer",
    customerEmail: "customer@example.test",
    startsAt: reservation.startsAt,
    endsAt: reservation.endsAt,
    timeZone: "UTC",
    status: "confirmed",
    version: 1,
    externalEvent: null,
  });
  expect(JSON.stringify(body)).not.toMatch(
    /manage_token|request_hash|request_key|connection_id|access_token/i,
  );
  const touchesOnlyAtEnd = await f.app.request(
    `/v1/personal-integrations/bookings?from=${encodeURIComponent(reservation.endsAt)}&to=${encodeURIComponent(new Date(Date.parse(reservation.endsAt) + 60000).toISOString())}&timeZone=UTC`,
  );
  expect(((await touchesOnlyAtEnd.json()) as any).data).toHaveLength(0);
});

it("keeps an administrator's agenda limited to their own current membership", async () => {
  const f = await fixture();
  const own = ((await (await f.reserve()).json()) as any).data.reservation;
  const otherPrincipalId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",
  )
    .bind(
      otherPrincipalId,
      "savia:better-auth",
      otherPrincipalId,
      `${otherPrincipalId}@example.test`,
      "Other professional",
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'operator',1,?,?)",
  )
    .bind(crypto.randomUUID(), otherPrincipalId, f.tenantId, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_bookings(id,tenant_id,professional_id,principal_id,service_id,service_name,professional_name,starts_at,ends_at,buffer_minutes,customer_name,customer_email,manage_token,request_key,request_hash,status,version,calendar_provider,calendar_connection_id,external_id,created_at,customer_locale) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?, ?,?,'confirmed',1,NULL,NULL,NULL,?,'en')",
  )
    .bind(
      crypto.randomUUID(),
      f.tenantId,
      crypto.randomUUID(),
      otherPrincipalId,
      crypto.randomUUID(),
      "Other service",
      "Other professional",
      own.startsAt,
      own.endsAt,
      "Private customer",
      "private@example.test",
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      now,
    )
    .run();
  const from = new Date(Date.parse(own.startsAt) - 60000).toISOString();
  const to = new Date(Date.parse(own.endsAt) + 60000).toISOString();
  const url = `/v1/personal-integrations/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&timeZone=UTC`;
  const first = ((await (await f.app.request(url)).json()) as any).data;
  expect(first.map((entry: any) => entry.customerName)).toEqual(["Customer"]);
  f.actor.credential = { kind: "oauth", scopes: [] };
  expect((await f.app.request(url)).status).toBe(403);
  delete f.actor.credential;
  await env.DB.prepare(
    "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=?",
  )
    .bind(f.principalId)
    .run();
  expect(((await (await f.app.request(url)).json()) as any).data).toEqual([]);
});

it("validates agenda ranges and follows only the current saved calendar connection", async () => {
  const f = await fixture();
  const booking = ((await (await f.reserve()).json()) as any).data;
  const from = new Date(
    Date.parse(booking.reservation.startsAt) - 60000,
  ).toISOString();
  const to = new Date(
    Date.parse(booking.reservation.endsAt) + 60000,
  ).toISOString();
  const url = (query: string) => `/v1/personal-integrations/bookings?${query}`;
  const valid = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&timeZone=UTC`;
  expect(
    (
      await f.app.request(
        url(valid.replace("timeZone=UTC", "timeZone=Invalid%2FZone")),
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await f.app.request(
        url(
          `from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}&timeZone=UTC`,
        ),
      )
    ).status,
  ).toBe(422);
  expect(
    (
      await f.app.request(
        url(
          `from=${encodeURIComponent(from)}&to=${encodeURIComponent(new Date(Date.parse(from) + 63 * 86400000).toISOString())}&timeZone=UTC`,
        ),
      )
    ).status,
  ).toBe(422);

  const connectionId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO personal_integration_connections(id,principal_id,provider,nango_connection_id,nango_integration_id,status,external_account_label,external_account_id,scopes,last_validated_at,disconnected_at,created_at,updated_at) VALUES(?,?, 'google_calendar', ?, 'calendar', 'connected', NULL, NULL, '[]', ?, NULL, ?, ?)",
  )
    .bind(
      connectionId,
      f.principalId,
      connectionId,
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
  await env.DB.prepare(
    "UPDATE tenant_bookings SET calendar_provider='google_calendar',calendar_connection_id=?,external_id='saved-event' WHERE id=?",
  )
    .bind(connectionId, booking.reservation.id)
    .run();
  const first = ((await (await f.app.request(url(valid))).json()) as any)
    .data[0];
  expect(first.externalEvent).toEqual({
    provider: "google_calendar",
    id: "saved-event",
  });

  await env.DB.prepare(
    "UPDATE personal_integration_connections SET status='disconnected',disconnected_at=?,updated_at=? WHERE id=?",
  )
    .bind(timestamp, timestamp, connectionId)
    .run();
  const replacementId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO personal_integration_connections(id,principal_id,provider,nango_connection_id,nango_integration_id,status,external_account_label,external_account_id,scopes,last_validated_at,disconnected_at,created_at,updated_at) VALUES(?,?, 'google_calendar', ?, 'calendar', 'connected', NULL, NULL, '[]', ?, NULL, ?, ?)",
  )
    .bind(
      replacementId,
      f.principalId,
      replacementId,
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
  const stale = ((await (await f.app.request(url(valid))).json()) as any)
    .data[0];
  expect(stale.externalEvent).toBeNull();

  const move = new Date(
    Date.parse(booking.reservation.startsAt) + 60 * 60000,
  ).toISOString();
  const manageToken = new URL(booking.managementUrl).pathname.split("/").at(-1);
  const rescheduled = await f.app.request(
    `/api/public/bookings/manage/${manageToken}/reschedule`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1, startsAt: move }),
    },
  );
  expect(rescheduled.status).toBe(200);
  expect(
    ((await (await f.app.request(url(valid))).json()) as any).data,
  ).toEqual([]);
  const newRange = `from=${encodeURIComponent(move)}&to=${encodeURIComponent(new Date(Date.parse(move) + 31 * 60000).toISOString())}&timeZone=UTC`;
  expect(
    ((await (await f.app.request(url(newRange))).json()) as any).data[0]
      .startsAt,
  ).toBe(move);
  const cancelled = await f.app.request(
    `/api/public/bookings/manage/${manageToken}/cancel`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 2 }),
    },
  );
  expect(cancelled.status).toBe(200);
  expect(
    ((await (await f.app.request(url(newRange))).json()) as any).data,
  ).toEqual([]);
});

it("requires an authenticated session for the personal booking feed", async () => {
  const app = createApp(env.DB, undefined, undefined, {
    authenticate: async () => {
      throw new AuthenticationError(
        "AUTHENTICATION_REQUIRED",
        "An active session is required",
      );
    },
  });
  const response = await app.request(
    "/v1/personal-integrations/bookings?from=2026-10-03T00%3A00%3A00.000Z&to=2026-10-04T00%3A00%3A00.000Z&timeZone=UTC",
  );
  expect(response.status).toBe(401);
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
it("creates a stable local short URL for a booking link", async () => {
  const f = await fixture(),
    link = await personalLink(f);
  const endpoint = `${f.base}/public-links/${link.id}/short-url`;
  const first = await f.app.request(endpoint, { method: "POST" });
  expect(first.status).toBe(200);
  const shortUrl = ((await first.json()) as any).data.shortUrl as string;
  expect(shortUrl).toMatch(/^http:\/\/localhost:5173\/s\/b\/[a-f0-9]{16}$/);
  const second = await f.app.request(endpoint, { method: "POST" });
  expect(((await second.json()) as any).data.shortUrl).toBe(shortUrl);
  const redirect = await f.app.request(new URL(shortUrl).pathname);
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get("location")).toBe(link.publicUrl);
});
it("uses the configured Shlink provider when creating a booking link", async () => {
  const destinations: string[] = [],
    f = await fixture({
      publicOrigin: "https://booking.savia.test",
      disableCaptcha: true,
      shortener: {
        shorten: async (destination) => {
          destinations.push(destination);
          return "https://go.savia.test/booking";
        },
      },
    }),
    link = await personalLink(f);
  expect(destinations).toEqual([link.publicUrl]);
  expect(link.shortUrl).toBe("https://go.savia.test/booking");
  const listed = (
    (await (await f.app.request(`${f.base}/public-links`)).json()) as any
  ).data.links;
  expect(listed.find((item: any) => item.id === link.id)?.shortUrl).toBe(
    "https://go.savia.test/booking",
  );
});
it("only shortens active links the caller can manage", async () => {
  const f = await fixture(),
    foreign = await personalLink(await fixture()),
    personal = await personalLink(f),
    teamResponse = await f.app.request(`${f.base}/public-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: { kind: "team" },
        serviceId: null,
        expiresAt: null,
        dailyLimit: 25,
      }),
    });
  expect(teamResponse.status).toBe(201);
  const team = ((await teamResponse.json()) as any).data;
  f.actor.memberships[0].role = "viewer";
  const endpoint = (id: string) => `${f.base}/public-links/${id}/short-url`;
  expect(
    (await f.app.request(endpoint(personal.id), { method: "POST" })).status,
  ).toBe(200);
  expect(
    (await f.app.request(endpoint(team.id), { method: "POST" })).status,
  ).toBe(404);
  expect(
    (await f.app.request(endpoint(foreign.id), { method: "POST" })).status,
  ).toBe(404);
});
it("rejects short URLs for revoked or expired links and invalidates redirects", async () => {
  const f = await fixture(),
    revoked = await personalLink(f),
    revokedPath = new URL(revoked.shortUrl).pathname;
  await f.app.request(`${f.base}/public-links/${revoked.id}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: revoked.version }),
  });
  expect((await f.app.request(revokedPath)).status).toBe(404);
  expect(
    (
      await f.app.request(`${f.base}/public-links/${revoked.id}/short-url`, {
        method: "POST",
      })
    ).status,
  ).toBe(404);
  const expired = await personalLink(f),
    expiredPath = new URL(expired.shortUrl).pathname;
  await env.DB.prepare(
    "UPDATE tenant_booking_public_links SET expires_at=? WHERE id=?",
  )
    .bind("2000-01-01T00:00:00.000Z", expired.id)
    .run();
  expect((await f.app.request(expiredPath)).status).toBe(404);
  expect(
    (
      await f.app.request(`${f.base}/public-links/${expired.id}/short-url`, {
        method: "POST",
      })
    ).status,
  ).toBe(404);
});
it("deletes inactive links and never recreates a deleted legacy link", async () => {
  const f = await fixture();
  const listed = (
    (await (await f.app.request(`${f.base}/public-links`)).json()) as any
  ).data.links;
  const legacy = listed.find(
    (item: any) => item.id === f.publicBase.split("/").at(-1),
  );
  expect(legacy).toBeTruthy();
  await f.app.request(`${f.base}/public-links/${legacy.id}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: legacy.version }),
  });
  const deletion = await f.app.request(`${f.base}/public-links/${legacy.id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: legacy.version + 1 }),
  });
  expect(deletion.status).toBe(200);
  await f.app.request(`${f.base}/public-links`);
  expect((await f.app.request(f.publicBase)).status).toBe(404);
  const after = (
    (await (await f.app.request(`${f.base}/public-links`)).json()) as any
  ).data.links;
  expect(after.some((item: any) => item.id === legacy.id)).toBe(false);
});
it("does not let another tenant or a nonmanager delete a booking link", async () => {
  const f = await fixture(),
    foreign = await personalLink(await fixture()),
    teamResponse = await f.app.request(`${f.base}/public-links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: { kind: "team" },
        serviceId: null,
        expiresAt: null,
        dailyLimit: 25,
      }),
    });
  expect(teamResponse.status).toBe(201);
  const team = ((await teamResponse.json()) as any).data;
  f.actor.memberships[0].role = "viewer";
  const deleteLink = (id: string, version: number) =>
    f.app.request(`${f.base}/public-links/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    });
  expect((await deleteLink(foreign.id, foreign.version)).status).toBe(404);
  expect((await deleteLink(team.id, team.version)).status).toBe(404);
});
it("deletes a booking link with a revision while preserving appointment management", async () => {
  const f = await fixture(),
    link = await personalLink(f);
  const reservation = await f.app.request(`${link.base}/reservations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(f.payload),
  });
  expect(reservation.status).toBe(201);
  const managementUrl = ((await reservation.json()) as any).data.managementUrl;
  const deletion = await f.app.request(`${f.base}/public-links/${link.id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: link.version }),
  });
  expect(deletion.status).toBe(200);
  expect((await f.app.request(link.base)).status).toBe(404);
  const listed = (
    (await (await f.app.request(`${f.base}/public-links`)).json()) as any
  ).data.links;
  expect(listed.some((item: any) => item.id === link.id)).toBe(false);
  expect(
    (
      await f.app.request(
        new URL(managementUrl).pathname.replace("/public/", "/api/public/"),
      )
    ).status,
  ).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS count FROM tenant_bookings WHERE tenant_id=?",
    )
      .bind(f.tenantId)
      .first<{ count: number }>(),
  ).toMatchObject({ count: 1 });
  expect(
    (
      await f.app.request(`${f.base}/public-links/${link.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: link.version }),
      })
    ).status,
  ).toBe(404);
});
it("rejects stale booking link deletion revisions", async () => {
  const f = await fixture(),
    link = await personalLink(f);
  const response = await f.app.request(`${f.base}/public-links/${link.id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: link.version + 1 }),
  });
  expect(response.status).toBe(409);
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

it("returns private month availability after sharing revocation, excluding only its own occupied time", async () => {
  const f = await fixture();
  const result = ((await (await f.reserve()).json()) as any).data;
  const manage = new URL(result.managementUrl).pathname.replace(
    "/public/",
    "/api/public/",
  );
  await env.DB.prepare(
    "UPDATE tenant_booking_public_links SET revoked_at=? WHERE tenant_id=?",
  )
    .bind(new Date().toISOString(), f.tenantId)
    .run();
  const bootstrap = await f.app.request(manage);
  expect(bootstrap.status).toBe(200);
  const state = ((await bootstrap.json()) as any).data;
  expect(state).toMatchObject({
    horizonDays: 60,
    leadMinutes: 0,
    canReschedule: true,
    publicUrl: null,
  });
  const date = f.payload.startsAt.slice(0, 10);
  const query = new URLSearchParams({
    serviceId: f.serviceId,
    professionalId: f.professionalId,
    from: date,
    to: date,
    displayTimeZone: "America/Bogota",
  });
  const response = await f.app.request(`${manage}/availability?${query}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
  const availability = ((await response.json()) as any).data;
  expect(availability.displayTimeZone).toBe("America/Bogota");
  const slots = availability.days.flatMap((day: any) => day.slots);
  expect(slots.some((slot: any) => slot.startsAt === f.payload.startsAt)).toBe(
    true,
  );
  expect(JSON.stringify(availability)).not.toContain(f.principalId);
  expect(JSON.stringify(availability)).not.toContain("customer@example.test");
  const next = slots.find(
    (slot: any) =>
      Date.parse(slot.startsAt) > Date.parse(f.payload.startsAt) + 60 * 60000,
  );
  const changed = await f.app.request(`${manage}/reschedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1, startsAt: next.startsAt }),
  });
  expect(changed.status).toBe(200);
});

it("binds private availability to its reservation and bounds its display dates", async () => {
  const f = await fixture(),
    other = await fixture();
  const data = ((await (await f.reserve()).json()) as any).data;
  const manage = new URL(data.managementUrl).pathname.replace(
    "/public/",
    "/api/public/",
  );
  const date = f.payload.startsAt.slice(0, 10);
  const query = new URLSearchParams({
    serviceId: f.serviceId,
    professionalId: f.professionalId,
    from: date,
    to: date,
  });
  const request = () => f.app.request(`${manage}/availability?${query}`);
  query.set("professionalId", other.professionalId);
  expect((await request()).status).toBe(404);
  query.set("professionalId", f.professionalId);
  query.set("serviceId", other.serviceId);
  expect((await request()).status).toBe(404);
  query.set("serviceId", f.serviceId);
  query.set(
    "to",
    new Date(Date.parse(date) + 31 * 86400000).toISOString().slice(0, 10),
  );
  expect((await request()).status).toBe(422);
  query.set("to", date);
  query.set("displayTimeZone", "Not/A_Timezone");
  expect((await request()).status).toBe(422);
  expect(
    (
      await f.app.request(
        `/api/public/bookings/manage/${crypto.randomUUID()}/availability?${query}`,
      )
    ).status,
  ).toBe(404);
});

it("disables private rescheduling after its cutoff while retaining management details", async () => {
  const f = await fixture();
  const data = ((await (await f.reserve()).json()) as any).data;
  const manage = new URL(data.managementUrl).pathname.replace(
    "/public/",
    "/api/public/",
  );
  await env.DB.prepare("UPDATE tenant_bookings SET starts_at=? WHERE id=?")
    .bind(new Date(Date.now() - 60000).toISOString(), data.reservation.id)
    .run();
  const state = ((await (await f.app.request(manage)).json()) as any).data;
  expect(state.canReschedule).toBe(false);
  const date = f.payload.startsAt.slice(0, 10);
  expect(
    (
      await f.app.request(
        `${manage}/availability?serviceId=${f.serviceId}&professionalId=${f.professionalId}&from=${date}&to=${date}`,
      )
    ).status,
  ).toBe(409);
});

it("keeps cancellation available when changed service rules prevent rescheduling", async () => {
  const f = await fixture();
  const data = ((await (await f.reserve()).json()) as any).data;
  const manage = new URL(data.managementUrl).pathname.replace(
    "/public/",
    "/api/public/",
  );
  const save = await f.app.request(f.base, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...f.settings,
      services: [{ ...f.settings.services[0], durationMinutes: 45 }],
    }),
  });
  expect(save.status).toBe(200);
  expect(
    ((await (await f.app.request(manage)).json()) as any).data.canReschedule,
  ).toBe(false);
  const date = f.payload.startsAt.slice(0, 10);
  expect(
    (
      await f.app.request(
        `${manage}/availability?serviceId=${f.serviceId}&professionalId=${f.professionalId}&from=${date}&to=${date}`,
      )
    ).status,
  ).toBe(409);
  const cancelled = await f.app.request(`${manage}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1 }),
  });
  expect(cancelled.status).toBe(200);
});

it("never moves a private reservation after its professional profile is reassigned", async () => {
  const f = await fixture();
  const result = ((await (await f.reserve()).json()) as any).data;
  const manage = new URL(result.managementUrl).pathname.replace(
    "/public/",
    "/api/public/",
  );
  const principal = crypto.randomUUID(),
    stamp = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,'savia:better-auth',?,'other@example.test','Other professional',1,?,?)",
  )
    .bind(principal, principal, stamp, stamp)
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'operator',1,?,?)",
  )
    .bind(crypto.randomUUID(), principal, f.tenantId, stamp, stamp)
    .run();
  const changedSettings = await f.app.request(f.base, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...f.settings,
      professionals: [
        { ...f.settings.professionals[0], principalId: principal },
      ],
    }),
  });
  expect(changedSettings.status).toBe(200);
  const date = f.payload.startsAt.slice(0, 10);
  const range = await f.app.request(
    `${manage}/availability?serviceId=${f.serviceId}&professionalId=${f.professionalId}&from=${date}&to=${date}`,
  );
  expect(range.status).toBe(404);
  expect(
    ((await (await f.app.request(manage)).json()) as any).data.canReschedule,
  ).toBe(false);
  const update = await f.app.request(`${manage}/reschedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      startsAt: new Date(
        Date.parse(f.payload.startsAt) + 120 * 60000,
      ).toISOString(),
    }),
  });
  expect(update.status).toBe(404);
});
