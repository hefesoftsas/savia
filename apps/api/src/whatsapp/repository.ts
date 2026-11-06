import {
  type ActiveWhatsappConnection,
  type WhatsappConnection,
  type WhatsappConnectionCompletion,
  type WhatsappConnectionStatus,
  type WhatsappNumberUpdate,
  whatsappConnectionStatuses,
  WhatsappConnectionAlreadyAssignedError,
  WhatsappOrganizationConnectionExistsError,
} from "./contracts";

type WhatsappConnectionRow = {
  id: string;
  tenant_id?: number;
  agency_id?: number;
  created_by_principal_id: string;
  nango_connection_id: string;
  nango_integration_id: string;
  status: string;
  phone_number_id: string | null;
  display_phone_number: string | null;
  waba_id: string | null;
  external_account_label: string | null;
  last_validated_at: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
};

function statusFromRow(value: string): WhatsappConnectionStatus {
  if (whatsappConnectionStatuses.includes(value as WhatsappConnectionStatus))
    return value as WhatsappConnectionStatus;
  throw new Error("Stored WhatsApp connection status is invalid");
}

function connectionFromRow(
  row: WhatsappConnectionRow,
): ActiveWhatsappConnection {
  const tenantId = row.tenant_id ?? row.agency_id ?? 0;
  return {
    id: row.id,
    agencyId: tenantId,
    tenantId,
    provider: "whatsapp",
    status: statusFromRow(row.status),
    phoneNumberId: row.phone_number_id,
    displayPhoneNumber: row.display_phone_number,
    wabaId: row.waba_id,
    externalAccountLabel: row.external_account_label,
    lastValidatedAt: row.last_validated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nangoConnectionId: row.nango_connection_id,
    nangoIntegrationId: row.nango_integration_id,
  };
}

function publicConnection(row: WhatsappConnectionRow): WhatsappConnection {
  const {
    nangoConnectionId: _nangoConnectionId,
    nangoIntegrationId: _nangoIntegrationId,
    ...connection
  } = connectionFromRow(row);
  return connection;
}

function uniqueConflict(error: unknown): "organization" | "nango" | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const constraint = Reflect.get(current, "constraint");
    const message = String(Reflect.get(current, "message") ?? "");
    if (
      constraint === "tenant_whatsapp_connections_nango_active_unique" ||
      message.includes("tenant_whatsapp_connections_nango_active_unique") ||
      message.includes(
        "UNIQUE constraint failed: tenant_whatsapp_connections.nango_integration_id, tenant_whatsapp_connections.nango_connection_id",
      )
    )
      return "nango";
    if (
      constraint === "tenant_whatsapp_connections_tenant_active_unique" ||
      message.includes("tenant_whatsapp_connections_tenant_active_unique") ||
      message.includes(
        "UNIQUE constraint failed: tenant_whatsapp_connections.tenant_id",
      )
    )
      return "organization";
    current = Reflect.get(current, "cause");
  }
  return undefined;
}

async function findActiveConnection(
  db: D1Database,
  agencyId: number,
  principalId: string,
): Promise<ActiveWhatsappConnection | undefined> {
  const row = await db
    .prepare(
      `SELECT * FROM tenant_whatsapp_connections
       WHERE tenant_id = ? AND created_by_principal_id = ? AND disconnected_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(agencyId, principalId)
    .first<WhatsappConnectionRow>();
  return row ? connectionFromRow(row) : undefined;
}

export function createWhatsappRepository(db: D1Database) {
  return {
    async listConnections(agencyId: number, principalId: string) {
      const rows = await db
        .prepare(
          `SELECT * FROM tenant_whatsapp_connections
           WHERE tenant_id = ? AND created_by_principal_id = ? AND disconnected_at IS NULL
           ORDER BY created_at DESC`,
        )
        .bind(agencyId, principalId)
        .all<WhatsappConnectionRow>();
      return rows.results.map(publicConnection);
    },

    async findActiveConnection(agencyId: number, principalId: string) {
      return findActiveConnection(db, agencyId, principalId);
    },

    async saveConnection(completion: WhatsappConnectionCompletion) {
      const now = new Date().toISOString();
      const current = await findActiveConnection(
        db,
        completion.agencyId,
        completion.actor.principal.id,
      );
      if (
        current &&
        (current.nangoConnectionId !== completion.nangoConnectionId ||
          current.nangoIntegrationId !== completion.nangoIntegrationId)
      ) {
        const occupied = await db
          .prepare(
            `SELECT id FROM tenant_whatsapp_connections
             WHERE nango_integration_id = ? AND nango_connection_id = ? AND disconnected_at IS NULL
             LIMIT 1`,
          )
          .bind(completion.nangoIntegrationId, completion.nangoConnectionId)
          .first<{ id: string }>();
        if (occupied && occupied.id !== current.id)
          throw new WhatsappConnectionAlreadyAssignedError();
      }
      if (!current) {
        const occupied = await db
          .prepare(
            `SELECT id FROM tenant_whatsapp_connections
             WHERE nango_integration_id = ? AND nango_connection_id = ? AND disconnected_at IS NULL
             LIMIT 1`,
          )
          .bind(completion.nangoIntegrationId, completion.nangoConnectionId)
          .first<{ id: string }>();
        if (occupied) throw new WhatsappConnectionAlreadyAssignedError();
        const owned = await db
          .prepare(
            `SELECT id FROM tenant_whatsapp_connections
             WHERE tenant_id = ? AND disconnected_at IS NULL
             LIMIT 1`,
          )
          .bind(completion.agencyId)
          .first<{ id: string }>();
        if (owned) throw new WhatsappOrganizationConnectionExistsError();
      }
      const connectionId = current?.id ?? crypto.randomUUID();
      try {
        if (current) {
          const result = await db
            .prepare(
              `UPDATE tenant_whatsapp_connections
               SET nango_connection_id = ?, nango_integration_id = ?, status = ?,
                 phone_number_id = ?, display_phone_number = ?, waba_id = ?,
                 external_account_label = ?, last_validated_at = ?, updated_at = ?
               WHERE id = ? AND created_by_principal_id = ? AND disconnected_at IS NULL`,
            )
            .bind(
              completion.nangoConnectionId,
              completion.nangoIntegrationId,
              completion.status,
              completion.phoneNumberId ?? null,
              completion.displayPhoneNumber ?? null,
              completion.wabaId ?? null,
              completion.externalAccountLabel ?? null,
              completion.lastValidatedAt ?? null,
              now,
              connectionId,
              completion.actor.principal.id,
            )
            .run();
          if (result.meta.changes !== 1)
            throw new WhatsappOrganizationConnectionExistsError();
        } else {
          await db
            .prepare(
              `INSERT INTO tenant_whatsapp_connections (
                id, tenant_id, created_by_principal_id,
                nango_connection_id, nango_integration_id, status,
                phone_number_id, display_phone_number, waba_id,
                external_account_label, last_validated_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              connectionId,
              completion.agencyId,
              completion.actor.principal.id,
              completion.nangoConnectionId,
              completion.nangoIntegrationId,
              completion.status,
              completion.phoneNumberId ?? null,
              completion.displayPhoneNumber ?? null,
              completion.wabaId ?? null,
              completion.externalAccountLabel ?? null,
              completion.lastValidatedAt ?? null,
              now,
              now,
            )
            .run();
        }
      } catch (error) {
        if (
          error instanceof WhatsappOrganizationConnectionExistsError ||
          error instanceof WhatsappConnectionAlreadyAssignedError
        )
          throw error;
        const conflict = uniqueConflict(error);
        if (conflict === "nango")
          throw new WhatsappConnectionAlreadyAssignedError();
        if (conflict === "organization")
          throw new WhatsappOrganizationConnectionExistsError();
        throw error;
      }
      const stored = await findActiveConnection(
        db,
        completion.agencyId,
        completion.actor.principal.id,
      );
      if (!stored) throw new Error("The WhatsApp connection was not stored");
      return stored;
    },

    async markDisconnected(
      agencyId: number,
      principalId: string,
      now = new Date().toISOString(),
    ) {
      const result = await db
        .prepare(
          `UPDATE tenant_whatsapp_connections
           SET status = 'disconnected', disconnected_at = ?, updated_at = ?
           WHERE tenant_id = ? AND created_by_principal_id = ? AND disconnected_at IS NULL`,
        )
        .bind(now, now, agencyId, principalId)
        .run();
      return result.meta.changes === 1;
    },

    async markReconnectRequired(
      connectionId: string,
      principalId: string,
      now = new Date().toISOString(),
    ) {
      const result = await db
        .prepare(
          `UPDATE tenant_whatsapp_connections
           SET status = 'reconnect_required', updated_at = ?
           WHERE id = ? AND created_by_principal_id = ? AND disconnected_at IS NULL`,
        )
        .bind(now, connectionId, principalId)
        .run();
      return result.meta.changes === 1;
    },

    async updateNumber(update: WhatsappNumberUpdate) {
      const now = new Date().toISOString();
      const result = await db
        .prepare(
          `UPDATE tenant_whatsapp_connections
           SET phone_number_id = ?, display_phone_number = ?, waba_id = ?,
             external_account_label = ?, last_validated_at = ?, updated_at = ?
           WHERE tenant_id = ? AND created_by_principal_id = ? AND disconnected_at IS NULL`,
        )
        .bind(
          update.phoneNumberId,
          update.displayPhoneNumber ?? null,
          update.wabaId ?? null,
          update.externalAccountLabel ?? null,
          update.lastValidatedAt ?? now,
          now,
          update.agencyId,
          update.principalId,
        )
        .run();
      if (result.meta.changes !== 1) return undefined;
      return findActiveConnection(db, update.agencyId, update.principalId);
    },
  };
}
