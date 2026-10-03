import type { createBookingCalendarAdapter } from "./calendar";
import { readBooking, readSettings, readGrant } from "./repository";
import { formatBookingEmail } from "./email";
export type BookingJobsOptions = {
  now?: () => number;
  publicOrigin: string;
  calendar?: ReturnType<typeof createBookingCalendarAdapter>;
  sendMail?: (input: {
    tenantId: number;
    to: string;
    subject: string;
    text: string;
  }) => Promise<void>;
  mailAvailability?: (tenantId: number) => Promise<boolean>;
};
type Job = {
  id: string;
  tenant_id: number;
  booking_id: string;
  revision: number;
  kind: "confirmation" | "change" | "cancellation" | "reminder" | "calendar";
  attempts: number;
};
/** A per-booking lock orders calendar revisions and notices across schedulers. */
export async function runBookingJobs(
  db: D1Database,
  options: BookingJobsOptions,
) {
  const clock = options.now ?? Date.now,
    started = clock(),
    realStarted = Date.now();
  await db
    .prepare("DELETE FROM tenant_booking_rate_limits WHERE expires_at<?")
    .bind(started)
    .run();
  const pending = await db
    .prepare(
      "SELECT j.* FROM tenant_booking_jobs j JOIN tenants t ON t.id=j.tenant_id WHERE t.is_active=1 AND j.attempts<5 AND ((j.status IN ('pending','failed') AND j.due_at<=?) OR (j.status='processing' AND j.lease_until<=?)) ORDER BY j.due_at,j.id LIMIT 20",
    )
    .bind(started, started)
    .all<Job>();
  const report = { completed: 0, failed: 0, skipped: 0 };
  for (const candidate of pending.results) {
    if (Date.now() - realStarted > 20000) break;
    const current = clock(),
      lease = crypto.randomUUID(),
      until = current + 90000;
    // A shared booking-row write coordinates leases with mutation batches on
    // PostgreSQL SERIALIZABLE as well as D1's atomic writer transactions.
    const locked = await db.batch<{ lease_token: string }>([
      db
        .prepare("UPDATE tenant_bookings SET id=id WHERE tenant_id=? AND id=?")
        .bind(candidate.tenant_id, candidate.booking_id),
      db
        .prepare(
          "INSERT INTO tenant_booking_delivery_locks(tenant_id,booking_id,lease_until,lease_token) VALUES(?,?,?,?) ON CONFLICT(tenant_id,booking_id) DO UPDATE SET lease_until=excluded.lease_until,lease_token=excluded.lease_token WHERE tenant_booking_delivery_locks.lease_until<=? RETURNING lease_token",
        )
        .bind(candidate.tenant_id, candidate.booking_id, until, lease, current),
    ]);
    const lock = locked[1].results[0];
    if (!lock || lock.lease_token !== lease) continue;
    try {
      const job = await db
        .prepare(
          "UPDATE tenant_booking_jobs SET status='processing',attempts=attempts+1,lease_until=?,lease_token=? WHERE id=? AND tenant_id=? AND attempts<5 AND ((status IN ('pending','failed') AND due_at<=?) OR (status='processing' AND lease_until<=?)) RETURNING *",
        )
        .bind(until, lease, candidate.id, candidate.tenant_id, current, current)
        .first<Job>();
      if (!job) continue;
      const finish = async (
        status: "completed" | "failed" | "skipped",
        error: string | null = null,
      ) => {
        await db
          .prepare(
            "UPDATE tenant_booking_jobs SET status=?,error_code=?,due_at=?,lease_until=NULL,lease_token=NULL WHERE id=? AND tenant_id=? AND lease_token=? AND EXISTS(SELECT 1 FROM tenant_booking_delivery_locks WHERE tenant_id=? AND booking_id=? AND lease_token=?)",
          )
          .bind(
            status,
            error,
            status === "failed"
              ? clock() + Math.min(3600000, 60000 * 2 ** (job.attempts - 1))
              : clock(),
            job.id,
            job.tenant_id,
            lease,
            job.tenant_id,
            job.booking_id,
            lease,
          )
          .run();
        report[status]++;
      };
      const booking = await readBooking(db, job.tenant_id, job.booking_id);
      if (
        !booking ||
        booking.version !== job.revision ||
        (job.kind !== "cancellation" &&
          job.kind !== "calendar" &&
          booking.status === "cancelled") ||
        (job.kind === "reminder" && Date.parse(booking.starts_at) <= clock())
      ) {
        await finish("skipped");
        continue;
      }
      try {
        if (job.kind === "calendar") {
          const grant = await readGrant(
            db,
            job.tenant_id,
            booking.principal_id,
          );
          if (
            !grant ||
            grant.provider !== booking.calendar_provider ||
            grant.connection_id !== booking.calendar_connection_id
          ) {
            await finish("skipped");
            continue;
          }
          if (!options.calendar) throw Error();
          const active = await db
            .prepare(
              "SELECT 1 FROM identity_principal p JOIN identity_tenant_membership m ON m.principal_id=p.id WHERE p.id=? AND p.is_active=1 AND m.tenant_id=? AND m.is_active=1",
            )
            .bind(booking.principal_id, job.tenant_id)
            .first();
          if (!active) {
            await finish("skipped");
            continue;
          }
          const externalId = await options.calendar.sync({
            principalId: booking.principal_id,
            provider: grant.provider,
            connectionId: grant.connection_id,
            id: booking.id,
            title: booking.service_name,
            startsAt: booking.starts_at,
            endsAt: booking.ends_at,
            externalId: booking.external_id,
            cancelled: booking.status === "cancelled",
          });
          // Preserve a recovered ID even if a new native revision arrived during I/O.
          // The next revision can then update/cancel the same provider event.
          if (externalId)
            await db
              .prepare(
                "UPDATE tenant_bookings SET external_id=? WHERE tenant_id=? AND id=? AND (external_id IS NULL OR external_id=?) AND EXISTS(SELECT 1 FROM tenant_booking_delivery_locks WHERE tenant_id=? AND booking_id=? AND lease_token=?)",
              )
              .bind(
                externalId,
                job.tenant_id,
                booking.id,
                externalId,
                job.tenant_id,
                booking.id,
                lease,
              )
              .run();
        } else {
          if (!options.sendMail && !options.mailAvailability) {
            await finish("skipped", "BOOKING_EMAIL_NOT_CONFIGURED");
            continue;
          }
          if (
            options.mailAvailability &&
            !(await options.mailAvailability(job.tenant_id))
          ) {
            await finish("skipped", "BOOKING_EMAIL_NOT_CONFIGURED");
            continue;
          }
          if (!options.sendMail) throw Error();
          const state = await readSettings(db, job.tenant_id),
            managementUrl = new URL(
              `/public/bookings/manage/${booking.manage_token}`,
              options.publicOrigin,
            ).toString();
          const message = formatBookingEmail({
            booking,
            kind: job.kind,
            timeZone: state.settings.timeZone,
            managementUrl,
          });
          await options.sendMail({
            tenantId: job.tenant_id,
            to: booking.customer_email,
            ...message,
          });
        }
        await finish("completed");
      } catch {
        await finish(
          "failed",
          job.kind === "calendar"
            ? "BOOKING_CALENDAR_UNAVAILABLE"
            : "BOOKING_EMAIL_UNAVAILABLE",
        );
      }
    } finally {
      await db
        .prepare(
          "DELETE FROM tenant_booking_delivery_locks WHERE tenant_id=? AND booking_id=? AND lease_token=?",
        )
        .bind(candidate.tenant_id, candidate.booking_id, lease)
        .run();
    }
  }
  return report;
}
