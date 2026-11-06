import { HTTPException } from "hono/http-exception";
import { candidates, publishedSettings, readSettings } from "./repository";
import type { BookingLinkScope, ResolvedBookingLink } from "./contracts";

export type BookingLinkRow = {
  id: string;
  tenant_id: number;
  created_by: string | null;
  token: string;
  scope_kind: "team" | "professional";
  professional_id: string | null;
  service_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  daily_limit: number;
  version: number;
  legacy: number;
  deleted_at?: string | null;
  short_code?: string | null;
  short_url?: string | null;
};
const unavailable = () =>
  new HTTPException(404, { message: "Booking page unavailable." });
export const linkScope = (row: BookingLinkRow): BookingLinkScope =>
  row.scope_kind === "professional"
    ? { kind: "professional", professionalId: row.professional_id! }
    : { kind: "team" };
/** New settings still get a compatible tenant-wide link; revoked links never resurrect. */
export async function ensureLegacyBookingLink(
  db: D1Database,
  tenantId: number,
) {
  await db
    .prepare(
      "INSERT INTO tenant_booking_public_links(id,tenant_id,token,scope_kind,legacy) SELECT public_token,tenant_id,public_token,'team',1 FROM tenant_booking_settings WHERE tenant_id=? AND NOT EXISTS (SELECT 1 FROM tenant_booking_public_links WHERE token=tenant_booking_settings.public_token) ON CONFLICT(token) DO NOTHING",
    )
    .bind(tenantId)
    .run();
}
export async function resolveBookingLink(
  db: D1Database,
  token: string,
  now = Date.now(),
): Promise<ResolvedBookingLink> {
  let row = await db
    .prepare("SELECT * FROM tenant_booking_public_links WHERE token=?")
    .bind(token)
    .first<BookingLinkRow>();
  if (!row) {
    const legacy = await publishedSettings(db, token);
    await ensureLegacyBookingLink(db, legacy.tenantId);
    row = await db
      .prepare("SELECT * FROM tenant_booking_public_links WHERE token=?")
      .bind(token)
      .first<BookingLinkRow>();
  }
  if (
    !row ||
    row.deleted_at ||
    row.revoked_at ||
    (row.expires_at && Date.parse(row.expires_at) <= now)
  )
    throw unavailable();
  const active = await db
    .prepare(
      "SELECT 1 FROM tenants WHERE id=? AND kind='commercial' AND is_active=1",
    )
    .bind(row.tenant_id)
    .first();
  const { settings } = await readSettings(db, row.tenant_id);
  if (!active || !settings.enabled || !settings.published) throw unavailable();
  const eligible = await candidates(db, row.tenant_id);
  const professionals = settings.professionals.filter(
    (p) =>
      p.enabled &&
      eligible.some((e) => e.principalId === p.principalId) &&
      (row.scope_kind === "team" || p.id === row.professional_id),
  );
  const services = settings.services
    .filter(
      (s) =>
        s.enabled &&
        (!row.service_id || s.id === row.service_id) &&
        s.professionalIds.some((id) => professionals.some((p) => p.id === id)),
    )
    .map((s) => ({
      ...s,
      professionalIds: s.professionalIds.filter((id) =>
        professionals.some((p) => p.id === id),
      ),
    }));
  if (!professionals.length || !services.length) throw unavailable();
  return {
    id: row.id,
    tenantId: row.tenant_id,
    publicToken: row.token,
    scope: linkScope(row),
    serviceId: row.service_id,
    dailyLimit: row.daily_limit,
    settings: { ...settings, professionals, services },
    legacy: !!row.legacy,
  };
}
export function assertBookingLinkSelection(
  link: ResolvedBookingLink,
  serviceId: string,
  professionalId?: string,
) {
  if (link.serviceId && serviceId !== link.serviceId) throw unavailable();
  const service = link.settings.services.find(
    (s) => s.id === serviceId && s.enabled,
  );
  const fixed =
    link.scope.kind === "professional" ? link.scope.professionalId : undefined;
  if (fixed && professionalId && professionalId !== fixed) throw unavailable();
  const eligible = link.settings.professionals.filter(
    (p) => p.enabled && service?.professionalIds.includes(p.id),
  );
  const selected =
    fixed ??
    professionalId ??
    (eligible.length === 1 ? eligible[0].id : undefined);
  if (!service || !selected || !eligible.some((p) => p.id === selected))
    throw unavailable();
  return { serviceId, professionalId: selected };
}
export function bookingLinkView(row: BookingLinkRow, publicOrigin: string) {
  return {
    id: row.id,
    scope: linkScope(row),
    serviceId: row.service_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    dailyLimit: row.daily_limit,
    version: row.version,
    publicUrl: new URL(
      `/public/bookings/${row.token}`,
      publicOrigin,
    ).toString(),
    ...(row.short_url
      ? { shortUrl: row.short_url }
      : row.short_code
        ? {
            shortUrl: new URL(
              `/s/b/${row.short_code}`,
              publicOrigin,
            ).toString(),
          }
        : {}),
  };
}
export function bookingShortCode() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 16);
}
export function bookingLinkToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
