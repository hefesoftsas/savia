import { HTTPException } from "hono/http-exception";
import { guard } from "@savia/studio-server/services";
import { databaseConflict } from "@savia/db/errors";
import {
  defaultSettings,
  settingsSchema,
  type BookingSettings,
  type Reservation,
} from "./contracts";
import { bookingConference } from "./conference";
import { occupancyMinutes } from "./domain";
export type BookingRow = {
  id: string;
  tenant_id: number;
  professional_id: string;
  principal_id: string;
  service_id: string;
  service_name: string;
  professional_name: string;
  starts_at: string;
  ends_at: string;
  buffer_minutes: number;
  customer_name: string;
  customer_email: string;
  customer_locale?: "en" | "es" | "pt";
  manage_token: string;
  request_key: string;
  request_hash: string;
  status: "confirmed" | "cancelled";
  version: number;
  calendar_provider: "google_calendar" | "outlook" | null;
  calendar_connection_id: string | null;
  external_id: string | null;
  zoom_connection_id?: string | null;
  conference_provider?: "google_meet" | "teams" | "jitsi" | null;

  conference_url?: string | null;
  conference_status?: "ready" | "pending" | "unsupported" | "failed" | null;
  created_at: string;
};
export type CalendarGrant = {
  provider: "google_calendar" | "outlook";
  connection_id: string;
  conference_provider: "auto" | "zoom";
  zoom_connection_id: string | null;
};
const conflict = () =>
  new HTTPException(409, {
    message: "The slot or settings changed. Refresh and try again.",
  });
export async function atomic(
  db: D1Database,
  statements: D1PreparedStatement[],
) {
  try {
    return await db.batch(statements);
  } catch (e) {
    if (
      /tenant_booking_occupancy|tenant_bookings|studio_write_guards|CHECK constraint|UNIQUE constraint|duplicate key/i.test(
        String(e),
      ) ||
      databaseConflict(e)
    )
      throw conflict();
    throw e;
  }
}
export async function readSettings(
  db: D1Database,
  tenantId: number,
  title = "Appointments",
) {
  const row = await db
    .prepare(
      "SELECT config,version,public_token FROM tenant_booking_settings WHERE tenant_id=?",
    )
    .bind(tenantId)
    .first<{ config: string; version: number; public_token: string }>();
  return {
    settings: row
      ? settingsSchema.parse({
          ...JSON.parse(row.config),
          version: row.version,
        })
      : defaultSettings(title),
    publicToken: row?.public_token ?? null,
  };
}
export async function candidates(db: D1Database, tenantId: number) {
  const r = await db
    .prepare(
      "SELECT p.id AS \"principalId\",p.display_name AS \"displayName\" FROM identity_principal p JOIN identity_tenant_membership m ON m.principal_id=p.id WHERE m.tenant_id=? AND m.is_active=1 AND p.is_active=1 AND p.issuer='savia:better-auth' AND NOT EXISTS(SELECT 1 FROM identity_global_role g WHERE g.principal_id=p.id AND g.role='platform_admin') ORDER BY p.display_name LIMIT 500",
    )
    .bind(tenantId)
    .all<{ principalId: string; displayName: string }>();
  return r.results;
}
export function memberGuard(
  db: D1Database,
  tenantId: number,
  principalId: string,
) {
  return guard(
    db,
    "SELECT EXISTS(SELECT 1 FROM tenants t JOIN identity_tenant_membership m ON m.tenant_id=t.id JOIN identity_principal p ON p.id=m.principal_id WHERE t.id=? AND t.kind='commercial' AND t.is_active=1 AND m.principal_id=? AND m.is_active=1 AND p.is_active=1 AND p.issuer='savia:better-auth' AND NOT EXISTS(SELECT 1 FROM identity_global_role g WHERE g.principal_id=p.id AND g.role='platform_admin'))",
    [tenantId, principalId],
  );
}
export async function saveSettings(
  db: D1Database,
  tenantId: number,
  input: BookingSettings,
) {
  const eligible = await candidates(db, tenantId);
  if (
    input.professionals.some(
      (p) => !eligible.some((c) => c.principalId === p.principalId),
    )
  )
    throw new HTTPException(422, {
      message: "Professionals must be active Savia users of this tenant.",
    });
  const old = await readSettings(db, tenantId);
  if (old.settings.version !== input.version) throw conflict();
  const token = old.publicToken ?? crypto.randomUUID(),
    version = input.version + 1;
  const g = guard(
    db,
    input.version === 0
      ? "SELECT NOT EXISTS(SELECT 1 FROM tenant_booking_settings WHERE tenant_id=?)"
      : "SELECT EXISTS(SELECT 1 FROM tenant_booking_settings WHERE tenant_id=? AND version=?)",
    input.version === 0 ? [tenantId] : [tenantId, input.version],
  );
  const members = input.professionals.map((p) =>
    memberGuard(db, tenantId, p.principalId),
  );
  const result = await atomic(db, [
    g.start,
    ...members.map((m) => m.start),
    db
      .prepare(
        "INSERT INTO tenant_booking_settings(tenant_id,public_token,config,version) VALUES(?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET config=excluded.config,version=excluded.version WHERE tenant_booking_settings.version=?",
      )
      .bind(
        tenantId,
        token,
        JSON.stringify({ ...input, version }),
        version,
        input.version,
      ),
    ...members.map((m) => m.end),
    g.end,
  ]);
  if (result[1 + members.length].meta.changes !== 1) throw conflict();
  return readSettings(db, tenantId);
}
export async function publishedSettings(db: D1Database, token: string) {
  const row = await db
    .prepare(
      "SELECT s.tenant_id,s.config,s.version,s.public_token FROM tenant_booking_settings s JOIN tenants t ON t.id=s.tenant_id WHERE s.public_token=? AND t.is_active=1 AND t.kind='commercial'",
    )
    .bind(token)
    .first<{
      tenant_id: number;
      config: string;
      version: number;
      public_token: string;
    }>();
  if (!row)
    throw new HTTPException(404, { message: "Booking page unavailable." });
  const settings = settingsSchema.parse({
    ...JSON.parse(row.config),
    version: row.version,
  });
  if (!settings.enabled || !settings.published)
    throw new HTTPException(404, { message: "Booking page unavailable." });
  return { tenantId: row.tenant_id, settings, publicToken: row.public_token };
}
export async function readGrant(
  db: D1Database,
  tenantId: number,
  principalId: string,
) {
  return db
    .prepare(
      "SELECT provider,connection_id,conference_provider,zoom_connection_id FROM tenant_booking_calendar_grants WHERE tenant_id=? AND principal_id=?",
    )
    .bind(tenantId, principalId)
    .first<CalendarGrant>();
}
export async function nativeBusy(
  db: D1Database,
  tenantId: number,
  principalId: string,
  from: string,
  to: string,
  exceptId?: string,
) {
  const r = await db
    .prepare(
      "SELECT starts_at,ends_at,buffer_minutes FROM tenant_bookings WHERE tenant_id=? AND principal_id=? AND status='confirmed' AND starts_at<? AND ends_at>? AND id<>?",
    )
    .bind(
      tenantId,
      principalId,
      to,
      new Date(Date.parse(from) - 120 * 60000).toISOString(),
      exceptId ?? "",
    )
    .all<{ starts_at: string; ends_at: string; buffer_minutes: number }>();
  return r.results.map((v) => ({
    start: v.starts_at,
    end: new Date(
      Date.parse(v.ends_at) + v.buffer_minutes * 60000,
    ).toISOString(),
  }));
}
export async function findRequest(
  db: D1Database,
  tenantId: number,
  key: string,
) {
  return db
    .prepare(
      "SELECT * FROM tenant_bookings WHERE tenant_id=? AND request_key=?",
    )
    .bind(tenantId, key)
    .first<BookingRow>();
}
export async function readBooking(
  db: D1Database,
  tenantId: number,
  id: string,
) {
  return db
    .prepare("SELECT * FROM tenant_bookings WHERE tenant_id=? AND id=?")
    .bind(tenantId, id)
    .first<BookingRow>();
}
export async function managedBooking(db: D1Database, token: string) {
  const row = await db
    .prepare(
      "SELECT b.* FROM tenant_bookings b JOIN tenants t ON t.id=b.tenant_id WHERE b.manage_token=? AND t.kind='commercial'",
    )
    .bind(token)
    .first<BookingRow>();
  if (!row)
    throw new HTTPException(404, { message: "Reservation unavailable." });
  return row;
}
export function occupancyStatements(db: D1Database, row: BookingRow) {
  const minutes = occupancyMinutes(
      row.starts_at,
      row.ends_at,
      row.buffer_minutes,
    ),
    statements: D1PreparedStatement[] = [];
  for (let i = 0; i < minutes.length; i += 20) {
    const chunk = minutes.slice(i, i + 20);
    statements.push(
      db
        .prepare(
          `INSERT INTO tenant_booking_occupancy(tenant_id,principal_id,minute,booking_id) VALUES ${chunk.map(() => "(?,?,?,?)").join(",")}`,
        )
        .bind(
          ...chunk.flatMap((m) => [row.tenant_id, row.principal_id, m, row.id]),
        ),
    );
  }
  return statements;
}
export function jobStatements(
  db: D1Database,
  row: BookingRow,
  kind: "confirmation" | "change" | "cancellation",
  settings: BookingSettings,
  now = Date.now(),
) {
  const jobs: Array<{ kind: string; due: number }> = [{ kind, due: now }];
  if (row.calendar_provider) jobs.push({ kind: "calendar", due: now });
  if (
    row.status === "confirmed" &&
    settings.reminderMinutes > 0 &&
    Date.parse(row.starts_at) - settings.reminderMinutes * 60000 > now
  )
    jobs.push({
      kind: "reminder",
      due: Date.parse(row.starts_at) - settings.reminderMinutes * 60000,
    });
  return jobs.map((j) =>
    db
      .prepare(
        "INSERT INTO tenant_booking_jobs(id,tenant_id,booking_id,revision,kind,due_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        row.tenant_id,
        row.id,
        row.version,
        j.kind,
        j.due,
      ),
  );
}
export async function createReservation(
  db: D1Database,
  row: BookingRow,
  settings: BookingSettings,
  publicLinkId?: string,
  now = Date.now(),
) {
  const link = publicLinkId
    ? guard(
        db,
        "SELECT EXISTS(SELECT 1 FROM tenant_booking_public_links WHERE id=? AND tenant_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) )",
        [publicLinkId, row.tenant_id, new Date(now).toISOString()],
      )
    : undefined;
  const membership = memberGuard(db, row.tenant_id, row.principal_id),
    revision = guard(
      db,
      "SELECT EXISTS(SELECT 1 FROM tenant_booking_settings WHERE tenant_id=? AND version=?)",
      [row.tenant_id, settings.version],
    );
  await atomic(db, [
    ...(link ? [link.start] : []),
    membership.start,
    revision.start,
    db
      .prepare(
        "INSERT INTO tenant_bookings(id,tenant_id,professional_id,principal_id,service_id,service_name,professional_name,starts_at,ends_at,buffer_minutes,customer_name,customer_email,manage_token,request_key,request_hash,status,version,calendar_provider,calendar_connection_id,external_id,created_at,customer_locale,conference_provider,conference_url,conference_status,zoom_connection_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        row.id,
        row.tenant_id,
        row.professional_id,
        row.principal_id,
        row.service_id,
        row.service_name,
        row.professional_name,
        row.starts_at,
        row.ends_at,
        row.buffer_minutes,
        row.customer_name,
        row.customer_email,
        row.manage_token,
        row.request_key,
        row.request_hash,
        row.status,
        row.version,
        row.calendar_provider,
        row.calendar_connection_id,
        row.external_id,
        row.created_at,
        row.customer_locale ?? "en",
        row.conference_provider ?? null,
        row.conference_url ?? null,
        row.conference_status ?? null,
        row.zoom_connection_id ?? null,
      ),
    ...occupancyStatements(db, row),
    ...jobStatements(db, row, "confirmation", settings),
    revision.end,
    membership.end,
    ...(link ? [link.end] : []),
  ]);
}
export async function changeReservation(
  db: D1Database,
  row: BookingRow,
  settings: BookingSettings,
  input: {
    version: number;
    startsAt?: string;
    endsAt?: string;
    cancel?: boolean;
  },
) {
  if (row.version !== input.version || row.status !== "confirmed")
    throw conflict();
  const changed = {
    ...row,
    version: row.version + 1,
    starts_at: input.startsAt ?? row.starts_at,
    ends_at: input.endsAt ?? row.ends_at,
    status: input.cancel ? ("cancelled" as const) : ("confirmed" as const),
  };
  const g = guard(
    db,
    "SELECT EXISTS(SELECT 1 FROM tenant_bookings WHERE tenant_id=? AND id=? AND version=? AND status='confirmed') AND NOT EXISTS(SELECT 1 FROM tenant_booking_delivery_locks WHERE tenant_id=? AND booking_id=? AND lease_until>?)",
    [row.tenant_id, row.id, input.version, row.tenant_id, row.id, Date.now()],
  );
  const settingGuard = guard(
    db,
    "SELECT EXISTS(SELECT 1 FROM tenant_booking_settings WHERE tenant_id=? AND version=?)",
    [row.tenant_id, settings.version],
  );
  const member = input.cancel
    ? null
    : memberGuard(db, row.tenant_id, row.principal_id);
  await atomic(db, [
    g.start,
    settingGuard.start,
    ...(member ? [member.start] : []),
    db
      .prepare(
        "DELETE FROM tenant_booking_occupancy WHERE tenant_id=? AND booking_id=?",
      )
      .bind(row.tenant_id, row.id),
    db
      .prepare(
        "UPDATE tenant_bookings SET starts_at=?,ends_at=?,status=?,version=? WHERE tenant_id=? AND id=? AND version=?",
      )
      .bind(
        changed.starts_at,
        changed.ends_at,
        changed.status,
        changed.version,
        row.tenant_id,
        row.id,
        input.version,
      ),
    ...(input.cancel ? [] : occupancyStatements(db, changed)),
    db
      .prepare(
        "UPDATE tenant_booking_jobs SET status='skipped' WHERE tenant_id=? AND booking_id=? AND revision<? AND status IN ('pending','failed')",
      )
      .bind(row.tenant_id, row.id, changed.version),
    ...jobStatements(
      db,
      changed,
      input.cancel ? "cancellation" : "change",
      settings,
    ),
    ...(member ? [member.end] : []),
    settingGuard.end,
    g.end,
  ]);
  return changed;
}
export async function reservationView(
  db: D1Database,
  row: BookingRow,
): Promise<Reservation> {
  const jobs = await db
    .prepare(
      "SELECT revision,kind,status,error_code FROM tenant_booking_jobs WHERE tenant_id=? AND booking_id=? AND revision=?",
    )
    .bind(row.tenant_id, row.id, row.version)
    .all<BookingJobRow>();
  return reservationFromJobs(row, jobs.results);
}

type BookingJobRow = {
  booking_id?: string;
  revision: number;
  kind: string;
  status: string;
  error_code: string | null;
};

function reservationFromJobs(
  row: BookingRow,
  jobs: BookingJobRow[],
): Reservation {
  const state = (calendar: boolean) => {
    const relevant = jobs.filter(
      (j) => (j.kind === "calendar") === calendar && j.kind !== "reminder",
    );
    if (!relevant.length) return "not_requested";
    if (
      relevant.some(
        (j) =>
          j.status === "failed" &&
          j.error_code !== "BOOKING_CONFERENCE_PENDING",
      )
    )
      return "failed";
    if (
      relevant.some(
        (j) =>
          j.status === "pending" ||
          j.status === "processing" ||
          (j.status === "failed" &&
            j.error_code === "BOOKING_CONFERENCE_PENDING"),
      )
    )
      return "pending";
    return relevant.every((j) => j.status === "skipped")
      ? "skipped"
      : "completed";
  };
  return {
    id: row.id,
    serviceId: row.service_id,
    professionalId: row.professional_id,
    serviceName: row.service_name,
    professionalName: row.professional_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    status: row.status,
    version: row.version,
    deliveryStatus: state(false),
    calendarStatus: state(true),
    calendarProvider: row.calendar_provider,
    calendarEventIdPresent: Boolean(row.external_id),
    conference: bookingConference(row, state(true)),
  };
}

/** Loads bounded reservation batches with their current-revision delivery state. */
export async function reservationViews(
  db: D1Database,
  rows: BookingRow[],
): Promise<Reservation[]> {
  const jobsByBooking = new Map<string, BookingJobRow[]>();
  const grouped = new Map<number, BookingRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.tenant_id) ?? [];
    group.push(row);
    grouped.set(row.tenant_id, group);
  }
  for (const [tenantId, tenantRows] of grouped) {
    // Two parameters per reservation plus the tenant id stay below D1's
    // 100-parameter limit, even at the list's 500-row maximum.
    for (let offset = 0; offset < tenantRows.length; offset += 49) {
      const batch = tenantRows.slice(offset, offset + 49);
      const values = batch.map(() => "(?,CAST(? AS INTEGER))").join(",");
      const jobs = await db
        .prepare(
          `WITH requested(booking_id,revision) AS (VALUES ${values}) SELECT j.booking_id,j.revision,j.kind,j.status,j.error_code FROM requested r JOIN tenant_booking_jobs j ON j.booking_id=r.booking_id AND j.revision=r.revision WHERE j.tenant_id=?`,
        )
        .bind(...batch.flatMap((row) => [row.id, row.version]), tenantId)
        .all<BookingJobRow>();
      for (const job of jobs.results) {
        if (!job.booking_id) continue;
        const key = `${tenantId}:${job.booking_id}`;
        const current = jobsByBooking.get(key) ?? [];
        current.push(job);
        jobsByBooking.set(key, current);
      }
    }
  }
  return rows.map((row) =>
    reservationFromJobs(
      row,
      jobsByBooking.get(`${row.tenant_id}:${row.id}`) ?? [],
    ),
  );
}
