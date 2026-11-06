/** Shared primitives for bearer links that expose public Savia content. */
export type PublicLinkScope =
  | { type: "form"; id: string }
  | { type: "quote"; id: string; tenantId: number }
  | { type: "page"; id: string; pageId: string };
export type ShortenedLinkScope = { type: "form" | "page"; id: string };

export function createPublicLinkToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function isPublicLinkToken(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

/** Convert supported offset timestamps to the canonical UTC form used in DB comparisons. */
export function normalizePublicLinkExpiry(
  value: string | null | undefined,
  now = Date.now(),
): string | null {
  if (value === undefined || value === null) return null;
  const expiry = Date.parse(value);
  if (!Number.isFinite(expiry) || expiry <= now)
    throw new RangeError("Expiry must be a future date");
  return new Date(expiry).toISOString();
}

export function publicLinkExpiresAt(
  createdAt: Date,
  lifetimeMs: number,
): string {
  if (!Number.isFinite(createdAt.getTime()) || lifetimeMs <= 0)
    throw new RangeError(
      "A valid creation time and positive lifetime are required",
    );
  return new Date(createdAt.getTime() + lifetimeMs).toISOString();
}

export function isPublicLinkActive(
  expiresAt: string | null,
  revokedAt: string | null,
  now = Date.now(),
): boolean {
  if (revokedAt !== null) return false;
  if (expiresAt === null) return true;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}

/** Build a canonical link only from an origin, never a credential-bearing URL or redirect path. */
export function publicLinkUrl(publicOrigin: string, path: string): string {
  let origin: URL;
  try {
    origin = new URL(publicOrigin);
  } catch {
    throw new Error("A valid public origin is required");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    (origin.pathname !== "/" && origin.pathname !== "") ||
    origin.search ||
    origin.hash ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    new URL(path, origin).origin !== origin.origin
  )
    throw new Error("A valid public origin and path are required");
  return new URL(path, origin).href;
}

/** Persist one canonical short URL and return the concurrent winner if present. */
export async function persistPublicLinkShortUrl(
  db: D1Database,
  scope: ShortenedLinkScope,
  shortUrl: string,
): Promise<string> {
  const table = scope.type === "form" ? "public_forms" : "page_public_links";
  await db
    .prepare(`UPDATE ${table} SET short_url=? WHERE id=? AND short_url IS NULL`)
    .bind(shortUrl, scope.id)
    .run();
  const row = await db
    .prepare(`SELECT short_url FROM ${table} WHERE id=?`)
    .bind(scope.id)
    .first<{ short_url: string | null }>();
  return row?.short_url ?? shortUrl;
}

/** Shared idempotent revocation for form, quote-report, and page grants. */
export async function revokePublicLink(
  db: D1Database,
  scope: PublicLinkScope,
  revokedAt = new Date().toISOString(),
): Promise<boolean> {
  const statement =
    scope.type === "form"
      ? db
          .prepare(
            "UPDATE public_forms SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
          )
          .bind(revokedAt, scope.id)
      : scope.type === "quote"
        ? db
            .prepare(
              "UPDATE public_quote_links SET revoked_at=? WHERE id=? AND tenant_id=? AND revoked_at IS NULL",
            )
            .bind(revokedAt, scope.id, scope.tenantId)
        : db
            .prepare(
              "UPDATE page_public_links SET revoked_at=? WHERE id=? AND page_id=? AND revoked_at IS NULL",
            )
            .bind(revokedAt, scope.id, scope.pageId);
  const result = await statement.run();
  return (result.meta.changes ?? 0) > 0;
}
