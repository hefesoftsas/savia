import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { runBookingJobs } from "../src/bookings/jobs";
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
    for (const entry of sql.split("--> statement-breakpoint")) {
      const s = entry
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (s) await env.DB.exec(s);
    }
});
let seq = 996000;
async function seed(kind = "confirmation") {
  const tenantId = ++seq,
    id = crypto.randomUUID(),
    token = crypto.randomUUID(),
    now = Date.parse("2026-10-04T12:00:00Z");
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(
      tenantId,
      `booking-jobs-${tenantId}`,
      "Appointments",
      String(now),
      String(now),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_bookings(id,tenant_id,professional_id,principal_id,service_id,service_name,professional_name,starts_at,ends_at,buffer_minutes,customer_name,customer_email,manage_token,request_key,request_hash,status,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'confirmed',1,?)",
  )
    .bind(
      id,
      tenantId,
      "pro",
      "principal",
      "service",
      "Consultation",
      "Professional",
      "2026-10-06T15:00:00.000Z",
      "2026-10-06T15:30:00.000Z",
      0,
      "Customer",
      "customer@example.test",
      token,
      crypto.randomUUID(),
      "hash",
      new Date(now).toISOString(),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_booking_jobs(id,tenant_id,booking_id,revision,kind,due_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(crypto.randomUUID(), tenantId, id, kind, now)
    .run();
  return { tenantId, id, token, now };
}
it("leases jobs once across concurrent schedulers and sends a scoped management link", async () => {
  const f = await seed(),
    messages: Array<{
      tenantId: number;
      to: string;
      subject: string;
      text: string;
    }> = [];
  const opts = {
    now: () => f.now,
    publicOrigin: "https://preview.example.test",
    sendMail: async (m: any) => {
      messages.push(m);
      await new Promise((r) => setTimeout(r, 10));
    },
  };
  await Promise.all([
    runBookingJobs(env.DB, opts),
    runBookingJobs(env.DB, opts),
  ]);
  await runBookingJobs(env.DB, opts);
  expect(messages).toHaveLength(1);
  expect(messages[0].tenantId).toBe(f.tenantId);
  expect(messages[0].to).toBe("customer@example.test");
  expect(messages[0].text).toContain(`/public/bookings/manage/${f.token}`);
  expect(
    (
      await env.DB.prepare(
        "SELECT status FROM tenant_booking_jobs WHERE booking_id=?",
      )
        .bind(f.id)
        .first<{ status: string }>()
    )?.status,
  ).toBe("completed");
});

it("sends the full appointment summary in the booking's saved locale", async () => {
  const f = await seed();
  await env.DB.prepare(
    "UPDATE tenant_bookings SET customer_locale='es' WHERE id=?",
  )
    .bind(f.id)
    .run();
  const messages: Array<{ subject: string; text: string }> = [];
  await runBookingJobs(env.DB, {
    now: () => f.now,
    publicOrigin: "https://preview.example.test",
    sendMail: async ({ subject, text }) => {
      messages.push({ subject, text });
    },
  });
  expect(messages).toHaveLength(1);
  expect(messages[0].text).toContain("Tu cita está confirmada.");
  expect(messages[0].text).toContain("Customer");
  expect(messages[0].text).toContain("Consultation");
  expect(messages[0].text).toContain("Professional");
  expect(messages[0].text).toContain("Inicio:");
  expect(messages[0].text).toContain("Fin:");
  expect(messages[0].text).toContain("Duración: 30 minutos");
  expect(messages[0].text).toContain("Zona horaria:");
  expect(messages[0].text).toContain(`/public/bookings/manage/${f.token}`);
});

it("persists safe retry state and retries only after its due time", async () => {
  const f = await seed();
  let time = f.now,
    calls = 0;
  const opts = {
    now: () => time,
    publicOrigin: "https://preview.example.test",
    sendMail: async () => {
      calls++;
      if (calls === 1) throw Error("secret credentials smtp response");
    },
  };
  await runBookingJobs(env.DB, opts);
  const failed = await env.DB.prepare(
    "SELECT status,attempts,error_code FROM tenant_booking_jobs WHERE booking_id=?",
  )
    .bind(f.id)
    .first<any>();
  expect(failed.status).toBe("failed");
  expect(failed.attempts).toBe(1);
  expect(failed.error_code).toBe("BOOKING_EMAIL_UNAVAILABLE");
  await runBookingJobs(env.DB, opts);
  expect(calls).toBe(1);
  time += 120000;
  await runBookingJobs(env.DB, opts);
  expect(calls).toBe(2);
  expect(
    (
      await env.DB.prepare(
        "SELECT status FROM tenant_booking_jobs WHERE booking_id=?",
      )
        .bind(f.id)
        .first<any>()
    )?.status,
  ).toBe("completed");
});
it("skips cancelled reminders and obsolete booking revisions", async () => {
  const f = await seed("reminder");
  await env.DB.prepare(
    "UPDATE tenant_bookings SET status='cancelled',version=2 WHERE id=?",
  )
    .bind(f.id)
    .run();
  const messages: any[] = [];
  await runBookingJobs(env.DB, {
    now: () => f.now,
    publicOrigin: "https://preview.example.test",
    sendMail: async (m) => {
      messages.push(m);
    },
  });
  expect(messages).toHaveLength(0);
  expect(
    (
      await env.DB.prepare(
        "SELECT status FROM tenant_booking_jobs WHERE booking_id=?",
      )
        .bind(f.id)
        .first<any>()
    )?.status,
  ).toBe("skipped");
});

it("keeps the booking confirmed and skips mail when no transport is configured", async () => {
  const f = await seed();
  await runBookingJobs(env.DB, {
    now: () => f.now,
    publicOrigin: "https://preview.example.test",
    mailAvailability: async () => false,
    sendMail: async () => {
      throw new Error("must not attempt an unavailable transport");
    },
  });
  const job = await env.DB.prepare(
    "SELECT status,error_code FROM tenant_booking_jobs WHERE booking_id=?",
  )
    .bind(f.id)
    .first<{ status: string; error_code: string | null }>();
  expect(job).toEqual({
    status: "skipped",
    error_code: "BOOKING_EMAIL_NOT_CONFIGURED",
  });
  expect(
    (
      await env.DB.prepare("SELECT status FROM tenant_bookings WHERE id=?")
        .bind(f.id)
        .first<{ status: string }>()
    )?.status,
  ).toBe("confirmed");
});

it("records an explicit skip when the auth mail bridge is unavailable", async () => {
  const f = await seed();
  await runBookingJobs(env.DB, {
    now: () => f.now,
    publicOrigin: "https://preview.example.test",
  });
  const job = await env.DB.prepare(
    "SELECT status,error_code FROM tenant_booking_jobs WHERE booking_id=?",
  )
    .bind(f.id)
    .first<{ status: string; error_code: string | null }>();
  expect(job).toEqual({
    status: "skipped",
    error_code: "BOOKING_EMAIL_NOT_CONFIGURED",
  });
});

it("retries transient mail readiness failures", async () => {
  const f = await seed();
  let calls = 0;
  await runBookingJobs(env.DB, {
    now: () => f.now,
    publicOrigin: "https://preview.example.test",
    mailAvailability: async () => {
      calls++;
      throw new Error("bridge unavailable");
    },
    sendMail: async () => undefined,
  });
  const job = await env.DB.prepare(
    "SELECT status,error_code FROM tenant_booking_jobs WHERE booking_id=?",
  )
    .bind(f.id)
    .first<{ status: string; error_code: string | null }>();
  expect(calls).toBe(1);
  expect(job).toEqual({
    status: "failed",
    error_code: "BOOKING_EMAIL_UNAVAILABLE",
  });
});

it("expires admission hashes in bounded batches while retaining the seven-day retry window", async () => {
  const f = await seed();
  const linkId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO tenant_booking_public_links(id,tenant_id,token,scope_kind) VALUES(?,?,?,'team')",
  )
    .bind(linkId, f.tenantId, crypto.randomUUID())
    .run();
  const old = new Date(f.now - 8 * 86400000).toISOString();
  const cutoff = new Date(f.now - 7 * 86400000).toISOString();
  await env.DB.prepare(
    `INSERT INTO tenant_booking_request_receipts(id,link_id,tenant_id,request_key,request_hash,ip_hash,day,created_at)
    WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<501)
    SELECT ?||'-'||n,?,?,?||'-'||n,'hash','ip','2026-09-26',? FROM sequence`,
  )
    .bind(linkId, linkId, f.tenantId, linkId, old)
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_booking_request_receipts(id,link_id,tenant_id,request_key,request_hash,ip_hash,day,created_at) VALUES(?,?,?,?,'recent-hash','ip','2026-09-27',?)",
  )
    .bind("recent-" + linkId, linkId, f.tenantId, "recent-" + linkId, cutoff)
    .run();
  const run = () =>
    runBookingJobs(env.DB, {
      now: () => f.now,
      publicOrigin: "https://preview.example.test",
    });
  await run();
  const count = async () =>
    (
      await env.DB.prepare(
        "SELECT count(*) AS count FROM tenant_booking_request_receipts WHERE link_id=?",
      )
        .bind(linkId)
        .first<{ count: number }>()
    )?.count;
  expect(await count()).toBe(2);
  await run();
  expect(await count()).toBe(1);
  expect(
    await env.DB.prepare(
      "SELECT request_hash FROM tenant_booking_request_receipts WHERE id=?",
    )
      .bind("recent-" + linkId)
      .first(),
  ).toEqual({ request_hash: "recent-hash" });
});

async function seedCalendar() {
  const f = await seed("calendar");
  const principal = `meeting-${f.id}`;
  await env.DB.prepare(
    "INSERT INTO identity_principal(id,issuer,subject,email,display_name,is_active,created_at,updated_at) VALUES(?,'test',?,?,'Professional',1,'2026-01-01','2026-01-01')",
  )
    .bind(principal, principal, `${principal}@example.test`)
    .run();
  await env.DB.prepare(
    "INSERT INTO identity_tenant_membership(id,principal_id,tenant_id,role,is_active,created_at,updated_at) VALUES(?,?,?,'operator',1,'2026-01-01','2026-01-01')",
  )
    .bind(crypto.randomUUID(), principal, f.tenantId)
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_booking_calendar_grants(tenant_id,principal_id,provider,connection_id) VALUES(?,?,'google_calendar','meeting-connection')",
  )
    .bind(f.tenantId, principal)
    .run();
  await env.DB.prepare(
    "UPDATE tenant_bookings SET principal_id=?,calendar_provider='google_calendar',calendar_connection_id='meeting-connection' WHERE id=?",
  )
    .bind(principal, f.id)
    .run();
  return f;
}

it("stops showing a pending conference when the calendar grant is revoked", async () => {
  const { readBooking, reservationView } =
    await import("../src/bookings/repository");
  const f = await seedCalendar();
  await env.DB.prepare(
    "UPDATE tenant_bookings SET conference_provider='google_meet',conference_status='pending' WHERE id=?",
  )
    .bind(f.id)
    .run();
  await env.DB.prepare(
    "DELETE FROM tenant_booking_calendar_grants WHERE tenant_id=?",
  )
    .bind(f.tenantId)
    .run();
  await runBookingJobs(env.DB, {
    publicOrigin: "https://savia.test",
    now: () => f.now,
  });
  const row = await readBooking(env.DB, f.tenantId, f.id);
  const view = await reservationView(env.DB, row!);
  expect(view.calendarStatus).toBe("skipped");
  expect(view.conference?.status).toBe("failed");
});

it("persists a meeting link and exposes it only while the booking is confirmed", async () => {
  const { readBooking, reservationView } =
    await import("../src/bookings/repository");
  const f = await seedCalendar();
  const conference = {
    provider: "google_meet" as const,
    joinUrl: "https://meet.google.com/abc-defg-hij",
    status: "ready" as const,
  };
  await runBookingJobs(env.DB, {
    now: () => f.now,
    publicOrigin: "https://example.test",
    calendar: {
      busy: async () => [],
      sync: async () => ({ externalId: "meeting-id", conference }),
    },
  });
  const row = await readBooking(env.DB, f.tenantId, f.id);
  expect(row?.external_id).toBe("meeting-id");
  expect((await reservationView(env.DB, row!)).conference).toEqual(conference);
  await env.DB.prepare(
    "UPDATE tenant_bookings SET status='cancelled' WHERE id=?",
  )
    .bind(f.id)
    .run();
  expect(
    (
      await reservationView(
        env.DB,
        (await readBooking(env.DB, f.tenantId, f.id))!,
      )
    ).conference,
  ).toBeNull();
});

it("preserves a ready Jitsi room through calendar sync failure and mail retries", async () => {
  const { readBooking, reservationView } =
    await import("../src/bookings/repository");
  const f = await seedCalendar();
  const room = `https://meet.jit.si/savia-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "UPDATE tenant_bookings SET conference_provider='jitsi',conference_url=?,conference_status='ready' WHERE id=?",
  )
    .bind(room, f.id)
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_booking_jobs(id,tenant_id,booking_id,revision,kind,due_at) VALUES(?,?,?,1,'confirmation',?)",
  )
    .bind(crypto.randomUUID(), f.tenantId, f.id, f.now)
    .run();
  let time = f.now;
  let mailAttempts = 0;
  const messages: string[] = [];
  const options = {
    now: () => time,
    publicOrigin: "https://example.test",
    sendMail: async (message: { text: string }) => {
      mailAttempts++;
      if (mailAttempts === 1) throw new Error("temporary mail failure");
      messages.push(message.text);
    },
    calendar: {
      busy: async () => [],
      sync: async () => {
        throw new Error("calendar unavailable");
      },
    },
  };
  await runBookingJobs(env.DB, options);
  let row = await readBooking(env.DB, f.tenantId, f.id);
  expect((await reservationView(env.DB, row!)).conference).toEqual({
    provider: "jitsi",
    joinUrl: room,
    status: "ready",
  });
  time += 120000;
  await runBookingJobs(env.DB, options);
  row = await readBooking(env.DB, f.tenantId, f.id);
  expect(mailAttempts).toBeGreaterThan(1);
  expect(messages.length).toBeGreaterThan(0);
  expect(messages).toEqual(
    expect.arrayContaining([expect.stringContaining(room)]),
  );
  expect((await reservationView(env.DB, row!)).conference?.joinUrl).toBe(room);
});

it("saves the provider event before retrying a pending conference and reuses it", async () => {
  const { readBooking, reservationView } =
    await import("../src/bookings/repository");
  const f = await seedCalendar();
  let time = f.now;
  const ids: Array<string | null> = [];
  const opts = {
    now: () => time,
    publicOrigin: "https://example.test",
    calendar: {
      busy: async () => [],
      sync: async (input: { externalId: string | null }) => {
        ids.push(input.externalId);
        return {
          externalId: "pending-event",
          conference: {
            provider: "google_meet" as const,
            joinUrl:
              ids.length === 1 ? null : "https://meet.google.com/abc-defg-hij",
            status:
              ids.length === 1 ? ("pending" as const) : ("ready" as const),
          },
        };
      },
    },
  };
  await runBookingJobs(env.DB, opts);
  expect((await readBooking(env.DB, f.tenantId, f.id))?.external_id).toBe(
    "pending-event",
  );
  expect(
    (
      await reservationView(
        env.DB,
        (await readBooking(env.DB, f.tenantId, f.id))!,
      )
    ).conference?.status,
  ).toBe("pending");
  expect(
    (
      await reservationView(
        env.DB,
        (await readBooking(env.DB, f.tenantId, f.id))!,
      )
    ).calendarStatus,
  ).toBe("pending");
  time += 120000;
  await runBookingJobs(env.DB, opts);
  expect(ids).toEqual([null, "pending-event"]);
  expect(
    (
      await reservationView(
        env.DB,
        (await readBooking(env.DB, f.tenantId, f.id))!,
      )
    ).conference?.status,
  ).toBe("ready");
});

it("keeps a confirmed appointment when its calendar cannot create video meetings", async () => {
  const { readBooking, reservationView } =
    await import("../src/bookings/repository");
  const f = await seedCalendar();
  await runBookingJobs(env.DB, {
    now: () => f.now,
    publicOrigin: "https://example.test",
    calendar: {
      busy: async () => [],
      sync: async () => ({
        externalId: "plain-event",
        conference: {
          provider: null,
          joinUrl: null,
          status: "unsupported" as const,
        },
      }),
    },
  });
  const result = await reservationView(
    env.DB,
    (await readBooking(env.DB, f.tenantId, f.id))!,
  );
  expect(result.status).toBe("confirmed");
  expect(result.calendarStatus).toBe("completed");
  expect(result.conference?.status).toBe("unsupported");
});

it("ends bounded conference polling without leaving an appointment permanently pending", async () => {
  const { readBooking, reservationView } =
    await import("../src/bookings/repository");
  const f = await seedCalendar();
  let now = f.now;
  const opts = {
    now: () => now,
    publicOrigin: "https://example.test",
    calendar: {
      busy: async () => [],
      sync: async () => ({
        externalId: "slow-meeting",
        conference: {
          provider: "google_meet" as const,
          joinUrl: null,
          status: "pending" as const,
        },
      }),
    },
  };
  for (let i = 0; i < 5; i++) {
    await runBookingJobs(env.DB, opts);
    now += 3600000;
  }
  const view = await reservationView(
    env.DB,
    (await readBooking(env.DB, f.tenantId, f.id))!,
  );
  expect(view.status).toBe("confirmed");
  expect(view.conference).toEqual({
    provider: "google_meet",
    joinUrl: null,
    status: "failed",
  });
  expect(
    await env.DB.prepare(
      "SELECT attempts,status FROM tenant_booking_jobs WHERE booking_id=?",
    )
      .bind(f.id)
      .first(),
  ).toEqual({ attempts: 5, status: "completed" });
});

it("does not attach an old revision's conference when the booking changes during calendar I/O", async () => {
  const { readBooking, reservationView } =
    await import("../src/bookings/repository");
  const f = await seedCalendar();
  await runBookingJobs(env.DB, {
    now: () => f.now,
    publicOrigin: "https://example.test",
    calendar: {
      busy: async () => [],
      sync: async () => {
        await env.DB.prepare(
          "UPDATE tenant_bookings SET version=2,status='cancelled' WHERE id=?",
        )
          .bind(f.id)
          .run();
        return {
          externalId: "recovered",
          conference: {
            provider: "google_meet" as const,
            joinUrl: "https://meet.google.com/old",
            status: "ready" as const,
          },
        };
      },
    },
  });
  const row = await readBooking(env.DB, f.tenantId, f.id);
  expect(row?.external_id).toBe("recovered");
  expect(row?.conference_url).toBeNull();
  expect((await reservationView(env.DB, row!)).conference).toBeNull();
});

it("does not advertise pending video creation for legacy completed calendar events", async () => {
  const { readBooking, reservationView } =
    await import("../src/bookings/repository");
  const f = await seedCalendar();
  await env.DB.prepare(
    "UPDATE tenant_booking_jobs SET status='completed' WHERE booking_id=?",
  )
    .bind(f.id)
    .run();
  await env.DB.prepare(
    "UPDATE tenant_bookings SET external_id='legacy-event' WHERE id=?",
  )
    .bind(f.id)
    .run();
  const view = await reservationView(
    env.DB,
    (await readBooking(env.DB, f.tenantId, f.id))!,
  );
  expect(view.conference).toBeNull();
});
