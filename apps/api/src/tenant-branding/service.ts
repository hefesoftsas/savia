import { dialectFor } from "@savia/db/dialect";
import {
  defaultTenantBranding,
  type TenantBrandingConfig,
} from "@savia/tenant-host/branding";
export type { TenantBrandingConfig } from "@savia/tenant-host/branding";
import { z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { parseTenantSlugFromHostname } from "@savia/tenant-host/tenant-host";
import type { AppActor } from "../auth/types";
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) => !/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value),
      "Use plain text only.",
    );
const assetUrl = z
  .string()
  .regex(/^\/api\/public\/tenant-branding\/assets\/[1-9][0-9]*\/[a-f0-9-]{36}$/)
  .nullable();
export const brandingSchema = z
  .object({
    displayName: text(120).refine((v) => v.length > 0),
    loginTitle: text(120).refine((v) => v.length > 0),
    loginDescription: text(600),
    primaryColor: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    accentColor: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    logoUrl: assetUrl,
    coverUrl: assetUrl,
    version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
type Tenant = { id: number; name: string };
export async function activeTenant(db: D1Database, id: number) {
  const tenant = await db
    .prepare(
      "SELECT id,name FROM tenants WHERE id=? AND kind='commercial' AND is_active=1",
    )
    .bind(id)
    .first<Tenant>();
  if (!tenant) throw new HTTPException(404, { message: "Tenant unavailable." });
  return tenant;
}
export async function authorizeBranding(
  db: D1Database,
  actor: AppActor,
  id: number,
  write = false,
) {
  const tenant = await activeTenant(db, id);
  const platform = actor.globalRoles.includes("platform_admin");
  const own = actor.memberships.filter(
    (m) => m.isActive && (m.tenantId ?? m.agencyId) === id,
  );
  const canManage =
    platform ||
    own.some((m) => ["tenant_admin", "agency_admin"].includes(m.role));
  if (
    !actor.principal.isActive ||
    (!platform && !own.length) ||
    (write && !canManage)
  )
    throw new HTTPException(403, { message: "Tenant branding access denied." });
  return { tenant, canManage };
}
export async function readTenantBranding(
  db: D1Database,
  tenant: Tenant,
): Promise<TenantBrandingConfig> {
  const row = await db
    .prepare("SELECT config,version FROM tenant_branding WHERE tenant_id=?")
    .bind(tenant.id)
    .first<{ config: string; version: number }>();
  if (!row) return defaultTenantBranding(tenant.name);
  const value = JSON.parse(row.config);
  return brandingSchema.parse({ ...value, version: row.version });
}
export async function readTenantBrandingForRequest(
  db: D1Database,
  request: Request,
  canonicalHost?: string,
): Promise<TenantBrandingConfig | null> {
  const slug = parseTenantSlugFromHostname(
    new URL(request.url).hostname,
    canonicalHost,
  );
  if (!slug) return null;
  const tenant = await db
    .prepare(
      "SELECT id,name FROM tenants WHERE id_slug=? AND kind='commercial' AND is_active=1",
    )
    .bind(slug)
    .first<Tenant>();
  return tenant ? readTenantBranding(db, tenant) : null;
}
export async function saveTenantBranding(
  db: D1Database,
  id: number,
  actor: AppActor,
  input: TenantBrandingConfig,
) {
  await authorizeBranding(db, actor, id, true);
  for (const [kind, url] of [
    ["logo", input.logoUrl],
    ["cover", input.coverUrl],
  ] as const) {
    if (url === null) continue;
    const prefix = "/api/public/tenant-branding/assets/" + id + "/";
    if (
      !url.startsWith(prefix) ||
      !(await db
        .prepare(
          "SELECT 1 FROM tenant_branding_assets WHERE state='live' AND tenant_id=? AND id=? AND kind=?",
        )
        .bind(id, url.slice(prefix.length), kind)
        .first())
    )
      throw new HTTPException(400, {
        message: "Select an image uploaded for this tenant.",
      });
  }
  const { version, ...config } = input;
  const row = await db
    .prepare(
      "INSERT INTO tenant_branding(tenant_id,config,version,updated_by,updated_at) SELECT ?,?,1,?,? WHERE (?=0 OR EXISTS(SELECT 1 FROM tenant_branding WHERE tenant_id=?)) AND (CAST(? AS TEXT) IS NULL OR EXISTS(SELECT 1 FROM tenant_branding_assets WHERE state='live' AND tenant_id=? AND kind='logo' AND ?='/api/public/tenant-branding/assets/'||tenant_id||'/'||id)) AND (CAST(? AS TEXT) IS NULL OR EXISTS(SELECT 1 FROM tenant_branding_assets WHERE state='live' AND tenant_id=? AND kind='cover' AND ?='/api/public/tenant-branding/assets/'||tenant_id||'/'||id)) ON CONFLICT(tenant_id) DO UPDATE SET config=excluded.config,version=tenant_branding.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at WHERE tenant_branding.version=? RETURNING version",
    )
    .bind(
      id,
      JSON.stringify(config),
      actor.principal.id,
      new Date().toISOString(),
      version,
      id,
      input.logoUrl,
      id,
      input.logoUrl,
      input.coverUrl,
      id,
      input.coverUrl,
      version,
    )
    .first<{ version: number }>();
  if (!row)
    throw new HTTPException(409, {
      message: "Branding changed. Reload before saving.",
    });
  return { ...config, version: row.version };
}
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
export function imageContentType(bytes: Uint8Array) {
  const starts = (signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  if (
    bytes.length >= 33 &&
    starts([137, 80, 78, 71, 13, 10, 26, 10]) &&
    String.fromCharCode(...bytes.slice(12, 16)) === "IHDR"
  )
    return "image/png";
  if (
    bytes.length >= 4 &&
    starts([255, 216, 255]) &&
    bytes[bytes.length - 2] === 255 &&
    bytes[bytes.length - 1] === 217
  )
    return "image/jpeg";
  if (
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(
      String.fromCharCode(...bytes.slice(12, 16)),
    ) &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      4,
      true,
    ) +
      8 ===
      bytes.length
  )
    return "image/webp";
  throw new HTTPException(400, {
    message: "Upload a PNG, JPEG, or WebP image.",
  });
}
export async function uploadBrandingAsset(
  db: D1Database,
  bucket: R2Bucket | undefined,
  id: number,
  kind: "logo" | "cover",
  actor: AppActor,
  file: File,
) {
  await authorizeBranding(db, actor, id, true);
  if (!bucket)
    throw new HTTPException(503, { message: "Image storage unavailable." });
  if (file.size === 0 || file.size > MAX_ASSET_BYTES)
    throw new HTTPException(413, {
      message: "Images must be no larger than 2 MB.",
    });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = imageContentType(bytes),
    assetId = crypto.randomUUID(),
    key = "tenant-branding/" + id + "/" + assetId;
  // Tombstones retain their storage slot until R2 deletion succeeds. Claiming
  // stale assets atomically excludes current references and makes concurrent
  // saves fail their live-asset check rather than publish an image being deleted.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      "UPDATE tenant_branding_assets SET state='deleting' WHERE tenant_id=? AND state IN ('live','uploading') AND created_at<? AND NOT EXISTS(SELECT 1 FROM tenant_branding b WHERE b.tenant_id=tenant_branding_assets.tenant_id AND (" +
        dialectFor(db).jsonValue("b.config", "$.logoUrl") +
        "='/api/public/tenant-branding/assets/'||tenant_branding_assets.tenant_id||'/'||tenant_branding_assets.id OR " +
        dialectFor(db).jsonValue("b.config", "$.coverUrl") +
        "='/api/public/tenant-branding/assets/'||tenant_branding_assets.tenant_id||'/'||tenant_branding_assets.id))",
    )
    .bind(id, cutoff)
    .run();
  const stale = await db
    .prepare(
      "SELECT id,object_key FROM tenant_branding_assets WHERE tenant_id=? AND state='deleting' LIMIT 20",
    )
    .bind(id)
    .all<{ id: string; object_key: string }>();
  if (stale.results.length) {
    await bucket.delete(stale.results.map((row) => row.object_key));
    await db.batch(
      stale.results.map((row) =>
        db
          .prepare(
            "DELETE FROM tenant_branding_assets WHERE id=? AND tenant_id=? AND state='deleting'",
          )
          .bind(row.id, id),
      ),
    );
  }
  const reserved = await db
    .prepare(
      `INSERT INTO tenant_branding_assets(id,tenant_id,kind,object_key,content_type,size,created_by,created_at,state) SELECT ?,?,?,?,?,?,?,?,'uploading' WHERE (SELECT count(*) FROM tenant_branding_assets WHERE tenant_id=?)<20 AND EXISTS(SELECT 1 FROM tenants WHERE id=? AND is_active=1 AND kind='commercial') RETURNING id`,
    )
    .bind(
      assetId,
      id,
      kind,
      key,
      contentType,
      bytes.length,
      actor.principal.id,
      new Date().toISOString(),
      id,
      id,
    )
    .first();
  if (!reserved)
    throw new HTTPException(429, {
      message:
        "Image storage limit reached. Unused uploads are released after 24 hours.",
    });
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType } });
    await db
      .prepare(
        "UPDATE tenant_branding_assets SET state='live' WHERE id=? AND state='uploading'",
      )
      .bind(assetId)
      .run();
  } catch {
    await db
      .prepare("UPDATE tenant_branding_assets SET state='deleting' WHERE id=?")
      .bind(assetId)
      .run();
    throw new HTTPException(503, { message: "Image storage unavailable." });
  }
  return { url: "/api/public/tenant-branding/assets/" + id + "/" + assetId };
}
/** Called only by the authorized tenant deletion flow, before deleting its DB row. */
export async function deleteTenantBrandingAssets(
  db: D1Database,
  bucket: R2Bucket | undefined,
  id: number,
) {
  const pending = await db
    .prepare("SELECT count(*) n FROM tenant_branding_assets WHERE tenant_id=?")
    .bind(id)
    .first<number>("n");
  if (pending && !bucket)
    throw new HTTPException(503, {
      message: "Image storage cleanup unavailable.",
    });
  // Deactivate and check uploads in the same statement. Upload reservations also
  // check active status atomically, closing the delete-versus-upload race.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const locked = await db
    .prepare(
      "UPDATE tenants SET is_active=0 WHERE id=? AND NOT EXISTS(SELECT 1 FROM tenant_branding_assets WHERE tenant_id=? AND state='uploading' AND created_at>=?) RETURNING id",
    )
    .bind(id, id, cutoff)
    .first();
  if (!locked)
    throw new HTTPException(409, {
      message: "An image upload is in progress. Retry tenant deletion shortly.",
    });
  await db
    .prepare(
      "UPDATE tenant_branding_assets SET state='deleting' WHERE tenant_id=?",
    )
    .bind(id)
    .run();
  const assets = await db
    .prepare("SELECT object_key FROM tenant_branding_assets WHERE tenant_id=?")
    .bind(id)
    .all<{ object_key: string }>();
  if (assets.results.length) {
    try {
      await bucket!.delete(assets.results.map((row) => row.object_key));
    } catch {
      throw new HTTPException(503, {
        message: "Image cleanup failed. Retry tenant deletion.",
      });
    }
  }
  await db
    .prepare(
      "DELETE FROM tenant_branding_assets WHERE tenant_id=? AND state='deleting'",
    )
    .bind(id)
    .run();
}
