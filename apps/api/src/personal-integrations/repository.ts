import type {
  ActivePersonalIntegrationConnection,
  PersonalIntegrationCompletion,
  PersonalIntegrationConnection,
  PersonalIntegrationConnectionStatus,
  PersonalIntegrationProviderId,
  PersonalIntegrationRepository,
} from "./contracts";
import {
  isPersonalIntegrationProviderId,
  personalIntegrationConnectionStatuses,
} from "./contracts";

type ConnectionRow = {
  id: string;
  principal_id: string;
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

function scopesFromRow(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function connectionFromRow(
  row: ConnectionRow,
): ActivePersonalIntegrationConnection {
  if (!isPersonalIntegrationProviderId(row.provider))
    throw new Error("Stored personal integration provider is invalid");
  if (
    !personalIntegrationConnectionStatuses.includes(
      row.status as PersonalIntegrationConnectionStatus,
    )
  )
    throw new Error("Stored personal integration status is invalid");
  return {
    id: row.id,
    principalId: row.principal_id,
    provider: row.provider,
    status: row.status as PersonalIntegrationConnectionStatus,
    externalAccountLabel: row.external_account_label,
    externalAccountId: row.external_account_id,
    scopes: scopesFromRow(row.scopes),
    lastValidatedAt: row.last_validated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nangoConnectionId: row.nango_connection_id,
    nangoIntegrationId: row.nango_integration_id,
  };
}

function publicConnection(row: ConnectionRow): PersonalIntegrationConnection {
  const {
    principalId: _principalId,
    nangoConnectionId: _nangoConnectionId,
    nangoIntegrationId: _nangoIntegrationId,
    externalAccountId: _externalAccountId,
    ...connection
  } = connectionFromRow(row);
  return connection;
}

async function findActive(
  database: D1Database,
  principalId: string,
  provider: PersonalIntegrationProviderId,
): Promise<ActivePersonalIntegrationConnection | undefined> {
  const row = await database
    .prepare(
      `SELECT * FROM personal_integration_connections
       WHERE principal_id = ? AND provider = ? AND disconnected_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(principalId, provider)
    .first<ConnectionRow>();
  return row ? connectionFromRow(row) : undefined;
}

export function createPersonalIntegrationRepository(
  database: D1Database,
): PersonalIntegrationRepository {
  return {
    async listConnections(principalId) {
      const rows = await database
        .prepare(
          `SELECT * FROM personal_integration_connections
           WHERE principal_id = ? AND disconnected_at IS NULL
           ORDER BY created_at DESC`,
        )
        .bind(principalId)
        .all<ConnectionRow>();
      return rows.results.map(publicConnection);
    },

    async findActiveConnection(principalId, provider) {
      return findActive(database, principalId, provider);
    },

    async saveConnection(completion) {
      const now = new Date().toISOString();
      const current = await findActive(
        database,
        completion.principalId,
        completion.provider,
      );
      const id = current?.id ?? crypto.randomUUID();
      const scopes = JSON.stringify(completion.scopes ?? []);
      if (current) {
        await database
          .prepare(
            `UPDATE personal_integration_connections
             SET nango_connection_id = ?, nango_integration_id = ?, status = ?,
               external_account_label = ?, external_account_id = ?, scopes = ?,
               last_validated_at = ?, updated_at = ?
             WHERE id = ?`,
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
            id,
          )
          .run();
      } else {
        await database
          .prepare(
            `INSERT INTO personal_integration_connections (
              id, principal_id, provider, nango_connection_id, nango_integration_id,
              status, external_account_label, external_account_id, scopes,
              last_validated_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            completion.principalId,
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
      const stored = await findActive(
        database,
        completion.principalId,
        completion.provider,
      );
      if (!stored) throw new Error("Personal integration was not stored");
      return stored;
    },

    async markDisconnected(principalId, provider, now = new Date().toISOString()) {
      const result = await database
        .prepare(
          `UPDATE personal_integration_connections
           SET status = 'disconnected', disconnected_at = ?, updated_at = ?
           WHERE principal_id = ? AND provider = ? AND disconnected_at IS NULL`,
        )
        .bind(now, now, principalId, provider)
        .run();
      return result.meta.changes === 1;
    },

    async markReconnectRequired(connectionId, now = new Date().toISOString()) {
      const result = await database
        .prepare(
          `UPDATE personal_integration_connections
           SET status = 'reconnect_required', updated_at = ?
           WHERE id = ? AND disconnected_at IS NULL`,
        )
        .bind(now, connectionId)
        .run();
      return result.meta.changes === 1;
    },

    async appendAuditEvent({
      connection,
      eventType,
      outcome,
      errorCode,
    }) {
      await database
        .prepare(
          `INSERT INTO personal_integration_audit_events (
            id, connection_id, principal_id, provider, event_type, outcome,
            error_code, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          connection.id,
          connection.principalId,
          connection.provider,
          eventType,
          outcome,
          errorCode ?? null,
          new Date().toISOString(),
        )
        .run();
    },
  };
}
