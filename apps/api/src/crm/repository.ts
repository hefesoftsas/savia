import {
  type ActiveCrmConnection,
  type CrmAuditEvent,
  type CrmConnection,
  type CrmConnectionCompletion,
  type CrmConnectionStatus,
  type CrmProviderId,
  type CrmRepository,
  crmConnectionStatuses,
  crmProviderIds,
} from "./contracts";

type CrmConnectionRow = {
  id: string;
  agency_id: number;
  created_by_principal_id: string;
  provider: string;
  nango_connection_id: string;
  nango_integration_id: string;
  status: string;
  external_account_label: string | null;
  external_account_id: string | null;
  scopes: string;
  last_validated_at: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
};

function parseScopes(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((scope): scope is string => typeof scope === "string")
      : [];
  } catch {
    return [];
  }
}

function providerFromRow(value: string): CrmProviderId {
  if (crmProviderIds.includes(value as CrmProviderId))
    return value as CrmProviderId;
  throw new Error("Stored CRM provider is invalid");
}

function statusFromRow(value: string): CrmConnectionStatus {
  if (crmConnectionStatuses.includes(value as CrmConnectionStatus))
    return value as CrmConnectionStatus;
  throw new Error("Stored CRM connection status is invalid");
}

function connectionFromRow(row: CrmConnectionRow): ActiveCrmConnection {
  return {
    id: row.id,
    agencyId: row.agency_id,
    provider: providerFromRow(row.provider),
    status: statusFromRow(row.status),
    externalAccountLabel: row.external_account_label,
    externalAccountId: row.external_account_id,
    scopes: parseScopes(row.scopes),
    lastValidatedAt: row.last_validated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nangoConnectionId: row.nango_connection_id,
    nangoIntegrationId: row.nango_integration_id,
  };
}

function publicConnection(row: CrmConnectionRow): CrmConnection {
  const {
    nangoConnectionId: _nangoConnectionId,
    nangoIntegrationId: _nangoIntegrationId,
    externalAccountId: _externalAccountId,
    ...connection
  } = connectionFromRow(row);
  return connection;
}

async function findActiveConnection(
  db: D1Database,
  agencyId: number,
  provider: CrmProviderId,
  principalId: string,
): Promise<ActiveCrmConnection | undefined> {
  const row = await db
    .prepare(
      `SELECT * FROM agency_crm_connections
       WHERE agency_id = ? AND provider = ? AND created_by_principal_id = ? AND disconnected_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(agencyId, provider, principalId)
    .first<CrmConnectionRow>();
  return row ? connectionFromRow(row) : undefined;
}

async function findActiveConnectionForPrincipal(
  db: D1Database,
  provider: CrmProviderId,
  principalId: string,
): Promise<ActiveCrmConnection | undefined> {
  const row = await db
    .prepare(
      `SELECT * FROM agency_crm_connections
       WHERE provider = ? AND created_by_principal_id = ? AND disconnected_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(provider, principalId)
    .first<CrmConnectionRow>();
  return row ? connectionFromRow(row) : undefined;
}

function dedupeConnectionsByProvider(
  rows: CrmConnectionRow[],
): CrmConnection[] {
  const seen = new Set<string>();
  const connections: CrmConnection[] = [];
  for (const row of rows) {
    if (seen.has(row.provider)) continue;
    seen.add(row.provider);
    connections.push(publicConnection(row));
  }
  return connections;
}

export function createCrmRepository(db: D1Database): CrmRepository {
  return {
    async listConnections(agencyId, principalId) {
      const rows = await db
        .prepare(
          `SELECT * FROM agency_crm_connections
           WHERE agency_id = ? AND created_by_principal_id = ? AND disconnected_at IS NULL
           ORDER BY created_at DESC`,
        )
        .bind(agencyId, principalId)
        .all<CrmConnectionRow>();
      return rows.results.map(publicConnection);
    },

    async listConnectionsForPrincipal(principalId) {
      const rows = await db
        .prepare(
          `SELECT * FROM agency_crm_connections
           WHERE created_by_principal_id = ? AND disconnected_at IS NULL
           ORDER BY provider ASC, updated_at DESC`,
        )
        .bind(principalId)
        .all<CrmConnectionRow>();
      return dedupeConnectionsByProvider(rows.results);
    },

    async findActiveConnection(agencyId, provider, principalId) {
      return findActiveConnection(db, agencyId, provider, principalId);
    },

    async findActiveConnectionForPrincipal(provider, principalId) {
      return findActiveConnectionForPrincipal(db, provider, principalId);
    },

    async resolveDefaultTenantId() {
      const row = await db
        .prepare(
          `SELECT id FROM tenants
           WHERE kind = 'commercial' AND is_active = 1
           ORDER BY id ASC
           LIMIT 1`,
        )
        .first<{ id: number }>();
      return row?.id;
    },

    async saveConnection(completion) {
      const now = new Date().toISOString();
      const current =
        (await findActiveConnectionForPrincipal(
          db,
          completion.provider,
          completion.actor.principal.id,
        )) ??
        (await findActiveConnection(
          db,
          completion.agencyId,
          completion.provider,
          completion.actor.principal.id,
        ));
      const agencyId = current?.agencyId ?? completion.agencyId;
      const connectionId = current?.id ?? crypto.randomUUID();
      const scopes = JSON.stringify(completion.scopes ?? []);
      if (current) {
        await db
          .prepare(
            `UPDATE agency_crm_connections
             SET nango_connection_id = ?, nango_integration_id = ?, status = ?,
               external_account_label = ?, external_account_id = ?, scopes = ?, last_validated_at = ?,
               updated_at = ?
             WHERE id = ? AND created_by_principal_id = ?`,
          )
          .bind(
            completion.nangoConnectionId,
            completion.nangoIntegrationId,
            completion.status,
            completion.externalAccountLabel ?? null,
            completion.externalAccountId ?? null,
            scopes,
            completion.lastValidatedAt ?? null,
            now,
            connectionId,
            completion.actor.principal.id,
          )
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO agency_crm_connections (
              id, agency_id, created_by_principal_id, provider,
              nango_connection_id, nango_integration_id, status,
              external_account_label, external_account_id, scopes, last_validated_at, created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            connectionId,
            agencyId,
            completion.actor.principal.id,
            completion.provider,
            completion.nangoConnectionId,
            completion.nangoIntegrationId,
            completion.status,
            completion.externalAccountLabel ?? null,
            completion.externalAccountId ?? null,
            scopes,
            completion.lastValidatedAt ?? null,
            now,
            now,
          )
          .run();
      }
      const stored =
        (await findActiveConnectionForPrincipal(
          db,
          completion.provider,
          completion.actor.principal.id,
        )) ??
        (await findActiveConnection(
          db,
          agencyId,
          completion.provider,
          completion.actor.principal.id,
        ));
      if (!stored) throw new Error("The CRM connection was not stored");
      return stored;
    },

    async markDisconnected(
      agencyId,
      provider,
      principalId,
      now = new Date().toISOString(),
    ) {
      const result = await db
        .prepare(
          `UPDATE agency_crm_connections
           SET status = 'disconnected', disconnected_at = ?, updated_at = ?
           WHERE agency_id = ? AND provider = ? AND created_by_principal_id = ? AND disconnected_at IS NULL`,
        )
        .bind(now, now, agencyId, provider, principalId)
        .run();
      return result.meta.changes === 1;
    },

    async markReconnectRequired(
      connectionId,
      principalId,
      now = new Date().toISOString(),
    ) {
      const result = await db
        .prepare(
          `UPDATE agency_crm_connections
           SET status = 'reconnect_required', updated_at = ?
           WHERE id = ? AND created_by_principal_id = ? AND disconnected_at IS NULL`,
        )
        .bind(now, connectionId, principalId)
        .run();
      return result.meta.changes === 1;
    },

    async appendAuditEvent(event: CrmAuditEvent) {
      await db
        .prepare(
          `INSERT INTO agency_crm_connection_audit_events (
            id, connection_id, agency_id, principal_id, provider, event_type,
            outcome, error_code, created_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM agency_crm_connections WHERE id = ? AND agency_id = ? AND created_by_principal_id = ?)`,
        )
        .bind(
          crypto.randomUUID(),
          event.connectionId,
          event.agencyId,
          event.principalId,
          event.provider,
          event.eventType,
          event.outcome,
          event.errorCode ?? null,
          new Date().toISOString(),
          event.connectionId,
          event.agencyId,
          event.principalId,
        )
        .run();
    },
  };
}
