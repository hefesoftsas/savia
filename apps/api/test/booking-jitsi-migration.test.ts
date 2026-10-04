import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, sql]) => ({ name, sql }));

async function apply(sql: string) {
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((part) =>
      part
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean))
    await env.DB.exec(statement);
}

const tenantId = 995001;
const bookingId = "b5ba0918-fc1d-4650-80b6-e630312e9181";

beforeAll(async () => {
  for (const migration of migrations) {
    if (migration.name.endsWith("0033_booking_jitsi_conference.sql")) break;
    await apply(migration.sql);
  }
  const now = "2026-10-04T12:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,?,?)",
  )
    .bind(tenantId, "booking-jitsi-migration", "Migration Test", now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_bookings(id,tenant_id,professional_id,principal_id,service_id,service_name,professional_name,starts_at,ends_at,buffer_minutes,customer_name,customer_email,manage_token,request_key,request_hash,status,version,calendar_provider,calendar_connection_id,external_id,created_at,customer_locale,conference_provider,conference_url,conference_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'confirmed',1,NULL,NULL,NULL,?,'en','google_meet','https://meet.google.com/abc-defg-hij','ready')",
  )
    .bind(
      bookingId,
      tenantId,
      "professional",
      "principal",
      "service",
      "Consultation",
      "Professional",
      "2026-10-06T15:00:00.000Z",
      "2026-10-06T15:30:00.000Z",
      0,
      "Customer",
      "customer@example.test",
      "manage-token-migration",
      "request-key-migration",
      "request-hash-migration",
      now,
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_booking_occupancy(tenant_id,principal_id,minute,booking_id) VALUES(?,?,?,?)",
  )
    .bind(tenantId, "principal", 1, bookingId)
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_booking_jobs(id,tenant_id,booking_id,revision,kind,due_at) VALUES(?,?,?,1,'confirmation',1)",
  )
    .bind("booking-job-migration", tenantId, bookingId)
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_booking_delivery_locks(tenant_id,booking_id,lease_until,lease_token) VALUES(?,?,?,?)",
  )
    .bind(tenantId, bookingId, 10, "delivery-lock-migration")
    .run();
  const migration = migrations.find((entry) =>
    entry.name.endsWith("0033_booking_jitsi_conference.sql"),
  );
  if (!migration) throw new Error("Jitsi booking migration is missing");
  await apply(migration.sql);
});

it("extends the provider check while preserving booking rows, child data, indexes, and foreign keys", async () => {
  expect(
    await env.DB.prepare(
      "SELECT conference_provider,conference_url,conference_status FROM tenant_bookings WHERE tenant_id=? AND id=?",
    )
      .bind(tenantId, bookingId)
      .first(),
  ).toEqual({
    conference_provider: "google_meet",
    conference_url: "https://meet.google.com/abc-defg-hij",
    conference_status: "ready",
  });
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS count FROM tenant_booking_occupancy WHERE tenant_id=? AND booking_id=?",
    )
      .bind(tenantId, bookingId)
      .first(),
  ).toEqual({ count: 1 });
  expect(
    await env.DB.prepare(
      "SELECT id FROM tenant_booking_jobs WHERE tenant_id=? AND booking_id=?",
    )
      .bind(tenantId, bookingId)
      .first(),
  ).toEqual({ id: "booking-job-migration" });
  expect(
    await env.DB.prepare(
      "SELECT lease_token FROM tenant_booking_delivery_locks WHERE tenant_id=? AND booking_id=?",
    )
      .bind(tenantId, bookingId)
      .first(),
  ).toEqual({ lease_token: "delivery-lock-migration" });
  const indexes = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('tenant_bookings_agenda','tenant_booking_jobs_due') ORDER BY name",
  ).all<{ name: string }>();
  expect(indexes.results.map((row) => row.name)).toEqual([
    "tenant_booking_jobs_due",
    "tenant_bookings_agenda",
  ]);
  const foreignKeys = await env.DB.prepare("PRAGMA foreign_key_check").all();
  expect(foreignKeys.results).toEqual([]);
  const schema = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='tenant_bookings'",
  ).first<{ sql: string }>();
  expect(schema?.sql).toContain("'google_meet','teams','jitsi'");
});
