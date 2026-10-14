import {
  publicQuoteReportSchema,
  type PublicQuoteReport,
} from "@savia/studio-shared/public-quote";
import {
  createPublicLinkToken,
  isPublicLinkActive,
  isPublicLinkToken,
  publicLinkExpiresAt,
  publicLinkUrl,
  revokePublicLink as revokeLink,
} from "../public-links/lifecycle";

const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

type QuoteLinkRow = {
  id: string;
  tenant_id: number;
  action_id: string;
  quote_id: string;
  token: string;
  report_json: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};
type QuoteLinkSummaryRow = Pick<
  QuoteLinkRow,
  "id" | "quote_id" | "token" | "created_at" | "expires_at" | "revoked_at"
>;

export type PublicQuoteLink = {
  id: string;
  quoteId: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type PublishedQuoteReport = {
  id: string;
  url: string;
  expiresAt: string;
};

function view(row: QuoteLinkSummaryRow, publicOrigin: string): PublicQuoteLink {
  return {
    id: row.id,
    quoteId: row.quote_id,
    url: publicLinkUrl(publicOrigin, `/public/quotes/${row.token}`),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export async function publishQuoteReport(
  db: D1Database,
  input: {
    tenantId: number;
    actionId: string;
    quoteId: string;
    createdBy: string;
    report: PublicQuoteReport;
    publicOrigin: string;
  },
): Promise<PublishedQuoteReport> {
  if (!Number.isSafeInteger(input.tenantId) || input.tenantId <= 0)
    throw new Error("Invalid tenant id");
  if (
    !input.actionId.trim() ||
    input.actionId.length > 200 ||
    !input.quoteId.trim() ||
    input.quoteId.length > 200 ||
    !input.createdBy.trim() ||
    input.createdBy.length > 200
  )
    throw new Error("Quote link identifiers are required");
  publicLinkUrl(input.publicOrigin, `/public/quotes/${"0".repeat(64)}`);
  const report = publicQuoteReportSchema.parse(input.report);
  const tenant = await db
    .prepare(
      "SELECT id FROM tenants WHERE id=? AND kind='commercial' AND is_active=1",
    )
    .bind(input.tenantId)
    .first();
  if (!tenant) throw new Error("An active commercial tenant is required");
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = publicLinkExpiresAt(now, LINK_LIFETIME_MS);
  const id = crypto.randomUUID();
  const token = createPublicLinkToken();

  await db
    .prepare(
      `INSERT INTO public_quote_links
        (id,tenant_id,action_id,quote_id,token,report_json,created_by,created_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(tenant_id,action_id) DO NOTHING`,
    )
    .bind(
      id,
      input.tenantId,
      input.actionId,
      input.quoteId,
      token,
      JSON.stringify(report),
      input.createdBy,
      createdAt,
      expiresAt,
    )
    .run();

  const row = await db
    .prepare(
      `SELECT id,tenant_id,action_id,quote_id,token,report_json,created_by,created_at,expires_at,revoked_at
       FROM public_quote_links WHERE tenant_id=? AND action_id=?`,
    )
    .bind(input.tenantId, input.actionId)
    .first<QuoteLinkRow>();
  if (!row) throw new Error("Quote link could not be published");
  return {
    id: row.id,
    url: publicLinkUrl(input.publicOrigin, `/public/quotes/${row.token}`),
    expiresAt: row.expires_at,
  };
}

export async function readPublicQuoteReport(
  db: D1Database,
  token: string,
  now = new Date().toISOString(),
): Promise<{ report: PublicQuoteReport; expiresAt: string } | null> {
  if (!isPublicLinkToken(token)) return null;
  const row = await db
    .prepare(
      `SELECT report_json,expires_at,revoked_at FROM public_quote_links
       WHERE token=?`,
    )
    .bind(token)
    .first<{
      report_json: string;
      expires_at: string;
      revoked_at: string | null;
    }>();
  if (
    !row ||
    !isPublicLinkActive(row.expires_at, row.revoked_at, Date.parse(now))
  )
    return null;
  try {
    return {
      report: publicQuoteReportSchema.parse(JSON.parse(row.report_json)),
      expiresAt: row.expires_at,
    };
  } catch {
    return null;
  }
}

export async function listQuoteLinks(
  db: D1Database,
  tenantId: number,
  publicOrigin: string,
  quoteId?: string,
): Promise<PublicQuoteLink[]> {
  const query = quoteId
    ? `SELECT id,quote_id,token,created_at,expires_at,revoked_at
       FROM public_quote_links WHERE tenant_id=? AND quote_id=? ORDER BY created_at DESC LIMIT 100`
    : `SELECT id,quote_id,token,created_at,expires_at,revoked_at
       FROM public_quote_links WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100`;
  const statement = db
    .prepare(query)
    .bind(...(quoteId ? [tenantId, quoteId] : [tenantId]));
  const rows = await statement.all<QuoteLinkSummaryRow>();
  return (rows.results ?? []).map((row) => view(row, publicOrigin));
}

export async function revokeQuoteLink(
  db: D1Database,
  tenantId: number,
  id: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  return revokeLink(db, { type: "quote", id, tenantId }, now);
}
