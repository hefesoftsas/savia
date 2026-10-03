import { databaseConflict } from "@savia/db/errors";
import { HTTPException } from "hono/http-exception";
import type { ResolvedBookingLink } from "./contracts";
export type BookingReceipt = {
  id: string;
  request_hash: string;
  captcha_hash: string | null;
};
export async function findBookingAdmission(
  db: D1Database,
  requestKey: string,
  requestHash: string,
) {
  const receipt = await db
    .prepare(
      "SELECT id,request_hash,captcha_hash FROM tenant_booking_request_receipts WHERE request_key=?",
    )
    .bind(requestKey)
    .first<BookingReceipt>();
  if (receipt && receipt.request_hash !== requestHash)
    throw new HTTPException(409, {
      message: "This request key was already used for different details.",
    });
  return receipt;
}
/** One conditional insert reserves all daily budgets and consumes the proof. */
export async function admitBookingRequest(
  db: D1Database,
  input: {
    link: ResolvedBookingLink;
    requestKey: string;
    requestHash: string;
    ipHash: string;
    captchaIdentityHash: string | null;
    now: number;
  },
): Promise<{ receiptId: string; replay: boolean }> {
  const existing = await findBookingAdmission(
    db,
    input.requestKey,
    input.requestHash,
  );
  if (existing) return { receiptId: existing.id, replay: true };
  const { link, requestKey, requestHash, ipHash, captchaIdentityHash } = input;
  const stamp = new Date(input.now).toISOString(),
    day = stamp.slice(0, 10),
    id = crypto.randomUUID();
  const statement = db
    .prepare(
      `INSERT INTO tenant_booking_request_receipts(id,link_id,tenant_id,request_key,request_hash,ip_hash,day,captcha_hash,created_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE
    EXISTS(SELECT 1 FROM tenant_booking_public_links l JOIN tenants t ON t.id=l.tenant_id WHERE l.id=? AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at>?) AND t.is_active=1)
    AND (SELECT count(*) FROM tenant_booking_request_receipts WHERE link_id=? AND day=?)<?
    AND (SELECT count(*) FROM tenant_booking_request_receipts WHERE tenant_id=? AND day=?)<1000
    AND (SELECT count(*) FROM tenant_booking_request_receipts WHERE ip_hash=? AND day=?)<20
    ON CONFLICT DO NOTHING RETURNING id`,
    )
    .bind(
      id,
      link.id,
      link.tenantId,
      requestKey,
      requestHash,
      ipHash,
      day,
      captchaIdentityHash,
      stamp,
      link.id,
      stamp,
      link.id,
      day,
      link.dailyLimit,
      link.tenantId,
      day,
      ipHash,
      day,
    );
  let inserted: { id: string } | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const result = await db.batch<{ id: string }>([statement]);
      inserted = result[0].results[0];
      break;
    } catch (error) {
      if (!databaseConflict(error)) throw error;
      if (attempt === 7)
        throw new HTTPException(409, {
          message: "Booking requests are busy. Retry the same request.",
        });
    }
  }
  if (inserted) return { receiptId: inserted.id, replay: false };
  const replay = await findBookingAdmission(db, requestKey, requestHash);
  if (replay) return { receiptId: replay.id, replay: true };
  if (
    captchaIdentityHash &&
    (await db
      .prepare(
        "SELECT 1 FROM tenant_booking_request_receipts WHERE captcha_hash=?",
      )
      .bind(captchaIdentityHash)
      .first())
  )
    throw new HTTPException(403, {
      message: "Verification was already used. Complete a new challenge.",
    });
  const active = await db
    .prepare(
      "SELECT 1 FROM tenant_booking_public_links WHERE id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)",
    )
    .bind(link.id, stamp)
    .first();
  if (!active)
    throw new HTTPException(404, { message: "Booking page unavailable." });
  throw new HTTPException(429, {
    message: "The daily booking limit was reached. Try again tomorrow.",
  });
}

/** Keep admission retries for seven days; bound each scheduled cleanup pass. */
export async function cleanupBookingAdmissions(db: D1Database, now: number) {
  const cutoff = new Date(now - 7 * 86400000).toISOString();
  await db
    .prepare(
      "DELETE FROM tenant_booking_request_receipts WHERE id IN (SELECT id FROM tenant_booking_request_receipts WHERE created_at<? ORDER BY created_at,id LIMIT 500)",
    )
    .bind(cutoff)
    .run();
}
