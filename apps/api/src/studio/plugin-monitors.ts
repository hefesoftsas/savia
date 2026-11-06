import type { ExtensionOptions } from "@savia/studio-server/extensions";
import { isExtensionAvailable } from "@savia/studio-server/extensions";
import { storeConfigFor } from "@savia/studio-server/plugin-store";
import { getRecord, guard, updateRecord } from "@savia/studio-server/services";
import { historyDatabase } from "@savia/studio-server/record-history-storage";
import {
  accessDatabase,
  accessDenied,
  accessRecord,
  policyFor,
  requireRecordAccess,
} from "@savia/studio-server/access-authorization";
import { NotificationRepository } from "@savia/studio-server/notifications/repository";
import type { NoticeEventInput } from "@savia/studio-shared/notifications";
import type {
  StoreRecordMonitor,
  StoreMcpAction,
} from "@savia/studio-shared/plugin-store";
import { decideRecord } from "@savia/studio-shared/access-evaluator";
import type { StudioRecord } from "@savia/studio-shared/metadata";
import { dialectFor } from "@savia/db/dialect";
import { findPrincipal, loadActor } from "../auth/identity-repository";
import { hasCustomAccess } from "../auth/access-context";
import { loadAccessPolicy } from "../auth/access-repository";
import { canManageSharedCrm } from "../external-crm/hubspot-access";
import {
  createMcpPluginActionExecutor,
  type McpActionSourceRevision,
} from "./mcp-plugin-actions";
import { McpAdapterError } from "./mcp-adapter";
import {
  planMonitorCheck,
  type MonitorObservationState,
} from "./plugin-monitor-observation";

type Read = NonNullable<ExtensionOptions["executeMcpAction"]>;
type Installation = { tenant_id: string; id: string; version: string };
type Check = {
  owner_principal_id: string;
  observation: string | null;
  error_code: string | null;
  error_sequence: number;
};
export type PluginMonitorOptions = {
  integrationKey?: string;
  fetcher?: typeof fetch;
  now?: () => number;
  maxChecks?: number;
  budgetMs?: number;
  /** Trusted dependency injection for transport contract tests. */
  read?: Read;
};
export type PluginMonitorReport = {
  claimed: number;
  checked: number;
  alerts: number;
  failed: number;
  skipped: number;
};

/** Rebuild current tenant and row policy; never run under a borrowed/system OAuth identity. */
async function ownerDatabase(
  db: D1Database,
  tenant: string,
  principalId: string,
): Promise<D1Database | null> {
  const match = /^tenant:(0|[1-9]\d*)$/.exec(tenant);
  if (!match) return null;
  const principal = await findPrincipal(db, principalId);
  if (!principal?.isActive) return null;
  const actor = await loadActor(db, principal);
  const workspace = await db
    .prepare("SELECT kind FROM tenants WHERE id=? AND is_active=1")
    .bind(Number(match[1]))
    .first<{ kind: string }>();
  if (!workspace || !["commercial", "platform"].includes(workspace.kind))
    return null;
  if (
    workspace.kind === "platform" &&
    (match[1] !== "0" || !actor.globalRoles.includes("platform_admin"))
  )
    return null;
  if (canManageSharedCrm(actor, tenant)) return db;
  const scope = tenant as `tenant:${number}`;
  if (!(await hasCustomAccess(db, principalId, scope))) return null;
  return accessDatabase(db, await loadAccessPolicy(db, actor, scope));
}

function requireMonitorReadFields(
  db: D1Database,
  monitor: StoreRecordMonitor,
  record: StudioRecord,
) {
  const policy = policyFor(db);
  if (!policy) return;
  const access = decideRecord(
    policy,
    `collection:${monitor.collection}`,
    "read",
    accessRecord(record),
  );
  const fields = [
    monitor.lookup.field,
    monitor.matchField,
    monitor.titleField,
    monitor.status.field,
    monitor.deadline.field,
    monitor.enabledField,
    ...(monitor.pauseWhen ? [monitor.pauseWhen.field] : []),
  ];
  if (!access.allowed || fields.some((field) => !access.fields.includes(field)))
    accessDenied();
}

function authorityGuard(db: D1Database, tenant: string, principal: string) {
  const scoped = Boolean(policyFor(db));
  const permissions = scoped
    ? `EXISTS(SELECT 1 FROM identity_tenant_membership WHERE principal_id=p.id AND tenant_id=t.id AND is_active=1) AND EXISTS(SELECT 1 FROM access_assignments a JOIN access_roles r ON r.scope=a.scope AND r.id=a.role_id WHERE a.principal_id=p.id AND a.scope=? AND r.enabled=1 AND r.protected=0)`
    : `EXISTS(SELECT 1 FROM identity_global_role WHERE principal_id=p.id AND role='platform_admin') OR (t.kind='commercial' AND EXISTS(SELECT 1 FROM identity_tenant_membership WHERE principal_id=p.id AND tenant_id=t.id AND is_active=1 AND role IN ('agency_admin','tenant_admin','admin')))`;
  return guard(
    db,
    `SELECT count(*)=1 FROM identity_principal p JOIN tenants t ON t.id=? WHERE p.id=? AND p.is_active=1 AND t.is_active=1 AND (${permissions})`,
    [Number(tenant.slice(7)), principal, ...(scoped ? [tenant] : [])],
  );
}

async function eventKey(parts: unknown[]) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(parts)),
  );
  return (
    "monitor:" +
    [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}
function errorCode(error: unknown) {
  if (
    error instanceof McpAdapterError &&
    [401, 403, 404].includes(error.status)
  )
    return "authorization_required";
  if (error instanceof Error && error.message === "record_missing")
    return "record_missing";
  return "source_unavailable";
}
function conflict(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "status" in error &&
    error.status === 409,
  );
}
function paused(monitor: StoreRecordMonitor, record: Record<string, unknown>) {
  return (
    record[monitor.enabledField] === false ||
    record[monitor.enabledField] === 0 ||
    Boolean(
      monitor.pauseWhen?.values.includes(
        String(record[monitor.pauseWhen.field] ?? ""),
      ),
    )
  );
}
function replaceName(template: string, name: unknown) {
  return template
    .replace(/\{name\}/g, String(name ?? "").slice(0, 500))
    .slice(0, 4000);
}

export async function runPluginMonitors(
  db: D1Database,
  options: PluginMonitorOptions = {},
): Promise<PluginMonitorReport> {
  const now = (options.now ?? Date.now)(),
    started = Date.now();
  const maxChecks = Math.max(1, Math.min(100, options.maxChecks ?? 10));
  const budgetMs = Math.max(1, Math.min(60000, options.budgetMs ?? 20000));
  const report: PluginMonitorReport = {
    claimed: 0,
    checked: 0,
    alerts: 0,
    failed: 0,
    skipped: 0,
  };
  const cursor = await db
    .prepare(
      "SELECT after_tenant,after_extension FROM studio_plugin_monitor_cursor WHERE id='scan'",
    )
    .first<{ after_tenant: string; after_extension: string }>();
  const installationsAfter = (afterTenant: string, afterExtension: string) =>
    db
      .prepare(
        "SELECT tenant_id,id,version FROM studio_extension_installations WHERE enabled=1 AND (tenant_id>? OR (tenant_id=? AND id>?)) ORDER BY tenant_id,id LIMIT 100",
      )
      .bind(afterTenant, afterTenant, afterExtension)
      .all<Installation>();
  let installations = (
    await installationsAfter(
      cursor?.after_tenant ?? "",
      cursor?.after_extension ?? "",
    )
  ).results;
  if (!installations.length && cursor)
    installations = (await installationsAfter("", "")).results;
  let last: Installation | undefined;
  outer: for (const installation of installations) {
    const { tenant_id: tenant, id: extensionId, version } = installation;
    const config = await storeConfigFor(db, tenant, extensionId);
    if (
      !config?.monitors.length ||
      !(await isExtensionAvailable(db, tenant, extensionId))
    ) {
      last = installation;
      continue;
    }
    for (const monitor of config.monitors) {
      const action = config.actions.find(
        (item): item is StoreMcpAction =>
          item.id === monitor.actionId && item.kind === "mcp",
      );
      if (!action) continue;
      const json = (field: string) =>
        dialectFor(db).jsonValue("r.data", `$.${field}`);
      const pauseSql = monitor.pauseWhen?.values.length
        ? ` AND COALESCE(${json(monitor.pauseWhen.field)},'') NOT IN (${monitor.pauseWhen.values.map(() => "?").join(",")})`
        : "";
      const candidates = (
        await db
          .prepare(
            `SELECT r.id,r.created_by FROM studio_records r LEFT JOIN studio_plugin_monitor_checks m ON m.tenant_id=r.tenant_id AND m.record_id=r.id AND m.extension_id=? AND m.monitor_id=? WHERE r.tenant_id=? AND r.object_name=? AND r.deleted_at IS NULL AND r.created_by IS NOT NULL AND COALESCE(${json(monitor.enabledField)},1)<>0 ${pauseSql} AND COALESCE(m.next_check_at,0)<=? AND COALESCE(m.lease_expires_at,0)<=? ORDER BY COALESCE(m.next_check_at,0),r.id LIMIT ?`,
          )
          .bind(
            extensionId,
            monitor.id,
            tenant,
            monitor.collection,
            ...(monitor.pauseWhen?.values ?? []),
            now,
            now,
            maxChecks - report.claimed,
          )
          .all<{ id: string; created_by: string }>()
      ).results;
      for (const candidate of candidates) {
        if (report.claimed >= maxChecks || Date.now() - started >= budgetMs) {
          last = installation;
          break outer;
        }
        const key = [tenant, extensionId, monitor.id, candidate.id];
        const token = crypto.randomUUID();
        await db
          .prepare(
            "INSERT INTO studio_plugin_monitor_checks(tenant_id,extension_id,monitor_id,record_id,owner_principal_id) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",
          )
          .bind(...key, candidate.created_by)
          .run();
        const claim = await db
          .prepare(
            "UPDATE studio_plugin_monitor_checks SET lease_token=?,lease_expires_at=? WHERE tenant_id=? AND extension_id=? AND monitor_id=? AND record_id=? AND owner_principal_id=? AND next_check_at<=? AND lease_expires_at<=? RETURNING owner_principal_id,observation,error_code,error_sequence",
          )
          .bind(token, now + 90000, ...key, candidate.created_by, now, now)
          .first<Check>();
        if (!claim) continue;
        report.claimed++;
        const owner = claim.owner_principal_id;
        const release = (delay: number) =>
          db
            .prepare(
              "UPDATE studio_plugin_monitor_checks SET lease_token=NULL,lease_expires_at=0,next_check_at=? WHERE tenant_id=? AND extension_id=? AND monitor_id=? AND record_id=? AND lease_token=?",
            )
            .bind(now + delay, ...key, token)
            .run();
        const interval = monitor.intervalMinutes * 60000;
        try {
          let scoped = await ownerDatabase(db, tenant, owner);
          if (!scoped) {
            await release(interval);
            report.skipped++;
            continue;
          }
          const original = await getRecord(
            scoped,
            tenant,
            monitor.collection,
            candidate.id,
            "update",
          );
          requireRecordAccess(scoped, monitor.collection, "read", original);
          requireMonitorReadFields(scoped, monitor, original);
          if (paused(monitor, original) || original.created_by !== owner) {
            await release(interval);
            report.skipped++;
            continue;
          }
          const recordVersion = original._version;
          if (typeof recordVersion !== "number")
            throw new Error("record_missing");
          const lookup = original[monitor.lookup.field];
          let planned: ReturnType<typeof planMonitorCheck> | undefined;
          let failure: string | null = null;
          const sourceKey = [tenant, owner, action.sourceId];
          const sourceRevision = () =>
            db
              .prepare(
                "SELECT config,encrypted_secret,created_at FROM studio_collection_sources WHERE tenant_id=? AND owner_principal_id=? AND id=? AND kind='mcp'",
              )
              .bind(...sourceKey)
              .first<McpActionSourceRevision>();
          let sourceUsed = await sourceRevision();
          try {
            if (typeof lookup !== "string" || !lookup.trim())
              throw new Error("record_missing");
            if (!sourceUsed)
              throw new McpAdapterError(401, "Authorization required.");
            const read =
              options.read ??
              createMcpPluginActionExecutor({
                db,
                tenant,
                principalId: owner,
                integrationKey: options.integrationKey,
                fetcher: options.fetcher,
                onSourceUsed: (revision) => {
                  sourceUsed = revision;
                },
              });
            const output = await read({
              tenantId: tenant,
              principalId: owner,
              extensionId,
              action,
              input: {
                [monitor.lookup.argument]: lookup,
                page: 1,
                perPage: 100,
              },
            });
            const rows =
              output &&
              typeof output === "object" &&
              "data" in output &&
              Array.isArray(output.data)
                ? output.data
                : [];
            planned = planMonitorCheck({
              monitor,
              record: original,
              rows,
              state: claim.observation
                ? (JSON.parse(claim.observation) as MonitorObservationState)
                : undefined,
              now,
            });
          } catch (error) {
            failure = errorCode(error);
          }
          const currentSource = await sourceRevision();
          if (
            planned &&
            (!currentSource ||
              !sourceUsed ||
              currentSource.config !== sourceUsed.config ||
              currentSource.created_at !== sourceUsed.created_at ||
              currentSource.encrypted_secret !== sourceUsed.encrypted_secret)
          ) {
            planned = undefined;
            failure = "authorization_required";
          }
          // Rebuild policy after the remote read; the transaction also guards role/revision and installation changes.
          scoped = await ownerDatabase(db, tenant, owner);
          const currentInstallation = await db
            .prepare(
              "SELECT version FROM studio_extension_installations WHERE tenant_id=? AND id=? AND enabled=1",
            )
            .bind(tenant, extensionId)
            .first<{ version: string }>();
          if (
            !scoped ||
            currentInstallation?.version !== version ||
            !(await isExtensionAvailable(db, tenant, extensionId))
          ) {
            await release(interval);
            report.skipped++;
            continue;
          }
          requireMonitorReadFields(scoped, monitor, original);
          const guarded = historyDatabase(scoped, tenant, {
            kind: "system",
            id: owner,
            causeId: `plugin-monitor:${extensionId}:${monitor.id}`,
          });
          const events: NoticeEventInput[] = [];
          const notice = async (suffix: string, title: string, body: string) =>
            events.push({
              scope: { kind: "workspace", id: tenant },
              key: await eventKey([...key, suffix]),
              actor: { kind: "system", id: null },
              source: {
                kind: "record",
                collection: monitor.collection,
                id: candidate.id,
                operation: "updated",
              },
              title: title.slice(0, 500),
              body: body.slice(0, 4000),
              audience: { kind: "explicit", principals: [owner] },
              createdAt: now,
              expiresAt: null,
            });
          for (const alert of planned?.alerts ?? [])
            await notice(alert.key, alert.title, alert.body);
          const nextError = failure ?? planned?.errorCode ?? null;
          const errorSequence =
            claim.error_sequence +
            (nextError && nextError !== claim.error_code ? 1 : 0);
          if (
            nextError === "authorization_required" &&
            claim.error_code !== nextError
          )
            await notice(
              `connection:${errorSequence}`,
              replaceName(
                monitor.notifications.connectionTitle,
                original[monitor.titleField],
              ),
              replaceName(
                monitor.notifications.connectionBody,
                original[monitor.titleField],
              ),
            );
          const leaseGuard = guard(
            guarded,
            "SELECT count(*)=1 FROM studio_plugin_monitor_checks WHERE tenant_id=? AND extension_id=? AND monitor_id=? AND record_id=? AND lease_token=? AND lease_expires_at>?",
            [...key, token, now],
          );
          const installGuard = guard(
            guarded,
            "SELECT count(*)=1 FROM studio_extension_installations WHERE tenant_id=? AND id=? AND version=? AND enabled=1",
            [tenant, extensionId, version],
          );
          const actorGuard = authorityGuard(guarded, tenant, owner);
          const sourceGuard = currentSource
            ? guard(
                guarded,
                "SELECT count(*)=1 FROM studio_collection_sources WHERE tenant_id=? AND owner_principal_id=? AND id=? AND kind='mcp' AND config=? AND encrypted_secret IS ? AND created_at=?",
                [
                  ...sourceKey,
                  currentSource.config,
                  currentSource.encrypted_secret,
                  currentSource.created_at,
                ],
              )
            : guard(
                guarded,
                "SELECT count(*)=0 FROM studio_collection_sources WHERE tenant_id=? AND owner_principal_id=? AND id=?",
                sourceKey,
              );
          await updateRecord(
            guarded,
            tenant,
            monitor.collection,
            candidate.id,
            {
              [monitor.checkedAtField]: new Date(now).toISOString(),
              [monitor.errorField]: nextError ?? "",
              ...(planned
                ? {
                    [monitor.status.field]: planned.status,
                    [monitor.deadline.field]: planned.deadlineValue,
                  }
                : {}),
            },
            {
              version: recordVersion,
              checkpoint: {
                before: [
                  leaseGuard.start,
                  installGuard.start,
                  actorGuard.start,
                  sourceGuard.start,
                ],
                after: () => [
                  ...events.flatMap((event) =>
                    new NotificationRepository(guarded).eventStatements(event),
                  ),
                  guarded
                    .prepare(
                      "UPDATE studio_plugin_monitor_checks SET observation=?,error_code=?,error_sequence=?,last_checked_at=?,next_check_at=?,lease_token=NULL,lease_expires_at=0 WHERE tenant_id=? AND extension_id=? AND monitor_id=? AND record_id=? AND lease_token=?",
                    )
                    .bind(
                      planned
                        ? JSON.stringify(planned.state)
                        : claim.observation,
                      nextError,
                      errorSequence,
                      now,
                      now + interval,
                      ...key,
                      token,
                    ),
                  leaseGuard.end,
                  installGuard.end,
                  actorGuard.end,
                  sourceGuard.end,
                ],
              },
            },
          );
          if (failure) report.failed++;
          else report.checked++;
          report.alerts += events.length;
        } catch (error) {
          report.failed++;
          await release(conflict(error) ? 60000 : interval);
        }
      }
    }
    last = installation;
  }
  if (last)
    await db
      .prepare(
        "INSERT INTO studio_plugin_monitor_cursor(id,after_tenant,after_extension) VALUES('scan',?,?) ON CONFLICT(id) DO UPDATE SET after_tenant=excluded.after_tenant,after_extension=excluded.after_extension",
      )
      .bind(last.tenant_id, last.id)
      .run();
  return report;
}
