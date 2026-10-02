import type { AppActor } from "../auth/types";
import { PagesError, PagesService } from "./service";

export type PublicPageLink = {
  id: string;
  path: string;
  shortUrl: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

type LinkRow = {
  id: string;
  page_id: string;
  tenant_id: number;
  token: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  short_url?: string | null;
};

type PublicPageRow = {
  id: string;
  tenant_id: number;
  owner_id: string;
  parent_id: string | null;
  root_id: string;
  title: string;
  kind: "page" | "folder";
  content_json: string;
  updated_at: string;
};

const unavailable = () =>
  new PagesError(404, "PAGE_NOT_FOUND", "Page not found");
const timestamp = () => new Date().toISOString();
const makeToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};
const makeShortCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};
const publicLink = (row: LinkRow): PublicPageLink => ({
  id: row.id,
  path: `/public/pages/${row.token}`,
  shortUrl: row.short_url ?? null,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
});

async function requireOwner(db: D1Database, actor: AppActor, pageId: string) {
  const document = await new PagesService(db, actor).get(pageId);
  if (document.ownerId !== actor.principal.id) throw unavailable();
  return document;
}

export async function listPublicPageLinks(
  db: D1Database,
  actor: AppActor,
  pageId: string,
): Promise<PublicPageLink[]> {
  await requireOwner(db, actor, pageId);
  const rows = await db
    .prepare(
      "SELECT id,page_id,tenant_id,token,created_by,created_at,expires_at,revoked_at,short_url FROM page_public_links WHERE page_id=? ORDER BY created_at DESC",
    )
    .bind(pageId)
    .all<LinkRow>();
  return (rows.results ?? []).map(publicLink);
}

export async function createPublicPageLink(
  db: D1Database,
  actor: AppActor,
  pageId: string,
  expiresAt?: string | null,
): Promise<PublicPageLink> {
  await requireOwner(db, actor, pageId);
  let normalizedExpiry = expiresAt ?? null;
  if (expiresAt !== undefined && expiresAt !== null) {
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now())
      throw new PagesError(
        400,
        "INVALID_EXPIRY",
        "Expiry must be a future date",
      );
    normalizedExpiry = new Date(expiry).toISOString();
  }
  const pageTenant = await db
    .prepare("SELECT tenant_id FROM pages WHERE id=?")
    .bind(pageId)
    .first<{ tenant_id: number }>();
  if (!pageTenant) throw unavailable();
  const id = crypto.randomUUID();
  const createdAt = timestamp();
  let inserted: LinkRow | null = null;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    const token = makeToken();
    try {
      await db
        .prepare(
          `INSERT INTO page_public_links (id,page_id,tenant_id,token,created_by,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          pageId,
          pageTenant.tenant_id,
          token,
          actor.principal.id,
          createdAt,
          normalizedExpiry,
        )
        .run();
      inserted = {
        id,
        page_id: pageId,
        tenant_id: pageTenant.tenant_id,
        token,
        created_by: actor.principal.id,
        created_at: createdAt,
        expires_at: normalizedExpiry,
        revoked_at: null,
      };
    } catch (error) {
      if (attempt === 4) throw error;
    }
  }
  return publicLink(inserted!);
}

export async function revokePublicPageLink(
  db: D1Database,
  actor: AppActor,
  pageId: string,
  linkId: string,
): Promise<PublicPageLink> {
  await requireOwner(db, actor, pageId);
  const row = await db
    .prepare(
      "SELECT id,page_id,tenant_id,token,created_by,created_at,expires_at,revoked_at FROM page_public_links WHERE id=? AND page_id=?",
    )
    .bind(linkId, pageId)
    .first<LinkRow>();
  if (!row) throw unavailable();
  if (!row.revoked_at) {
    row.revoked_at = timestamp();
    await db
      .prepare(
        "UPDATE page_public_links SET revoked_at=? WHERE id=? AND page_id=? AND revoked_at IS NULL",
      )
      .bind(row.revoked_at, linkId, pageId)
      .run();
  }
  return publicLink(row);
}

export async function createPublicPageShortUrl(
  db: D1Database,
  actor: AppActor,
  pageId: string,
  linkId: string,
  options: {
    publicOrigin?: string;
    requestUrl: string;
    shortener?: { shorten(destination: string): Promise<string> };
  },
): Promise<string> {
  await requireOwner(db, actor, pageId);
  const now = timestamp();
  const row = await db
    .prepare(
      "SELECT id,page_id,tenant_id,token,created_by,created_at,expires_at,revoked_at,short_url FROM page_public_links WHERE id=? AND page_id=?",
    )
    .bind(linkId, pageId)
    .first<LinkRow>();
  if (
    !row ||
    row.revoked_at !== null ||
    (row.expires_at !== null && row.expires_at <= now)
  )
    throw unavailable();
  if (row.short_url) return row.short_url;

  if (options.shortener) {
    const destination = new URL(
      `/public/pages/${row.token}`,
      options.publicOrigin ?? options.requestUrl,
    ).href;
    try {
      const shortUrl = await options.shortener.shorten(destination);
      await db
        .prepare(
          "UPDATE page_public_links SET short_url=? WHERE id=? AND short_url IS NULL",
        )
        .bind(shortUrl, linkId)
        .run();
      const stored = await db
        .prepare("SELECT short_url FROM page_public_links WHERE id=?")
        .bind(linkId)
        .first<{ short_url: string | null }>();
      if (stored?.short_url) return stored.short_url;
    } catch {
      // A provider outage falls through to the Savia-hosted code.
    }
  }

  let shortLink = await db
    .prepare("SELECT code FROM page_public_short_links WHERE link_id=?")
    .bind(linkId)
    .first<{ code: string }>();
  for (let attempt = 0; !shortLink && attempt < 8; attempt++) {
    const code = makeShortCode();
    const inserted = await db
      .prepare(
        "INSERT INTO page_public_short_links(code,link_id,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING",
      )
      .bind(code, linkId, now)
      .run();
    if (inserted.meta.changes > 0) shortLink = { code };
    else
      shortLink = await db
        .prepare("SELECT code FROM page_public_short_links WHERE link_id=?")
        .bind(linkId)
        .first<{ code: string }>();
  }
  if (!shortLink)
    throw new PagesError(
      503,
      "SHORT_URL_UNAVAILABLE",
      "Could not create a short URL",
    );
  const shortUrl = new URL(
    `/s/p/${shortLink.code}`,
    options.publicOrigin ?? options.requestUrl,
  ).href;
  await db
    .prepare(
      "UPDATE page_public_links SET short_url=? WHERE id=? AND short_url IS NULL",
    )
    .bind(shortUrl, linkId)
    .run();
  const stored = await db
    .prepare("SELECT short_url FROM page_public_links WHERE id=?")
    .bind(linkId)
    .first<{ short_url: string | null }>();
  return stored?.short_url ?? shortUrl;
}

export async function publicPageTokenForShortCode(
  db: D1Database,
  code: string,
): Promise<string> {
  if (!/^[a-f0-9]{24}$/.test(code)) throw unavailable();
  const row = await db
    .prepare(
      "SELECT l.token FROM page_public_short_links s JOIN page_public_links l ON l.id=s.link_id WHERE s.code=?",
    )
    .bind(code)
    .first<{ token: string }>();
  if (!row) throw unavailable();
  const link = await currentLink(db, row.token);
  return link.token;
}

async function currentLink(db: D1Database, token: string): Promise<LinkRow> {
  if (!/^[a-f0-9]{64}$/.test(token)) throw unavailable();
  const now = timestamp();
  const row = await db
    .prepare(
      `SELECT l.id,l.page_id,l.tenant_id,l.token,l.created_by,l.created_at,l.expires_at,l.revoked_at
    FROM page_public_links l
    JOIN identity_principal p ON p.id=l.created_by AND p.is_active=1
    WHERE l.token=? AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at>?)
      AND ((l.tenant_id=0 AND (NOT EXISTS (SELECT 1 FROM identity_tenant_membership m WHERE m.principal_id=l.created_by AND m.is_active=1)
        OR EXISTS (SELECT 1 FROM identity_tenant_membership m JOIN tenants mt ON mt.id=m.tenant_id AND mt.is_active=1 WHERE m.principal_id=l.created_by AND m.tenant_id=0 AND m.is_active=1)))
        OR (l.tenant_id<>0 AND EXISTS (SELECT 1 FROM identity_tenant_membership m JOIN tenants mt ON mt.id=m.tenant_id AND mt.is_active=1 WHERE m.principal_id=l.created_by AND m.tenant_id=l.tenant_id AND m.is_active=1)))`,
    )
    .bind(token, now)
    .first<LinkRow>();
  if (!row) throw unavailable();
  return row;
}

async function grantedPage(
  db: D1Database,
  link: LinkRow,
  pageId: string,
): Promise<{ grant: PublicPageRow; page: PublicPageRow }> {
  const grant = await db
    .prepare(
      "SELECT id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,updated_at FROM pages WHERE id=? AND tenant_id=?",
    )
    .bind(link.page_id, link.tenant_id)
    .first<PublicPageRow>();
  if (!grant) throw unavailable();
  if (grant.owner_id !== link.created_by) throw unavailable();
  let page = await db
    .prepare(
      "SELECT id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,updated_at FROM pages WHERE id=? AND tenant_id=? AND root_id=?",
    )
    .bind(pageId, link.tenant_id, grant.root_id)
    .first<PublicPageRow>();
  if (!page) throw unavailable();
  let cursor: PublicPageRow | null = page;
  for (let depth = 0; cursor && depth < 1024; depth++) {
    if (cursor.id === grant.id) return { grant, page };
    if (!cursor.parent_id) break;
    cursor = await db
      .prepare(
        "SELECT id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,updated_at FROM pages WHERE id=? AND tenant_id=? AND root_id=?",
      )
      .bind(cursor.parent_id, link.tenant_id, grant.root_id)
      .first<PublicPageRow>();
  }
  throw unavailable();
}

function safeContent(raw: string) {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function getPublicPage(
  db: D1Database,
  token: string,
  pageId?: string,
) {
  const link = await currentLink(db, token);
  const { grant, page } = await grantedPage(db, link, pageId ?? link.page_id);
  const children = await db
    .prepare(
      "SELECT id,title,kind FROM pages WHERE parent_id=? AND tenant_id=? AND root_id=? ORDER BY updated_at DESC",
    )
    .bind(page.id, link.tenant_id, grant.root_id)
    .all<{ id: string; title: string; kind: "page" | "folder" }>();
  const reverseBreadcrumbs: { id: string; title: string }[] = [];
  let cursor: PublicPageRow | null = page;
  for (let depth = 0; cursor && depth < 1024; depth++) {
    reverseBreadcrumbs.push({ id: cursor.id, title: cursor.title });
    if (cursor.id === grant.id || !cursor.parent_id) break;
    cursor = await db
      .prepare(
        "SELECT id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,updated_at FROM pages WHERE id=? AND tenant_id=? AND root_id=?",
      )
      .bind(cursor.parent_id, link.tenant_id, grant.root_id)
      .first<PublicPageRow>();
  }
  return {
    root: { id: grant.id, title: grant.title },
    page: {
      id: page.id,
      title: page.title,
      kind: page.kind,
      content: safeContent(page.content_json),
      updatedAt: page.updated_at,
    },
    children: children.results ?? [],
    breadcrumbs: reverseBreadcrumbs.reverse(),
  };
}

function containsFile(value: unknown, fileId: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value))
    return value.some((child) => containsFile(child, fileId));
  const node = value as Record<string, unknown>;
  return (
    (node.type === "attachment" && node.fileId === fileId) ||
    containsFile(node.children, fileId)
  );
}

export async function getPublicPageFile(
  db: D1Database,
  token: string,
  pageId: string,
  fileId: string,
  documents?: R2Bucket,
): Promise<{
  object: R2ObjectBody;
  fileName: string;
  mimeType: string;
} | null> {
  const link = await currentLink(db, token);
  const { grant, page } = await grantedPage(db, link, pageId);
  if (!containsFile(safeContent(page.content_json), fileId))
    throw unavailable();
  const file = await db
    .prepare(
      `SELECT id,storage_key,file_name,mime_type FROM page_files
    WHERE id=? AND page_id=? AND root_id=? AND tenant_id=?`,
    )
    .bind(fileId, page.id, grant.root_id, link.tenant_id)
    .first<{
      id: string;
      storage_key: string;
      file_name: string;
      mime_type: string;
    }>();
  if (!file || !documents) throw unavailable();
  const object = await documents.get(file.storage_key);
  if (!object) throw unavailable();
  return { object, fileName: file.file_name, mimeType: file.mime_type };
}
