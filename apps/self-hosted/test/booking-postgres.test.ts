import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { migratePostgres } from "../src/postgres/migrations";
import {
  postgresTestUrl,
  postgresTestsRequired,
  withPostgresFixture,
} from "./postgres-fixture";

const coreDirectory = resolve(
  import.meta.dirname,
  "../../../packages/db/postgres",
);

const live = postgresTestUrl ? describe : describe.skip;
if (postgresTestsRequired && !postgresTestUrl)
  it("requires the live PostgreSQL URL", () => {
    throw new Error("SAVIA_TEST_POSTGRES_URL is required.");
  });

live("native PostgreSQL tenant booking integration", () => {
  it("applies booking migrations and rolls back overlapping occupancy atomically", async () => {
    await withPostgresFixture(async (db, connectionString) => {
      const applied = await migratePostgres({
        connectionString,
        schema: "savia_core",
        directory: coreDirectory,
        seed: false,
      });
      expect(applied).toContain("0022_tenant_bookings.sql");
      expect(
        (
          await db
            .prepare(
              "SELECT to_regclass('savia_core.tenant_booking_occupancy') AS name",
            )
            .first<{ name: string }>()
        )?.name,
      ).toBe("tenant_booking_occupancy");

      const tenantId = Date.now();
      await db
        .prepare(
          "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(?,?,?,1,?,?, 'commercial')",
        )
        .bind(tenantId, `booking-${tenantId}`, "Booking test", "now", "now")
        .run();

      const insertBooking = (id: string, requestKey: string) =>
        db
          .prepare(
            "INSERT INTO tenant_bookings(id,tenant_id,professional_id,principal_id,service_id,service_name,professional_name,starts_at,ends_at,buffer_minutes,customer_name,customer_email,manage_token,request_key,request_hash,status,version,calendar_provider,calendar_connection_id,external_id,created_at) VALUES(?,?,?, ?,?,?,?,?,?,0,?,?,?,?,?,'confirmed',1,NULL,NULL,NULL,?)",
          )
          .bind(
            id,
            tenantId,
            "professional",
            "principal",
            "service",
            "Consultation",
            "Professional",
            "2026-10-04T10:00:00.000Z",
            "2026-10-04T10:30:00.000Z",
            "Customer",
            "customer@example.test",
            `manage-${id}`,
            requestKey,
            `hash-${id}`,
            "now",
          );

      const minute = Date.parse("2026-10-04T10:00:00.000Z") / 60000;
      await db.batch([
        insertBooking("existing", "request-existing"),
        db
          .prepare(
            "INSERT INTO tenant_booking_occupancy(tenant_id,principal_id,minute,booking_id) VALUES(?,?,?,?)",
          )
          .bind(tenantId, "principal", minute, "existing"),
      ]);

      await expect(
        db.batch([
          insertBooking("overlap", "request-overlap"),
          db
            .prepare(
              "INSERT INTO tenant_booking_occupancy(tenant_id,principal_id,minute,booking_id) VALUES(?,?,?,?)",
            )
            .bind(tenantId, "principal", minute, "overlap"),
          db
            .prepare(
              "INSERT INTO tenant_booking_jobs(id,tenant_id,booking_id,revision,kind,status,attempts,due_at) VALUES(?,?,?,1,'confirmation','pending',0,0)",
            )
            .bind("job-overlap", tenantId, "overlap"),
        ]),
      ).rejects.toThrow();

      expect(
        await db
          .prepare(
            "SELECT id FROM tenant_bookings WHERE tenant_id=? ORDER BY id",
          )
          .bind(tenantId)
          .all<{ id: string }>(),
      ).toMatchObject({ results: [{ id: "existing" }] });
      expect(
        await db
          .prepare("SELECT id FROM tenant_booking_jobs WHERE id='job-overlap'")
          .first(),
      ).toBeNull();
    });
  });

  it("serializes a worker lease against a stale reservation mutation", async () => {
    await withPostgresFixture(async (_db, connectionString) => {
      await migratePostgres({
        connectionString,
        schema: "savia_core",
        directory: coreDirectory,
        seed: false,
      });
      const admin = new pg.Client({ connectionString });
      await admin.connect();
      const tenantId = Date.now();
      const bookingId = randomUUID();
      await admin.query(
        "INSERT INTO savia_core.tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES($1,$2,'Booking race',1,'now','now','commercial')",
        [tenantId, `race-${tenantId}`],
      );
      await admin.query(
        "INSERT INTO savia_core.tenant_bookings(id,tenant_id,professional_id,principal_id,service_id,service_name,professional_name,starts_at,ends_at,buffer_minutes,customer_name,customer_email,manage_token,request_key,request_hash,status,version,created_at) VALUES($1,$2,'pro','principal','service','Consultation','Professional','2026-10-04T10:00:00.000Z','2026-10-04T10:30:00.000Z',0,'Customer','customer@example.test',$3,'race-request','hash','confirmed',1,'now')",
        [bookingId, tenantId, `manage-${bookingId}`],
      );

      const mutation = new pg.Client({ connectionString });
      const worker = new pg.Client({ connectionString });
      await Promise.all([mutation.connect(), worker.connect()]);
      try {
        await mutation.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const observed = await mutation.query(
          "SELECT EXISTS(SELECT 1 FROM savia_core.tenant_bookings WHERE tenant_id=$1 AND id=$2 AND version=1 AND status='confirmed') AND NOT EXISTS(SELECT 1 FROM savia_core.tenant_booking_delivery_locks WHERE tenant_id=$1 AND booking_id=$2 AND lease_until>$3) AS can_change",
          [tenantId, bookingId, Date.now()],
        );
        expect(observed.rows[0].can_change).toBe(true);

        await worker.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        await worker.query(
          "UPDATE savia_core.tenant_bookings SET id=id WHERE tenant_id=$1 AND id=$2",
          [tenantId, bookingId],
        );
        const leaseToken = randomUUID();
        await worker.query(
          "INSERT INTO savia_core.tenant_booking_delivery_locks(tenant_id,booking_id,lease_until,lease_token) VALUES($1,$2,$3,$4)",
          [tenantId, bookingId, Date.now() + 90_000, leaseToken],
        );
        await worker.query("COMMIT");

        // This worker now owns the booking row and would have read revision 1
        // before doing external I/O. The earlier mutation snapshot must lose.
        let mutationCommitted = false;
        try {
          await mutation.query(
            "UPDATE savia_core.tenant_bookings SET starts_at='2026-10-04T11:00:00.000Z',ends_at='2026-10-04T11:30:00.000Z',version=2 WHERE tenant_id=$1 AND id=$2 AND version=1",
            [tenantId, bookingId],
          );
          await mutation.query("COMMIT");
          mutationCommitted = true;
        } catch (error) {
          await mutation.query("ROLLBACK").catch(() => {});
          expect((error as { code?: string }).code).toBe("40001");
        }

        expect(mutationCommitted).toBe(false);
        const state = await admin.query(
          "SELECT version,starts_at FROM savia_core.tenant_bookings WHERE tenant_id=$1 AND id=$2",
          [tenantId, bookingId],
        );
        expect(state.rows[0]).toMatchObject({
          version: 1,
          starts_at: "2026-10-04T10:00:00.000Z",
        });
        expect(
          (
            await admin.query(
              "SELECT lease_token FROM savia_core.tenant_booking_delivery_locks WHERE tenant_id=$1 AND booking_id=$2",
              [tenantId, bookingId],
            )
          ).rows[0].lease_token,
        ).toBe(leaseToken);
      } finally {
        await mutation.query("ROLLBACK").catch(() => {});
        await Promise.all([mutation.end(), worker.end(), admin.end()]);
      }
    });
  });
});
