import { dialectFor } from "@savia/db/dialect";
import { HTTPException } from "hono/http-exception";
import type { AppActor } from "../auth/types";
import { hasAgencyCapability } from "../auth/access-policy";
import { findPrincipal, loadActor } from "../auth/identity-repository";
import type { CrmRouteDependencies } from "../routes/crm";
import { CrmUpstreamError } from "./contracts";
import type {
  CrmProviderAdapter,
  CustomerCrmSyncRepository,
  CustomerCrmSyncRecord,
  CustomerCrmObjectKind,
} from "./contracts";
import { createCrmRepository } from "./repository";
import { createCustomerCrmSyncService } from "./customer-sync";

type RuleRow = {
  id: string;
  principal_id: string;
  tenant_id: number;
  provider: "hubspot";
  connection_id: string;
  external_account_id: string;
  account_label: string;
  enabled: number;
  created_at: string;
  tenant_name?: string;
};
type JobRow = {
  id: string;
  rule_id: string;
  customer_id: number;
  revision: number;
  status: string;
  attempts: number;
  last_error: string | null;
  external_url: string | null;
  updated_at: string;
  lease_token: string | null;
  lease_started_at: string | null;
};
const ruleView = (r: RuleRow) => ({
  id: r.id,
  tenantId: r.tenant_id,
  tenantName: r.tenant_name ?? "",
  provider: r.provider,
  accountLabel: r.account_label,
  enabled: !!r.enabled,
  connectionId: r.connection_id,
  createdAt: r.created_at,
});

async function mayManage(db: D1Database, actor: AppActor, tenantId: number) {
  const tenant = await db
    .prepare(
      "SELECT id FROM tenants WHERE id=? AND kind='commercial' AND is_active=1",
    )
    .bind(tenantId)
    .first<{ id: number }>();
  return (
    !!tenant &&
    actor.principal.isActive &&
    (actor.globalRoles.includes("platform_admin") ||
      hasAgencyCapability(actor, tenantId, "crm:manage"))
  );
}
async function requireManage(
  db: D1Database,
  actor: AppActor,
  tenantId: number,
) {
  if (!(await mayManage(db, actor, tenantId)))
    throw new HTTPException(403, {
      message:
        "No tienes permiso para configurar la sincronización de este tenant.",
    });
}
async function ruleFor(db: D1Database, actor: AppActor, id: string) {
  const rule = await db
    .prepare(
      "SELECT r.*,a.name tenant_name FROM crm_sync_rules r JOIN tenants a ON a.id=r.tenant_id WHERE a.kind='commercial' AND r.id=? AND r.principal_id=?",
    )
    .bind(id, actor.principal.id)
    .first<RuleRow>();
  if (!rule) throw new HTTPException(404, { message: "Regla no encontrada." });
  await requireManage(db, actor, rule.tenant_id);
  return rule;
}
export async function listSyncRules(db: D1Database, actor: AppActor) {
  const tenants = await db
    .prepare(
      "SELECT id,name FROM tenants WHERE kind='commercial' AND is_active=1 ORDER BY name",
    )
    .all<{ id: number; name: string }>();
  const allowed = (
    await Promise.all(
      tenants.results.map(async (tenant) => ({
        tenant,
        allowed: await mayManage(db, actor, tenant.id),
      })),
    )
  )
    .filter((entry) => entry.allowed)
    .map((entry) => entry.tenant);
  const rules = await db
    .prepare(
      "SELECT r.*,a.name tenant_name FROM crm_sync_rules r JOIN tenants a ON a.id=r.tenant_id WHERE a.kind='commercial' AND principal_id=? ORDER BY r.created_at DESC",
    )
    .bind(actor.principal.id)
    .all<RuleRow>();
  return {
    rules: rules.results
      .filter((r) => allowed.some((a) => a.id === r.tenant_id))
      .map(ruleView),
    tenants: allowed.map(({ id, name }) => ({ id, name })),
  };
}
export async function createSyncRule(
  db: D1Database,
  actor: AppActor,
  input: { tenantId: number; provider: "hubspot" },
) {
  await requireManage(db, actor, input.tenantId);
  const connection = await createCrmRepository(
    db,
  ).findActiveConnectionForPrincipal(input.provider, actor.principal.id);
  if (
    !connection ||
    connection.status !== "connected" ||
    !connection.externalAccountId
  )
    throw new HTTPException(409, {
      message: "Conecta HubSpot antes de activar la sincronización.",
    });
  // Pin both the connection and account: a later reconnect must never redirect queued data.
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO crm_sync_rules(id,principal_id,tenant_id,provider,connection_id,external_account_id,account_label) VALUES (?,?,?,?,?,?,?)
 ON CONFLICT(principal_id,tenant_id,provider,connection_id,external_account_id) DO UPDATE SET enabled=1`,
    )
    .bind(
      id,
      actor.principal.id,
      input.tenantId,
      input.provider,
      connection.id,
      connection.externalAccountId,
      connection.externalAccountLabel ??
        `HubSpot ${connection.externalAccountId}`,
    )
    .run();
  const row = await db
    .prepare(
      "SELECT r.*,a.name tenant_name FROM crm_sync_rules r JOIN tenants a ON a.id=r.tenant_id WHERE a.kind='commercial' AND principal_id=? AND tenant_id=? AND provider=? AND connection_id=? AND external_account_id=?",
    )
    .bind(
      actor.principal.id,
      input.tenantId,
      input.provider,
      connection.id,
      connection.externalAccountId,
    )
    .first<RuleRow>();
  return ruleView(row!);
}
export async function setSyncRuleEnabled(
  db: D1Database,
  actor: AppActor,
  id: string,
  enabled: boolean,
) {
  const rule = await ruleFor(db, actor, id);
  if (enabled) {
    const c = await createCrmRepository(db).findActiveConnectionForPrincipal(
      rule.provider,
      actor.principal.id,
    );
    if (
      !c ||
      c.status !== "connected" ||
      c.id !== rule.connection_id ||
      c.externalAccountId !== rule.external_account_id
    )
      throw new HTTPException(409, {
        message: "La conexión cambió. Crea una regla para la cuenta actual.",
      });
  }
  const statements = [
    db
      .prepare(
        "UPDATE crm_sync_rules SET enabled=? WHERE id=? AND principal_id=?",
      )
      .bind(enabled ? 1 : 0, id, actor.principal.id),
  ];
  if (!enabled) {
    statements.push(
      db
        .prepare(
          `UPDATE crm_sync_jobs SET
           status=CASE WHEN status IN ('pending','failed') THEN 'blocked' ELSE status END,
           last_error='RULE_PAUSED',updated_at=?
           WHERE rule_id=? AND status IN ('pending','failed','processing')`,
        )
        .bind(new Date().toISOString(), id),
    );
  }
  await db.batch(statements);
  return ruleView({ ...rule, enabled: enabled ? 1 : 0 });
}
export async function deleteSyncRule(
  db: D1Database,
  actor: AppActor,
  id: string,
) {
  const rule = await ruleFor(db, actor, id);
  await db.batch([
    db.prepare("DELETE FROM crm_sync_mappings WHERE rule_id=?").bind(rule.id),
    db.prepare("DELETE FROM crm_sync_jobs WHERE rule_id=?").bind(rule.id),
    db
      .prepare("DELETE FROM crm_sync_rules WHERE id=? AND principal_id=?")
      .bind(rule.id, actor.principal.id),
  ]);
  return { success: true as const, id: rule.id };
}
export async function listSyncJobs(
  db: D1Database,
  actor: AppActor,
  customerId?: number,
) {
  const { rules } = await listSyncRules(db, actor);
  const rows = await db
    .prepare(
      `SELECT j.*,r.provider FROM crm_sync_jobs j JOIN crm_sync_rules r ON r.id=j.rule_id WHERE r.principal_id=? ${customerId === undefined ? "" : "AND j.customer_id=?"} ORDER BY j.updated_at DESC LIMIT 100`,
    )
    .bind(actor.principal.id, ...(customerId === undefined ? [] : [customerId]))
    .all<JobRow & { provider: string }>();
  return rows.results
    .filter((j) => rules.some((r) => r.id === j.rule_id))
    .map((j) => ({
      id: j.id,
      ruleId: j.rule_id,
      customerId: j.customer_id,
      provider: j.provider,
      status: j.status,
      attempts: j.attempts,
      lastError: j.last_error,
      updatedAt: j.updated_at,
      externalUrl: j.external_url,
    }));
}
export async function retrySyncJob(
  db: D1Database,
  actor: AppActor,
  id: string,
) {
  const job = await db
    .prepare("SELECT * FROM crm_sync_jobs WHERE id=?")
    .bind(id)
    .first<JobRow>();
  if (!job)
    throw new HTTPException(404, { message: "Sincronización no encontrada." });
  const rule = await ruleFor(db, actor, job.rule_id);
  if (!rule.enabled)
    throw new HTTPException(409, {
      message: "Activa la regla antes de reintentar.",
    });
  if (job.status !== "failed")
    throw new HTTPException(409, {
      message:
        "Solo se pueden reintentar errores con resultado conocido. Los bloqueos requieren revisión.",
    });
  const update = await db
    .prepare(
      "UPDATE crm_sync_jobs SET status='pending',attempts=0,next_attempt_at=?,updated_at=? WHERE id=? AND status='failed'",
    )
    .bind(new Date().toISOString(), new Date().toISOString(), id)
    .run();
  if (!update.meta.changes)
    throw new HTTPException(409, {
      message: "La sincronización ya está en curso.",
    });
  return { queued: true as const };
}

// Automatic sync uses separate rule/account mappings; legacy manual mappings stay untouched.
function ruleMappings(
  db: D1Database,
  rule: RuleRow,
): CustomerCrmSyncRepository {
  const find = async (
    _agency: number,
    customer: number,
    _provider: string,
    kind: CustomerCrmObjectKind,
    _principal: string,
  ): Promise<CustomerCrmSyncRecord | undefined> => {
    const row = await db
      .prepare(
        "SELECT external_object_id,updated_at FROM crm_sync_mappings WHERE rule_id=? AND customer_id=? AND object_kind=?",
      )
      .bind(rule.id, customer, kind)
      .first<{ external_object_id: string; updated_at: string }>();
    return row
      ? {
          principalId: rule.principal_id,
          agencyId: rule.tenant_id,
          customerProfileId: customer,
          provider: rule.provider,
          objectKind: kind,
          externalObjectId: row.external_object_id,
          lastSyncedAt: row.updated_at,
          lastFailureCode: null,
          lastFailureAt: null,
        }
      : undefined;
  };
  return {
    find,
    listByCustomerIds: async () => [],
    recordFailure: async () => false,
    upsertSuccess: async (input) => {
      await db
        .prepare(
          "INSERT INTO crm_sync_mappings(rule_id,customer_id,object_kind,external_object_id) VALUES (?,?,?,?) ON CONFLICT(rule_id,customer_id,object_kind) DO UPDATE SET external_object_id=excluded.external_object_id,updated_at=" +
            dialectFor(db).utcNow() +
            "",
        )
        .bind(
          rule.id,
          input.customerProfileId,
          input.objectKind,
          input.externalObjectId,
        )
        .run();
    },
  };
}

export async function processCrmSyncJobs(
  db: D1Database,
  dependencies: CrmRouteDependencies,
  options: { limit?: number; now?: Date } = {},
) {
  const now = options.now ?? new Date(),
    stamp = now.toISOString();
  // An interrupted remote write has an unknown outcome. Never steal it and blindly create again.
  await db
    .prepare(
      "UPDATE crm_sync_jobs SET status='blocked',lease_token=NULL,lease_started_at=NULL,last_error='REMOTE_OUTCOME_UNKNOWN',updated_at=? WHERE status='processing' AND lease_started_at<?",
    )
    .bind(stamp, new Date(now.getTime() - 10 * 60_000).toISOString())
    .run();
  const due = await db
    .prepare(
      `SELECT j.id FROM crm_sync_jobs j JOIN crm_sync_rules r ON r.id=j.rule_id WHERE r.enabled=1 AND EXISTS (SELECT 1 FROM studio_solution_installations i WHERE i.tenant_id='agency:' || r.tenant_id AND i.id IN ('savia.insurance','savia.insurance-management') AND i.enabled=1) AND j.status IN ('pending','failed') AND j.attempts<5 AND j.next_attempt_at<=? ORDER BY j.next_attempt_at,j.id LIMIT ?`,
    )
    .bind(stamp, Math.min(20, Math.max(1, options.limit ?? 5)))
    .all<{ id: string }>();
  let processed = 0;
  for (const candidate of due.results) {
    const lease = crypto.randomUUID();
    const job = await db
      .prepare(
        "UPDATE crm_sync_jobs SET status='processing',lease_token=?,lease_started_at=?,attempts=attempts+1,updated_at=? WHERE id=? AND status IN ('pending','failed') AND attempts<5 AND next_attempt_at<=? AND EXISTS(SELECT 1 FROM crm_sync_rules r WHERE r.id=rule_id AND r.enabled=1) RETURNING *",
      )
      .bind(lease, stamp, stamp, candidate.id, stamp)
      .first<JobRow>();
    if (!job) continue;
    processed++;
    let createUncertain = false;
    let upstreamStatus: number | undefined;
    const finish = async (
      status: string,
      error: string | null,
      url: string | null = null,
    ) => {
      await db
        .prepare(
          `UPDATE crm_sync_jobs SET status=CASE
            WHEN ?='blocked' THEN 'blocked'
            WHEN last_error='RULE_PAUSED' THEN 'blocked'
            WHEN revision>? THEN 'pending' ELSE ? END,
    synced_revision=CASE WHEN ?='synced' THEN ? ELSE synced_revision END,
    attempts=CASE WHEN ?='synced' OR (revision>? AND ?<>'blocked') THEN 0 ELSE attempts END,
    last_error=CASE
      WHEN ?='blocked' THEN ?
      WHEN last_error='RULE_PAUSED' THEN 'RULE_PAUSED'
      WHEN revision>? THEN NULL ELSE ? END,
    external_url=COALESCE(?,external_url),lease_token=NULL,lease_started_at=NULL,
    next_attempt_at=CASE WHEN revision>? AND ?<>'blocked' THEN ? ELSE ? END,updated_at=?
    WHERE id=? AND lease_token=? AND status='processing'`,
        )
        .bind(
          status,
          job.revision,
          status,
          status,
          job.revision,
          status,
          job.revision,
          status,
          status,
          error,
          job.revision,
          error,
          url,
          job.revision,
          status,
          stamp,
          status === "failed" &&
            ([
              "CRM_CONNECTION_NOT_READY",
              "CRM_UNAVAILABLE",
              "CRM_RECONNECT_REQUIRED",
            ].includes(error ?? "") ||
              (upstreamStatus !== undefined &&
                upstreamStatus >= 400 &&
                upstreamStatus < 500 &&
                ![408, 429].includes(upstreamStatus)))
            ? "9999-12-31T00:00:00.000Z"
            : new Date(
                now.getTime() +
                  (status === "failed"
                    ? Math.min(3600, 30 * 2 ** (job.attempts - 1)) * 1000
                    : 0),
              ).toISOString(),
          new Date().toISOString(),
          job.id,
          lease,
        )
        .run();
    };
    try {
      const rule = await db
        .prepare("SELECT * FROM crm_sync_rules WHERE id=?")
        .bind(job.rule_id)
        .first<RuleRow>();
      if (!rule?.enabled) {
        await finish("pending", null);
        continue;
      }
      const principal = await findPrincipal(db, rule.principal_id);
      const actor = principal?.isActive
        ? await loadActor(db, principal)
        : undefined;
      if (!actor || !(await mayManage(db, actor, rule.tenant_id))) {
        await finish("blocked", "AUTHORIZATION_REVOKED");
        continue;
      }
      const source = await db
        .prepare(
          "SELECT a.tenant_id FROM customer_clientagency c JOIN agencies a ON a.id=c.agency_id WHERE c.id=?",
        )
        .bind(job.customer_id)
        .first<{ tenant_id: number }>();
      if (!source || source.tenant_id !== rule.tenant_id) {
        await finish("blocked", "SOURCE_CHANGED");
        continue;
      }
      const connections = createCrmRepository(db);
      const connection = await connections.findActiveConnectionForPrincipal(
        rule.provider,
        rule.principal_id,
      );
      if (
        !connection ||
        connection.id !== rule.connection_id ||
        connection.externalAccountId !== rule.external_account_id
      ) {
        await finish("blocked", "CONNECTION_CHANGED");
        continue;
      }
      if (connection.status !== "connected") {
        await finish("failed", "CRM_CONNECTION_NOT_READY");
        continue;
      }
      const adapter = dependencies.adapters?.[rule.provider];
      if (!adapter) {
        await finish("failed", "CRM_UNAVAILABLE");
        continue;
      }
      const mappings = ruleMappings(db, rule);
      const safeMappings: CustomerCrmSyncRepository = {
        ...mappings,
        upsertSuccess: async (input) => {
          await mappings.upsertSuccess(input);
          createUncertain = false;
        },
      };
      // Once a create has been dispatched, only a persisted external ID proves its outcome.
      const guarded = Object.fromEntries(
        Object.entries(adapter).map(([name, method]) => [
          name,
          async (...args: unknown[]) => {
            const creating =
              name === "createContact" || name === "createCompany";
            if (creating) createUncertain = true;
            try {
              return await (method as (...args: unknown[]) => Promise<unknown>)(
                ...args,
              );
            } catch (error) {
              if (error instanceof CrmUpstreamError) {
                upstreamStatus = error.status;
                if (
                  creating &&
                  (error.code === "RECONNECT_REQUIRED" ||
                    (error.status &&
                      error.status >= 400 &&
                      error.status < 500 &&
                      error.status !== 408))
                )
                  createUncertain = false;
              }
              throw error;
            }
          },
        ]),
      ) as CrmProviderAdapter;
      const service = createCustomerCrmSyncService({
        db,
        allowPlatformAdministration: true,
        clearMissingFields: true,
        connections: {
          ...connections,
          findActiveConnection: async () => connection,
          findActiveConnectionForPrincipal: async () => connection,
        },
        mappings: safeMappings,
        adapters: { hubspot: guarded },
      });
      const result = (
        await service.syncCustomers({ actor, customerIds: [job.customer_id] })
      ).items[0];
      if (result.status === "created" || result.status === "updated")
        await finish("synced", null, result.primaryLink?.url ?? null);
      else if (createUncertain)
        await finish("blocked", "REMOTE_OUTCOME_UNKNOWN");
      else
        await finish(
          result.status === "skipped" ? "blocked" : "failed",
          result.reason ?? "UPSTREAM_FAILURE",
        );
    } catch {
      await finish(
        createUncertain ? "blocked" : "failed",
        createUncertain ? "REMOTE_OUTCOME_UNKNOWN" : "SYNC_FAILED",
      );
    }
  }
  return { processed };
}
