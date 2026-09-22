import {
  notificationDefaults,
  type DispatchReport,
  type NoticeEventInput,
  type NoticeScope,
  type NotificationPolicy,
} from "@savia/crm-shared/notifications";
import { processNotifications } from "@savia/crm-server/notifications/dispatcher";
import { maintainNotifications } from "@savia/crm-server/notifications/maintenance";
import { findPrincipal } from "./auth/identity-repository";
import type { AppActor } from "./auth/types";
import { loadActor } from "./auth/identity-repository";
import { canAccessSharedCrm, canManageSharedCrm } from "./crm/hubspot-access";

function pageAfter(ids: string[], after: string | null, limit: number) {
  const start = after === null ? 0 : ids.findIndex((id) => id > after);
  const page = start < 0 ? [] : ids.slice(start, start + limit);
  const last = page[page.length - 1];
  return {
    ids: page,
    nextCursor: last !== undefined && start + limit < ids.length ? last : null,
  };
}

async function actorFor(
  db: D1Database,
  principal: string,
): Promise<AppActor | null> {
  try {
    const row = await findPrincipal(db, principal);
    if (!row || !row.isActive) return null;
    return await loadActor(db, row);
  } catch {
    return null;
  }
}

function agencyId(tenant: string): number | null {
  const match = /^agency:(\d+)$/.exec(tenant);
  return match ? Number(match[1]) : null;
}

export function createNotificationPolicy(db: D1Database): NotificationPolicy {
  return {
    async recipients(event, after, limit) {
      if (event.audience.kind === "explicit") {
        return pageAfter(
          [...new Set(event.audience.principals)].sort(),
          after,
          limit,
        );
      }
      if (event.scope.kind === "account") return { ids: [], nextCursor: null };
      if (event.audience.kind === "workspace-members") {
        const tenantId = agencyId(event.scope.id);
        if (tenantId === null) return { ids: [], nextCursor: null };
        const rows = (
          await db
            .prepare(
              `SELECT m.principal_id FROM identity_tenant_membership m
               JOIN identity_principal p ON p.id=m.principal_id
               WHERE m.tenant_id=? AND m.is_active=1 AND p.is_active=1
               ORDER BY m.principal_id`,
            )
            .bind(tenantId)
            .all<{ principal_id: string }>()
        ).results;
        return pageAfter(
          rows.map((row) => row.principal_id),
          after,
          limit,
        );
      }
      const rows = (
        await db
          .prepare(
            `SELECT principal_id FROM notification_subscriptions
             WHERE workspace_id=? AND collection=?
             ORDER BY principal_id`,
          )
          .bind(event.scope.id, event.audience.collection)
          .all<{ principal_id: string }>()
      ).results;
      return pageAfter(
        rows.map((row) => row.principal_id),
        after,
        limit,
      );
    },
    async canReadScope(principal, scope) {
      try {
        if (scope.kind === "account") {
          const row = await findPrincipal(db, principal);
          return Boolean(row?.isActive) && principal === scope.id;
        }
        const actor = await actorFor(db, principal);
        return actor !== null && canAccessSharedCrm(actor, scope.id);
      } catch {
        return false;
      }
    },
    async canReadSource(principal, scope, source) {
      let scopeOk = false;
      try {
        if (scope.kind === "account") {
          scopeOk =
            Boolean((await findPrincipal(db, principal))?.isActive) &&
            principal === scope.id;
        } else {
          const actor = await actorFor(db, principal);
          scopeOk = actor !== null && canAccessSharedCrm(actor, scope.id);
        }
        if (!scopeOk) return false;
        if (source.kind === "record") {
          const row = await db
            .prepare(
              "SELECT 1 AS ok FROM crm_objects WHERE tenant_id=? AND name=?",
            )
            .bind(scope.id, source.collection)
            .first<number>("ok");
          return row !== null;
        }
        if (source.kind === "workflow-task") {
          const row = await db
            .prepare("SELECT 1 AS ok FROM workflow_tasks WHERE id=?")
            .bind(source.id)
            .first<number>("ok");
          return row !== null;
        }
        return true;
      } catch {
        return scopeOk;
      }
    },
    async canSend(principal, scope) {
      try {
        if (scope.kind === "account") return false;
        const actor = await actorFor(db, principal);
        return actor !== null && canManageSharedCrm(actor, scope.id);
      } catch {
        return false;
      }
    },
  };
}

export async function runScheduledNotifications(
  db: D1Database,
): Promise<DispatchReport> {
  const startedAt = Date.now();
  const report = await processNotifications(db, createNotificationPolicy(db), {
    now: () => Date.now(),
    random: () => Math.random(),
    workerId: `scheduled-${startedAt}`,
    maxEvents: notificationDefaults.maxEvents,
    maxRecipients: notificationDefaults.maxRecipients,
    maxRecipientAttempts: notificationDefaults.maxRecipientAttempts,
    softBudgetMs: notificationDefaults.softBudgetMs,
    leaseMs: notificationDefaults.leaseMs,
  });
  const backlog = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM notification_events WHERE status='pending'",
    )
    .first<number>("n");
  console.info(
    JSON.stringify({
      event: "notification_dispatch",
      ...report,
      backlog: backlog ?? 0,
      durationMs: Date.now() - startedAt,
    }),
  );
  try {
    const maintenance = await maintainNotifications(db, Date.now(), 100);
    console.info(
      JSON.stringify({ event: "notification_maintenance", ...maintenance }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "notification_maintenance_failed",
        error: String(error),
      }),
    );
  }
  return report;
}

export type { NoticeEventInput, NoticeScope, NotificationPolicy };
