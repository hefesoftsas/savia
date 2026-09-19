import { z } from "@hono/zod-openapi";
import type { AccessScope } from "@savia/crm-shared/access-control";
import type { AppActor } from "./types";
import { accessAuthority } from "./access-context";
import { AccessControlError } from "./access-registry";

const identifier = z.string().min(1).max(256);
const timestamp = z.iso.datetime().max(32);
export const auditQuerySchema = z
  .object({
    scope: z.string(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(16384).optional(),
    action: z
      .enum(["role.saved", "role.deleted", "assignments.saved"])
      .optional(),
    actorId: identifier.optional(),
    targetId: identifier.optional(),
    from: timestamp.optional(),
    to: timestamp.optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), {
    message: "From must not be later than to.",
  });
export const auditEntrySchema = z.object({
  id: z.string(),
  scope: z.string(),
  actor: z.object({ id: z.string(), displayName: z.string() }),
  action: z.string(),
  targetId: z.string(),
  createdAt: z.string(),
});
export const auditDetailSchema = auditEntrySchema.extend({
  before: z.unknown().nonoptional(),
  after: z.unknown().nonoptional(),
});
type Filters = z.infer<typeof auditQuerySchema>;
type AuditRow = {
  id: string;
  scope: string;
  actor_id: string;
  display_name: string | null;
  action: string;
  target_id: string;
  created_at: string;
  before_state: string | null;
  after_state: string | null;
};
const columns =
  "a.id,a.scope,a.actor_id,p.display_name,a.action,a.target_id,a.created_at";
const source =
  " FROM access_audit a LEFT JOIN identity_principal p ON p.id=a.actor_id";
const summary = (r: AuditRow) => ({
  id: r.id,
  scope: r.scope,
  actor: { id: r.actor_id, displayName: r.display_name || r.actor_id },
  action: r.action,
  targetId: r.target_id,
  createdAt: r.created_at,
});
const cursorSchema = z
  .object({
    version: z.literal(1),
    binding: z.string().max(2048),
    createdAt: timestamp,
    id: identifier,
  })
  .strict();
const encode = (value: unknown) =>
  btoa(encodeURIComponent(JSON.stringify(value)));
export async function listAccessAudit(
  db: D1Database,
  actor: AppActor,
  scope: AccessScope,
  q: Filters,
) {
  await accessAuthority(db, actor, scope, true);
  const from = q.from ? new Date(q.from).toISOString() : null;
  const to = q.to ? new Date(q.to).toISOString() : null;
  const binding = JSON.stringify([
    scope,
    q.action ?? null,
    q.actorId ?? null,
    q.targetId ?? null,
    from,
    to,
  ]);
  const conditions = ["a.scope=?"];
  const values: (string | number)[] = [scope];
  for (const [column, value] of [
    ["action", q.action],
    ["actor_id", q.actorId],
    ["target_id", q.targetId],
  ] as const) {
    if (value !== undefined) {
      conditions.push(`a.${column}=?`);
      values.push(value);
    }
  }
  if (from) {
    conditions.push("a.created_at>=?");
    values.push(from);
  }
  if (to) {
    conditions.push("a.created_at<=?");
    values.push(to);
  }
  if (q.cursor) {
    try {
      const cursor = cursorSchema.parse(
        JSON.parse(decodeURIComponent(atob(q.cursor))),
      );
      if (cursor.binding !== binding)
        throw new Error("Cursor scope or filters changed.");
      conditions.push("(a.created_at<? OR (a.created_at=? AND a.id<?))");
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    } catch {
      throw new AccessControlError(
        422,
        "INVALID_AUDIT_CURSOR",
        "Invalid audit cursor for this scope and filters.",
      );
    }
  }
  const rows = await db
    .prepare(
      "SELECT " +
        columns +
        source +
        " WHERE " +
        conditions.join(" AND ") +
        " ORDER BY a.created_at DESC,a.id DESC LIMIT ?",
    )
    .bind(...values, q.limit + 1)
    .all<AuditRow>();
  const page = rows.results.slice(0, q.limit);
  const last = page.at(-1);
  return {
    data: page.map(summary),
    nextCursor:
      rows.results.length > q.limit && last
        ? encode({
            version: 1,
            binding,
            createdAt: last.created_at,
            id: last.id,
          })
        : null,
  };
}
export async function getAccessAudit(
  db: D1Database,
  actor: AppActor,
  scope: AccessScope,
  id: string,
) {
  await accessAuthority(db, actor, scope, true);
  const row = await db
    .prepare(
      "SELECT " +
        columns +
        ",a.before_state,a.after_state" +
        source +
        " WHERE a.scope=? AND a.id=?",
    )
    .bind(scope, id)
    .first<AuditRow>();
  if (!row)
    throw new AccessControlError(
      404,
      "AUDIT_NOT_FOUND",
      "Audit entry not found.",
    );
  const parse = (value: string | null): unknown =>
    value === null ? null : JSON.parse(value);
  return {
    ...summary(row),
    before: parse(row.before_state),
    after: parse(row.after_state),
  };
}
