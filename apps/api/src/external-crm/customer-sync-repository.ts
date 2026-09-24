import type {
  CrmProviderId,
  CustomerCrmObjectKind,
  CustomerCrmSyncRecord,
  CustomerCrmSyncRecordInput,
  CustomerCrmSyncRepository,
} from "./contracts";

type CustomerCrmSyncRecordRow = {
  agency_id: number;
  principal_id: string;
  customer_profile_id: number;
  provider: CrmProviderId;
  object_kind: CustomerCrmObjectKind;
  external_object_id: string;
  last_synced_at: string | null;
  last_failure_code: string | null;
  last_failure_at: string | null;
};

function recordFromRow(row: CustomerCrmSyncRecordRow): CustomerCrmSyncRecord {
  return {
    agencyId: row.agency_id,
    principalId: row.principal_id,
    customerProfileId: row.customer_profile_id,
    provider: row.provider,
    objectKind: row.object_kind,
    externalObjectId: row.external_object_id,
    lastSyncedAt: row.last_synced_at,
    lastFailureCode: row.last_failure_code,
    lastFailureAt: row.last_failure_at,
  };
}

export function createCustomerCrmSyncRepository(
  db: D1Database,
): CustomerCrmSyncRepository {
  return {
    async find(agencyId, customerProfileId, provider, objectKind, principalId) {
      const row = await db
        .prepare(
          `SELECT * FROM customer_crm_sync_records
           WHERE agency_id = ? AND customer_profile_id = ? AND provider = ? AND object_kind = ? AND principal_id = ?`,
        )
        .bind(agencyId, customerProfileId, provider, objectKind, principalId)
        .first<CustomerCrmSyncRecordRow>();
      return row ? recordFromRow(row) : undefined;
    },

    async listByCustomerIds(
      agencyId,
      customerProfileIds,
      provider,
      principalId,
    ) {
      const ids = [...new Set(customerProfileIds)];
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(", ");
      const rows = await db
        .prepare(
          `SELECT * FROM customer_crm_sync_records
           WHERE agency_id = ? AND provider = ? AND principal_id = ? AND customer_profile_id IN (${placeholders})`,
        )
        .bind(agencyId, provider, principalId, ...ids)
        .all<CustomerCrmSyncRecordRow>();
      return rows.results.map(recordFromRow);
    },

    async upsertSuccess(input) {
      const now = new Date().toISOString();
      await db
        .prepare(
          `INSERT INTO customer_crm_sync_records (
            principal_id, agency_id, customer_profile_id, provider, object_kind,
            external_object_id, last_synced_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(principal_id, agency_id, customer_profile_id, provider, object_kind)
          DO UPDATE SET
            external_object_id = excluded.external_object_id,
            last_synced_at = excluded.last_synced_at,
            last_failure_code = NULL,
            last_failure_at = NULL,
            updated_at = excluded.updated_at`,
        )
        .bind(
          input.principalId,
          input.agencyId,
          input.customerProfileId,
          input.provider,
          input.objectKind,
          input.externalObjectId,
          now,
          now,
          now,
        )
        .run();
    },

    async recordFailure(input) {
      const now = new Date().toISOString();
      const result = await db
        .prepare(
          `UPDATE customer_crm_sync_records
           SET last_failure_code = ?, last_failure_at = ?, updated_at = ?
           WHERE agency_id = ? AND customer_profile_id = ? AND provider = ? AND object_kind = ? AND principal_id = ?`,
        )
        .bind(
          input.failureCode,
          now,
          now,
          input.agencyId,
          input.customerProfileId,
          input.provider,
          input.objectKind,
          input.principalId,
        )
        .run();
      return result.meta.changes === 1;
    },
  };
}
