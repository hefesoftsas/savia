import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { admitBookingRequest } from "../src/bookings/public-policy";
import {
  defaultSettings,
  type ResolvedBookingLink,
} from "../src/bookings/contracts";
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
      const stmt = entry
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
      if (stmt) await env.DB.exec(stmt);
    }
});
let tenantSequence = 999100;
async function linkFixture(limit = 25): Promise<ResolvedBookingLink> {
  const tenantId = ++tenantSequence,
    id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO tenants(id,id_slug,name,is_active,created_at,updated_at) VALUES(?,?,?,1,'now','now')",
  )
    .bind(tenantId, `quota-${tenantId}`, "Quota fixture")
    .run();
  await env.DB.prepare(
    "INSERT INTO tenant_booking_public_links(id,tenant_id,token,scope_kind,daily_limit) VALUES(?,?,?,'team',?)",
  )
    .bind(id, tenantId, id, limit)
    .run();
  return {
    id,
    tenantId,
    publicToken: id,
    scope: { kind: "team" },
    serviceId: null,
    dailyLimit: limit,
    settings: defaultSettings("Quota fixture"),
    legacy: false,
  };
}
const now = Date.parse("2026-10-03T20:00:00Z");
const admission = (
  link: ResolvedBookingLink,
  ipHash = crypto.randomUUID(),
  requestKey = crypto.randomUUID(),
  stamp = now,
  captchaHash: string | null = null,
) =>
  admitBookingRequest(env.DB, {
    link,
    requestKey,
    requestHash: "same-details",
    ipHash,
    captchaIdentityHash: captchaHash,
    now: stamp,
  });
it("atomically admits only the last remaining link budget request", async () => {
  const link = await linkFixture(1);
  const result = await Promise.allSettled([admission(link), admission(link)]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    result
      .filter((r) => r.status === "rejected")
      .map((r) => (r.status === "rejected" ? r.reason.status : null)),
  ).toEqual([429]);
});
it("enforces 25 link admissions per UTC day and rolls over at midnight", async () => {
  const link = await linkFixture();
  for (let i = 0; i < 25; i++) await admission(link);
  await expect(admission(link)).rejects.toMatchObject({ status: 429 });
  await expect(
    admission(
      link,
      crypto.randomUUID(),
      crypto.randomUUID(),
      Date.parse("2026-10-04T00:00:00Z"),
    ),
  ).resolves.toHaveProperty("receiptId");
});
it("enforces 20 daily IP admissions across links and tenants", async () => {
  const a = await linkFixture(),
    b = await linkFixture(),
    ip = crypto.randomUUID();
  for (let i = 0; i < 20; i++) await admission(i % 2 ? a : b, ip);
  await expect(admission(a, ip)).rejects.toMatchObject({ status: 429 });
});
it("enforces 1000 daily tenant admissions across links", async () => {
  const link = await linkFixture(1000);
  await env.DB.batch(
    Array.from({ length: 999 }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO tenant_booking_request_receipts(id,link_id,tenant_id,request_key,request_hash,ip_hash,day,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        link.id,
        link.tenantId,
        crypto.randomUUID(),
        "details",
        `ip-${i}`,
        "2026-10-03",
        "now",
      ),
    ),
  );
  await admission(link);
  const otherId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO tenant_booking_public_links(id,tenant_id,token,scope_kind) VALUES(?,?,?,'team')",
  )
    .bind(otherId, link.tenantId, otherId)
    .run();
  await expect(
    admission({ ...link, id: otherId, publicToken: otherId, dailyLimit: 25 }),
  ).rejects.toMatchObject({ status: 429 });
});
it("reuses a receipt for identical retries and rejects changed details and reused proof", async () => {
  const link = await linkFixture(),
    key = crypto.randomUUID(),
    proof = crypto.randomUUID();
  const receipt = await admission(link, "ip", key, now, proof);
  expect(await admission(link, "ip", key, now, proof)).toEqual({
    ...receipt,
    replay: true,
  });
  await expect(
    admitBookingRequest(env.DB, {
      link,
      requestKey: key,
      requestHash: "changed-details",
      ipHash: "ip",
      captchaIdentityHash: proof,
      now,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    admission(link, "another-ip", crypto.randomUUID(), now, proof),
  ).rejects.toMatchObject({ status: 403 });
});
