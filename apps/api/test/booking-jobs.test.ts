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
