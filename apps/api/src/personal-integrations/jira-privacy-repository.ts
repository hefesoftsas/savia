import { PersonalIntegrationInputError } from "./contracts";
import type {
  ActivePersonalIntegrationConnection,
  PersonalIntegrationCompletion,
} from "./contracts";
import type {
  JiraIdentity,
  JiraOperationalConnection,
  JiraPrivacyAccount,
  JiraPrivacyRepository,
  JiraPrivacySnapshot,
  JiraReportLease,
} from "./jira-privacy-contracts";

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
  jira_privacy_generation: string | null;
  created_at: string;
  updated_at: string;
};

type SnapshotRow = {
  generation: string;
  connection_id: string | null;
  principal_id: string | null;
  integration_id: string;
  nango_connection_id: string;
  account_id: string | null;
  retrieved_at: string;
  cleanup_reason: JiraPrivacySnapshot["cleanupReason"];
  cleanup_retry_at: string | null;
};

const REPORT_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;

function assertIdentity(identity: JiraIdentity): void {
  if (
    !/^[A-Za-z0-9:-]{1,128}$/.test(identity.accountId) ||
    identity.accountId === "unknown" ||
    !Number.isFinite(Date.parse(identity.retrievedAt))
  )
    throw new Error("Verified Jira identity is invalid");
}

function connectionFromRow(
  row: ConnectionRow,
): ActivePersonalIntegrationConnection {
  let scopes: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.scopes);
    if (Array.isArray(parsed))
      scopes = parsed.filter(
        (value): value is string => typeof value === "string",
      );
  } catch {
    // Invalid historical scopes are not needed for privacy cleanup.
  }
  return {
    id: row.id,
    principalId: row.principal_id,
    provider: row.provider as ActivePersonalIntegrationConnection["provider"],
    status: row.status as ActivePersonalIntegrationConnection["status"],
    externalAccountLabel: row.external_account_label,
    externalAccountId: row.external_account_id,
    scopes,
    lastValidatedAt: row.last_validated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nangoConnectionId: row.nango_connection_id,
    nangoIntegrationId: row.nango_integration_id,
    jiraPrivacyGeneration: row.jira_privacy_generation,
  };
}

function snapshotFromRow(row: SnapshotRow): JiraPrivacySnapshot {
  return {
    generation: row.generation,
    connectionId: row.connection_id,
    principalId: row.principal_id,
    integrationId: row.integration_id,
    nangoConnectionId: row.nango_connection_id,
    accountId: row.account_id,
    retrievedAt: row.retrieved_at,
    cleanupReason: row.cleanup_reason,
    cleanupRetryAt: row.cleanup_retry_at,
  };
}

function dateAfter(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function minimumTimestamp(left: string, right: string): string {
  return left <= right ? left : right;
}

async function insertOrUpdateAccount(
  database: D1Database,
  integrationId: string,
  accountId: string,
  retrievedAt: string,
  membershipChanged: boolean,
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO jira_privacy_accounts (
        integration_id, account_id, oldest_data_at, version, next_report_at
      ) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(integration_id, account_id) DO UPDATE SET
        oldest_data_at = CASE WHEN jira_privacy_accounts.oldest_data_at <= excluded.oldest_data_at
          THEN jira_privacy_accounts.oldest_data_at ELSE excluded.oldest_data_at END,
        version = jira_privacy_accounts.version + CASE
          WHEN ? = 1 OR jira_privacy_accounts.oldest_data_at > excluded.oldest_data_at
          THEN 1 ELSE 0 END`,
    )
    .bind(
      integrationId,
      accountId,
      retrievedAt,
      dateAfter(retrievedAt, REPORT_PERIOD_MS),
      membershipChanged ? 1 : 0,
    )
    .run();
}

async function upsertSnapshot(
  database: D1Database,
  input: JiraPrivacySnapshot,
): Promise<void> {
  if (input.accountId === null)
    throw new Error(
      "Cleanup-only Jira references cannot enter the account inventory",
    );
  const existing = await database
    .prepare(
      `SELECT generation, connection_id, principal_id, integration_id,
        nango_connection_id, account_id, retrieved_at, cleanup_reason,
        cleanup_retry_at
       FROM jira_privacy_connections
       WHERE integration_id = ? AND nango_connection_id = ?`,
    )
    .bind(input.integrationId, input.nangoConnectionId)
    .first<SnapshotRow>();
  if (existing) {
    if (existing.cleanup_reason !== null)
      throw new PersonalIntegrationInputError(
        "Jira connection is pending privacy cleanup",
      );
    if (existing.account_id !== input.accountId)
      throw new Error(
        "Jira Nango connection identity changed without replacement",
      );
    await database
      .prepare(
        `UPDATE jira_privacy_connections SET
          retrieved_at = ?,
          connection_id = COALESCE(connection_id, ?),
          principal_id = COALESCE(principal_id, ?)
         WHERE generation = ?`,
      )
      .bind(
        minimumTimestamp(existing.retrieved_at, input.retrievedAt),
        input.connectionId,
        input.principalId,
        existing.generation,
      )
      .run();
    await insertOrUpdateAccount(
      database,
      input.integrationId,
      input.accountId,
      input.retrievedAt,
      false,
    );
    return;
  }
  await database
    .prepare(
      `INSERT INTO jira_privacy_connections (
        generation, connection_id, principal_id, integration_id,
        nango_connection_id, account_id, retrieved_at, cleanup_reason,
        cleanup_retry_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.generation,
      input.connectionId,
      input.principalId,
      input.integrationId,
      input.nangoConnectionId,
      input.accountId,
      input.retrievedAt,
      input.cleanupReason,
      input.cleanupRetryAt,
    )
    .run();
  await insertOrUpdateAccount(
    database,
    input.integrationId,
    input.accountId,
    input.retrievedAt,
    true,
  );
}

export function createJiraPrivacyRepository(
  database: D1Database,
): JiraPrivacyRepository {
  return {
    async saveVerifiedConnection(
      completion: PersonalIntegrationCompletion,
      identity,
    ) {
      assertIdentity(identity);
      if (completion.provider !== "jira")
        throw new Error("Jira privacy storage accepts Jira connections only");
      const pendingReference = await database
        .prepare(
          `SELECT 1 FROM jira_privacy_connections WHERE integration_id = ?
           AND nango_connection_id = ? AND cleanup_reason IS NOT NULL LIMIT 1`,
        )
        .bind(completion.nangoIntegrationId, completion.nangoConnectionId)
        .first();
      if (pendingReference)
        throw new PersonalIntegrationInputError(
          "Jira connection is pending privacy cleanup",
        );
      const existing = await database
        .prepare(
          `SELECT * FROM personal_integration_connections
           WHERE principal_id = ? AND provider = 'jira' AND disconnected_at IS NULL
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .bind(completion.principalId)
        .first<ConnectionRow>();
      const connectionId = existing?.id ?? crypto.randomUUID();
      const generation = crypto.randomUUID();
      const now = new Date().toISOString();
      const scopes = JSON.stringify(completion.scopes ?? []);
      const sameIdentity =
        existing &&
        existing.nango_connection_id === completion.nangoConnectionId &&
        existing.external_account_id === identity.accountId;
      const reusedNangoReference =
        existing &&
        existing.nango_connection_id === completion.nangoConnectionId;
      const effectiveGeneration = sameIdentity
        ? (existing.jira_privacy_generation ?? generation)
        : generation;
      const statements: D1PreparedStatement[] = [];

      if (
        existing &&
        !reusedNangoReference &&
        existing.jira_privacy_generation
      ) {
        statements.push(
          database
            .prepare(
              `UPDATE jira_privacy_connections SET cleanup_reason = 'replace', cleanup_retry_at = NULL
             WHERE generation = ? AND integration_id = ? AND nango_connection_id = ?
               AND EXISTS (SELECT 1 FROM personal_integration_connections old
                 WHERE old.id = ? AND old.nango_connection_id = ?
                   AND old.nango_integration_id = ? AND old.disconnected_at IS NULL
                   AND old.jira_privacy_generation = ?)
               AND NOT EXISTS (SELECT 1 FROM jira_privacy_connections pending
                 WHERE pending.integration_id = ? AND pending.nango_connection_id = ?
                   AND pending.cleanup_reason IS NOT NULL)`,
            )
            .bind(
              existing.jira_privacy_generation,
              existing.nango_integration_id,
              existing.nango_connection_id,
              existing.id,
              existing.nango_connection_id,
              existing.nango_integration_id,
              existing.jira_privacy_generation,
              completion.nangoIntegrationId,
              completion.nangoConnectionId,
            ),
        );
      } else if (existing && !reusedNangoReference) {
        const cleanupGeneration = crypto.randomUUID();
        statements.push(
          database
            .prepare(
              `INSERT INTO jira_privacy_connections (
              generation, connection_id, principal_id, integration_id,
              nango_connection_id, account_id, retrieved_at, cleanup_reason
            ) SELECT ?, old.id, old.principal_id, old.nango_integration_id,
                old.nango_connection_id, NULL, old.created_at, 'replace'
              FROM personal_integration_connections old
              WHERE old.id = ? AND old.principal_id = ? AND old.provider = 'jira'
                AND old.nango_connection_id = ? AND old.nango_integration_id = ?
                AND old.status = ? AND old.disconnected_at IS NULL
                AND old.jira_privacy_generation IS NULL
                AND (old.external_account_id = ? OR (old.external_account_id IS NULL AND CAST(? AS TEXT) IS NULL))
                AND NOT EXISTS (SELECT 1 FROM jira_privacy_connections
                  WHERE integration_id = ? AND nango_connection_id = ? AND cleanup_reason IS NOT NULL)
              `,
            )
            .bind(
              cleanupGeneration,
              existing.id,
              existing.principal_id,
              existing.nango_connection_id,
              existing.nango_integration_id,
              existing.status,
              existing.external_account_id,
              existing.external_account_id,
              completion.nangoIntegrationId,
              completion.nangoConnectionId,
            ),
        );
      }
      if (existing) {
        statements.push(
          database
            .prepare(
              `UPDATE personal_integration_connections SET
              nango_connection_id = ?, nango_integration_id = ?, status = ?,
              external_account_label = ?, external_account_id = ?, scopes = ?,
             last_validated_at = ?, disconnected_at = NULL,
             jira_privacy_generation = ?, updated_at = ?
             WHERE id = ? AND nango_connection_id = ? AND nango_integration_id = ?
               AND status = ? AND disconnected_at IS NULL
               AND ((jira_privacy_generation = ?) OR
                 (jira_privacy_generation IS NULL AND CAST(? AS TEXT) IS NULL))
               AND (external_account_id = ? OR
                 (external_account_id IS NULL AND CAST(? AS TEXT) IS NULL))
               AND NOT EXISTS (SELECT 1 FROM jira_privacy_connections
               WHERE integration_id = ? AND nango_connection_id = ? AND cleanup_reason IS NOT NULL)
             `,
            )
            .bind(
              completion.nangoConnectionId,
              completion.nangoIntegrationId,
              completion.status,
              identity.label,
              identity.accountId,
              scopes,
              completion.lastValidatedAt ?? null,
              effectiveGeneration,
              now,
              connectionId,
              existing.nango_connection_id,
              existing.nango_integration_id,
              existing.status,
              existing.jira_privacy_generation,
              existing.jira_privacy_generation,
              existing.external_account_id,
              existing.external_account_id,
              completion.nangoIntegrationId,
              completion.nangoConnectionId,
            ),
        );
      } else {
        statements.push(
          database
            .prepare(
              `INSERT INTO personal_integration_connections (
              id, principal_id, provider, nango_connection_id, nango_integration_id,
              status, external_account_label, external_account_id, scopes,
              last_validated_at, disconnected_at, jira_privacy_generation,
              created_at, updated_at
            ) SELECT ?, ?, 'jira', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?
              WHERE NOT EXISTS (SELECT 1 FROM jira_privacy_connections
                WHERE integration_id = ? AND nango_connection_id = ? AND cleanup_reason IS NOT NULL)
                AND NOT EXISTS (SELECT 1 FROM personal_integration_connections
                  WHERE principal_id = ? AND provider = 'jira' AND disconnected_at IS NULL)`,
            )
            .bind(
              connectionId,
              completion.principalId,
              completion.nangoConnectionId,
              completion.nangoIntegrationId,
              completion.status,
              identity.label,
              identity.accountId,
              scopes,
              completion.lastValidatedAt ?? null,
              effectiveGeneration,
              now,
              now,
              completion.nangoIntegrationId,
              completion.nangoConnectionId,
              completion.principalId,
            ),
        );
      }
      statements.push(
        database
          .prepare(
            `INSERT INTO jira_privacy_connections (
            generation, connection_id, principal_id, integration_id,
            nango_connection_id, account_id, retrieved_at
          ) SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (
            SELECT 1 FROM jira_privacy_connections WHERE integration_id = ?
              AND nango_connection_id = ? AND cleanup_reason IS NOT NULL
          ) AND EXISTS (
            SELECT 1 FROM personal_integration_connections c
             WHERE c.id = ? AND c.jira_privacy_generation = ?
               AND c.nango_connection_id = ? AND c.nango_integration_id = ?
               AND c.external_account_id = ? AND c.disconnected_at IS NULL
          )
          ON CONFLICT(integration_id, nango_connection_id) DO UPDATE SET
            generation = excluded.generation,
            account_id = excluded.account_id,
            retrieved_at = CASE WHEN jira_privacy_connections.account_id = excluded.account_id
              THEN CASE WHEN jira_privacy_connections.retrieved_at <= excluded.retrieved_at
                THEN jira_privacy_connections.retrieved_at ELSE excluded.retrieved_at END
              ELSE excluded.retrieved_at END,
            connection_id = excluded.connection_id,
            principal_id = excluded.principal_id,
            cleanup_reason = NULL, cleanup_retry_at = NULL
          WHERE jira_privacy_connections.cleanup_reason IS NULL`,
          )
          .bind(
            effectiveGeneration,
            connectionId,
            completion.principalId,
            completion.nangoIntegrationId,
            completion.nangoConnectionId,
            identity.accountId,
            identity.retrievedAt,
            completion.nangoIntegrationId,
            completion.nangoConnectionId,
            connectionId,
            effectiveGeneration,
            completion.nangoConnectionId,
            completion.nangoIntegrationId,
            identity.accountId,
          ),
      );
      statements.push(
        database
          .prepare(
            `INSERT INTO jira_privacy_accounts (
            integration_id, account_id, oldest_data_at, version, next_report_at
          ) SELECT ?, ?, ?, 1, ? WHERE EXISTS (
            SELECT 1 FROM jira_privacy_connections WHERE generation = ?
              AND integration_id = ? AND account_id = ?
          )
          ON CONFLICT(integration_id, account_id) DO UPDATE SET
            oldest_data_at = CASE WHEN jira_privacy_accounts.oldest_data_at <= excluded.oldest_data_at
              THEN jira_privacy_accounts.oldest_data_at ELSE excluded.oldest_data_at END,
            version = jira_privacy_accounts.version + CASE
              WHEN ? = 1 OR jira_privacy_accounts.oldest_data_at > excluded.oldest_data_at
              THEN 1 ELSE 0 END`,
          )
          .bind(
            completion.nangoIntegrationId,
            identity.accountId,
            identity.retrievedAt,
            dateAfter(identity.retrievedAt, REPORT_PERIOD_MS),
            effectiveGeneration,
            completion.nangoIntegrationId,
            identity.accountId,
            sameIdentity ? 0 : 1,
          ),
      );
      if (
        existing?.external_account_id &&
        existing.external_account_id !== identity.accountId &&
        reusedNangoReference
      ) {
        statements.push(
          database
            .prepare(
              `UPDATE jira_privacy_accounts SET
              oldest_data_at = (SELECT MIN(retrieved_at) FROM jira_privacy_connections
                WHERE integration_id = ? AND account_id = ?),
              version = version + 1
             WHERE integration_id = ? AND account_id = ? AND EXISTS (
               SELECT 1 FROM jira_privacy_connections WHERE integration_id = ? AND account_id = ?
             )`,
            )
            .bind(
              completion.nangoIntegrationId,
              existing.external_account_id,
              completion.nangoIntegrationId,
              existing.external_account_id,
              completion.nangoIntegrationId,
              existing.external_account_id,
            ),
        );
        statements.push(
          database
            .prepare(
              `DELETE FROM jira_privacy_accounts WHERE integration_id = ? AND account_id = ?
             AND NOT EXISTS (SELECT 1 FROM jira_privacy_connections
               WHERE integration_id = ? AND account_id = ?)`,
            )
            .bind(
              completion.nangoIntegrationId,
              existing.external_account_id,
              completion.nangoIntegrationId,
              existing.external_account_id,
            ),
        );
      }
      await database.batch(statements);
      const stored = await database
        .prepare("SELECT * FROM personal_integration_connections WHERE id = ?")
        .bind(connectionId)
        .first<ConnectionRow>();
      if (
        !stored ||
        stored.jira_privacy_generation !== effectiveGeneration ||
        stored.nango_connection_id !== completion.nangoConnectionId ||
        stored.external_account_id !== identity.accountId
      )
        throw new PersonalIntegrationInputError(
          "Jira connection is pending privacy cleanup",
        );
      return {
        ...connectionFromRow(stored),
        jiraPrivacyGeneration: effectiveGeneration,
      };
    },

    async claimDueReports(integrationId, now) {
      const token = crypto.randomUUID();
      const until = dateAfter(now, LEASE_MS);
      let claimedRows: Array<{
        account_id: string;
        oldest_data_at: string;
        version: number;
      }> = [];
      for (let attempt = 0; attempt < 4 && claimedRows.length < 90; attempt++) {
        const remaining = 90 - claimedRows.length;
        const candidates = await database
          .prepare(
            `SELECT integration_id, account_id, version FROM jira_privacy_accounts
             WHERE integration_id = ? AND next_report_at <= ?
               AND (retry_at IS NULL OR retry_at <= ?)
               AND (lease_until IS NULL OR lease_until <= ?)
               AND pending_erasure IS NULL AND blocked_reason IS NULL
               AND NOT EXISTS (SELECT 1 FROM jira_privacy_integrations i
                 WHERE i.integration_id = ? AND i.cycle_blocked = 1)
             ORDER BY next_report_at, account_id LIMIT ?`,
          )
          .bind(integrationId, now, now, now, integrationId, remaining)
          .all<{
            integration_id: string;
            account_id: string;
            version: number;
          }>();
        if (!candidates.results.length) break;
        await database.batch(
          candidates.results.map((row) =>
            database
              .prepare(
                `UPDATE jira_privacy_accounts SET lease_token = ?, lease_until = ?
               WHERE integration_id = ? AND account_id = ? AND version = ?
                 AND next_report_at <= ? AND (retry_at IS NULL OR retry_at <= ?)
                 AND (lease_until IS NULL OR lease_until <= ?)
                 AND pending_erasure IS NULL AND blocked_reason IS NULL`,
              )
              .bind(
                token,
                until,
                row.integration_id,
                row.account_id,
                row.version,
                now,
                now,
                now,
              ),
          ),
        );
        const claimed = await database
          .prepare(
            `SELECT account_id, oldest_data_at, version FROM jira_privacy_accounts
             WHERE integration_id = ? AND lease_token = ? ORDER BY account_id`,
          )
          .bind(integrationId, token)
          .all<{
            account_id: string;
            oldest_data_at: string;
            version: number;
          }>();
        claimedRows = claimed.results;
      }
      return {
        token,
        integrationId,
        accounts: claimedRows.map((row) => ({
          accountId: row.account_id,
          updatedAt: row.oldest_data_at,
          version: row.version,
        })),
      };
    },

    async acceptReport(lease, now, cycleMs, erasures) {
      if (cycleMs !== null && (!Number.isFinite(cycleMs) || cycleMs <= 0))
        throw new Error("Jira reporting cycle is invalid");
      const statuses = new Map(
        erasures.map((item) => [item.accountId, item.status]),
      );
      const statements: D1PreparedStatement[] = [];
      for (const account of lease.accounts) {
        const erasure = statuses.get(account.accountId);
        if (erasure) {
          statements.push(
            database
              .prepare(
                `UPDATE jira_privacy_connections SET cleanup_reason = ?, cleanup_retry_at = NULL
               WHERE integration_id = ? AND account_id = ?
                 AND EXISTS (SELECT 1 FROM jira_privacy_accounts a
                 WHERE a.integration_id = ? AND a.account_id = ?
                     AND a.lease_token = ?)`,
              )
              .bind(
                erasure,
                lease.integrationId,
                account.accountId,
                lease.integrationId,
                account.accountId,
                lease.token,
              ),
          );
          statements.push(
            database
              .prepare(
                `UPDATE personal_integration_connections SET
                status = 'disconnected', disconnected_at = COALESCE(disconnected_at, ?),
                external_account_id = NULL, external_account_label = NULL,
                jira_privacy_generation = NULL, updated_at = ?
               WHERE jira_privacy_generation IN (
                 SELECT generation FROM jira_privacy_connections
                 WHERE integration_id = ? AND account_id = ? AND cleanup_reason = ?
               )`,
              )
              .bind(now, now, lease.integrationId, account.accountId, erasure),
          );
        }
        statements.push(
          database
            .prepare(
              `UPDATE jira_privacy_accounts SET
              last_reported_at = ?,
              next_report_at = ?,
              retry_at = NULL,
              pending_erasure = ?,
              blocked_reason = ?,
              lease_token = NULL, lease_until = NULL
             WHERE integration_id = ? AND account_id = ? AND lease_token = ?`,
            )
            .bind(
              now,
              cycleMs === null ? now : dateAfter(now, cycleMs),
              erasure ?? null,
              cycleMs === null ? "unsupported-cycle" : null,
              lease.integrationId,
              account.accountId,
              lease.token,
            ),
        );
      }
      if (cycleMs === null) {
        statements.push(
          database
            .prepare(
              `INSERT INTO jira_privacy_integrations (
              integration_id, owner_authorization_required, cycle_blocked
            ) VALUES (?, 0, 1) ON CONFLICT(integration_id) DO UPDATE SET
              cycle_blocked = 1`,
            )
            .bind(lease.integrationId),
        );
      }
      if (statements.length) await database.batch(statements);
    },

    async retryReport(lease, retryAt) {
      if (!lease.accounts.length) return;
      await database.batch(
        lease.accounts.map((account) =>
          database
            .prepare(
              `UPDATE jira_privacy_accounts SET retry_at = ?, lease_token = NULL, lease_until = NULL
             WHERE integration_id = ? AND account_id = ? AND lease_token = ?`,
            )
            .bind(retryAt, lease.integrationId, account.accountId, lease.token),
        ),
      );
    },

    async queueDisconnect(connection, reason, now) {
      const row = await database
        .prepare(
          "SELECT * FROM personal_integration_connections WHERE id = ? AND provider = 'jira'",
        )
        .bind(connection.id)
        .first<ConnectionRow>();
      if (!row) return;
      if (
        connection.jiraPrivacyGeneration &&
        connection.jiraPrivacyGeneration !== row.jira_privacy_generation
      )
        return;
      const generation = row.jira_privacy_generation;
      if (generation) {
        await database.batch([
          database
            .prepare(
              `UPDATE jira_privacy_connections SET cleanup_reason = ?, cleanup_retry_at = NULL
             WHERE generation = ? AND connection_id = ? AND principal_id = ?`,
            )
            .bind(reason, generation, row.id, row.principal_id),
          database
            .prepare(
              `UPDATE personal_integration_connections SET
              status = 'disconnected', disconnected_at = COALESCE(disconnected_at, ?),
              external_account_id = NULL, external_account_label = NULL,
              jira_privacy_generation = NULL, updated_at = ?
             WHERE id = ? AND jira_privacy_generation = ?`,
            )
            .bind(now, now, row.id, generation),
        ]);
      } else {
        const newGeneration = crypto.randomUUID();
        await database.batch([
          database
            .prepare(
              `INSERT INTO jira_privacy_connections (
              generation, connection_id, principal_id, integration_id,
              nango_connection_id, account_id, retrieved_at, cleanup_reason
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
            )
            .bind(
              newGeneration,
              row.id,
              row.principal_id,
              row.nango_integration_id,
              row.nango_connection_id,
              row.created_at,
              reason,
            ),
          database
            .prepare(
              `UPDATE personal_integration_connections SET status = 'disconnected',
              disconnected_at = COALESCE(disconnected_at, ?), external_account_id = NULL,
              external_account_label = NULL, jira_privacy_generation = ?, updated_at = ?
             WHERE id = ? AND nango_connection_id = ? AND jira_privacy_generation IS NULL`,
            )
            .bind(now, newGeneration, now, row.id, row.nango_connection_id),
        ]);
      }
    },

    async listCleanup(now, limit, integrationId) {
      const rows = await database
        .prepare(
          `SELECT generation, connection_id, principal_id, integration_id,
            nango_connection_id, account_id, retrieved_at, cleanup_reason,
            cleanup_retry_at
           FROM jira_privacy_connections WHERE cleanup_reason IS NOT NULL
             AND (cleanup_retry_at IS NULL OR cleanup_retry_at <= ?)
             AND (CAST(? AS TEXT) IS NULL OR integration_id = ?)
           ORDER BY COALESCE(cleanup_retry_at, ''), retrieved_at LIMIT ?`,
        )
        .bind(
          now,
          integrationId ?? null,
          integrationId ?? null,
          Math.max(0, Math.floor(limit)),
        )
        .all<SnapshotRow>();
      return rows.results.map(snapshotFromRow);
    },

    async finishCleanup(snapshot, now) {
      const current = await database
        .prepare(
          `SELECT generation, connection_id, principal_id, integration_id,
            nango_connection_id, account_id, retrieved_at, cleanup_reason,
            cleanup_retry_at FROM jira_privacy_connections WHERE generation = ?`,
        )
        .bind(snapshot.generation)
        .first<SnapshotRow>();
      if (
        !current ||
        current.nango_connection_id !== snapshot.nangoConnectionId
      )
        return;
      const statements: D1PreparedStatement[] = [];
      if (current.connection_id) {
        statements.push(
          database
            .prepare(
              `UPDATE personal_integration_connections SET
              status = 'disconnected', disconnected_at = COALESCE(disconnected_at, ?),
              external_account_id = NULL, external_account_label = NULL,
              jira_privacy_generation = NULL, updated_at = ?
             WHERE id = ? AND jira_privacy_generation = ?`,
            )
            .bind(now, now, current.connection_id, current.generation),
        );
      }
      statements.push(
        database
          .prepare(
            `DELETE FROM jira_privacy_connections WHERE generation = ?
           AND nango_connection_id = ?`,
          )
          .bind(current.generation, current.nango_connection_id),
      );
      if (current.account_id !== null) {
        statements.push(
          database
            .prepare(
              `UPDATE jira_privacy_accounts SET
               oldest_data_at = COALESCE((SELECT MIN(retrieved_at) FROM jira_privacy_connections
                 WHERE integration_id = ? AND account_id = ?), oldest_data_at),
               version = version + 1,
               pending_erasure = CASE WHEN EXISTS (
                 SELECT 1 FROM jira_privacy_connections WHERE integration_id = ? AND account_id = ?
                   AND cleanup_reason IN ('closed', 'updated')
               ) THEN pending_erasure WHEN EXISTS (
                 SELECT 1 FROM jira_privacy_connections WHERE integration_id = ? AND account_id = ?
               ) THEN NULL ELSE pending_erasure END,
               blocked_reason = CASE WHEN NOT EXISTS (
                 SELECT 1 FROM jira_privacy_connections WHERE integration_id = ? AND account_id = ?
               ) THEN NULL ELSE blocked_reason END
             WHERE integration_id = ? AND account_id = ?`,
            )
            .bind(
              current.integration_id,
              current.account_id,
              current.integration_id,
              current.account_id,
              current.integration_id,
              current.account_id,
              current.integration_id,
              current.account_id,
              current.integration_id,
              current.account_id,
            ),
        );
        statements.push(
          database
            .prepare(
              `DELETE FROM jira_privacy_accounts WHERE integration_id = ? AND account_id = ?
             AND NOT EXISTS (SELECT 1 FROM jira_privacy_connections
               WHERE integration_id = ? AND account_id = ?)`,
            )
            .bind(
              current.integration_id,
              current.account_id,
              current.integration_id,
              current.account_id,
            ),
        );
      }
      if (current.connection_id === null) {
        statements.push(
          database
            .prepare(
              `INSERT INTO jira_privacy_integrations (
              integration_id, owner_authorization_required, revoked_reporting_connection_id
            )
             VALUES (?, 1, ?) ON CONFLICT(integration_id) DO UPDATE SET
               owner_authorization_required = 1,
               revoked_reporting_connection_id = excluded.revoked_reporting_connection_id`,
            )
            .bind(current.integration_id, current.nango_connection_id),
        );
      }
      await database.batch(statements);
    },

    async retryCleanup(snapshot, retryAt) {
      await database
        .prepare(
          `UPDATE jira_privacy_connections SET cleanup_retry_at = ?
           WHERE generation = ? AND integration_id = ? AND nango_connection_id = ?
             AND cleanup_reason IS NOT NULL`,
        )
        .bind(
          retryAt,
          snapshot.generation,
          snapshot.integrationId,
          snapshot.nangoConnectionId,
        )
        .run();
    },

    async listUnverifiedJiraConnections(integrationId, limit) {
      const rows = await database
        .prepare(
          `SELECT * FROM personal_integration_connections c
           WHERE c.provider = 'jira' AND c.nango_integration_id = ?
             AND c.disconnected_at IS NULL AND c.jira_privacy_generation IS NULL
             AND NOT EXISTS (SELECT 1 FROM jira_privacy_connections p
               WHERE p.connection_id = c.id AND p.cleanup_reason IS NULL)
           ORDER BY c.created_at LIMIT ?`,
        )
        .bind(integrationId, Math.max(0, Math.floor(limit)))
        .all<ConnectionRow>();
      return rows.results.map(connectionFromRow);
    },

    async recordLegacyIdentity(connection, identity) {
      assertIdentity(identity);
      const current = await database
        .prepare(
          `SELECT * FROM personal_integration_connections WHERE id = ?
           AND provider = 'jira' AND disconnected_at IS NULL`,
        )
        .bind(connection.id)
        .first<ConnectionRow>();
      if (
        !current ||
        current.nango_connection_id !== connection.nangoConnectionId ||
        current.jira_privacy_generation !== null
      )
        return;
      const duplicate = await database
        .prepare(
          `SELECT account_id FROM jira_privacy_connections
          WHERE integration_id = ? AND nango_connection_id = ?`,
        )
        .bind(current.nango_integration_id, current.nango_connection_id)
        .first<{ account_id: string | null }>();
      if (duplicate && duplicate.account_id !== identity.accountId)
        throw new Error(
          "Jira Nango connection identity conflicts with retained data",
        );
      const generation = crypto.randomUUID();
      const retrievedAt = Number.isFinite(Date.parse(connection.createdAt))
        ? connection.createdAt
        : identity.retrievedAt;
      await database.batch([
        database
          .prepare(
            `UPDATE personal_integration_connections SET
            external_account_id = ?, external_account_label = ?,
            jira_privacy_generation = ?, updated_at = ?
           WHERE id = ? AND principal_id = ? AND provider = 'jira'
             AND nango_connection_id = ? AND nango_integration_id = ?
             AND status = ? AND disconnected_at IS NULL
             AND jira_privacy_generation IS NULL
             AND (external_account_id = ? OR (external_account_id IS NULL AND CAST(? AS TEXT) IS NULL))`,
          )
          .bind(
            identity.accountId,
            identity.label,
            generation,
            identity.retrievedAt,
            current.id,
            current.principal_id,
            current.nango_connection_id,
            current.nango_integration_id,
            current.status,
            current.external_account_id,
            current.external_account_id,
          ),
        database
          .prepare(
            `INSERT INTO jira_privacy_connections (
            generation, connection_id, principal_id, integration_id,
            nango_connection_id, account_id, retrieved_at
          ) SELECT ?, c.id, c.principal_id, c.nango_integration_id,
              c.nango_connection_id, ?, ?
            FROM personal_integration_connections c
           WHERE c.id = ? AND c.principal_id = ? AND c.provider = 'jira'
             AND c.nango_connection_id = ? AND c.nango_integration_id = ?
             AND c.status = ? AND c.disconnected_at IS NULL
             AND c.jira_privacy_generation = ? AND c.external_account_id = ?
          ON CONFLICT(integration_id, nango_connection_id) DO UPDATE SET
            generation = excluded.generation,
            retrieved_at = CASE WHEN jira_privacy_connections.retrieved_at <= excluded.retrieved_at
              THEN jira_privacy_connections.retrieved_at ELSE excluded.retrieved_at END,
            connection_id = excluded.connection_id, principal_id = excluded.principal_id,
            cleanup_reason = NULL, cleanup_retry_at = NULL
          WHERE jira_privacy_connections.account_id = excluded.account_id`,
          )
          .bind(
            generation,
            identity.accountId,
            retrievedAt,
            current.id,
            current.principal_id,
            current.nango_connection_id,
            current.nango_integration_id,
            current.status,
            generation,
            identity.accountId,
          ),
        database
          .prepare(
            `INSERT INTO jira_privacy_accounts (
            integration_id, account_id, oldest_data_at, version, next_report_at
          ) SELECT ?, ?, ?, 1, ? WHERE EXISTS (
            SELECT 1 FROM jira_privacy_connections WHERE generation = ?
              AND integration_id = ? AND account_id = ?
          )
          ON CONFLICT(integration_id, account_id) DO UPDATE SET
            oldest_data_at = CASE WHEN jira_privacy_accounts.oldest_data_at <= excluded.oldest_data_at
              THEN jira_privacy_accounts.oldest_data_at ELSE excluded.oldest_data_at END,
            version = jira_privacy_accounts.version + 1`,
          )
          .bind(
            current.nango_integration_id,
            identity.accountId,
            retrievedAt,
            dateAfter(retrievedAt, REPORT_PERIOD_MS),
            generation,
            current.nango_integration_id,
            identity.accountId,
          ),
      ]);
    },

    async recordOperationalIdentity(
      connection: JiraOperationalConnection,
      identity,
    ) {
      assertIdentity(identity);
      await upsertSnapshot(database, {
        generation: crypto.randomUUID(),
        connectionId: null,
        principalId: null,
        integrationId: connection.nangoIntegrationId,
        nangoConnectionId: connection.nangoConnectionId,
        accountId: identity.accountId,
        retrievedAt: identity.retrievedAt,
        cleanupReason: null,
        cleanupRetryAt: null,
      });
      await database
        .prepare(
          `INSERT INTO jira_privacy_integrations (
            integration_id, owner_authorization_required, revoked_reporting_connection_id, cycle_blocked
          )
           VALUES (?, 0, NULL, 0) ON CONFLICT(integration_id) DO UPDATE SET
             owner_authorization_required = 0,
             revoked_reporting_connection_id = NULL,
             reporter_retry_at = NULL`,
        )
        .bind(connection.nangoIntegrationId)
        .run();
    },

    async getOperationalState(integrationId) {
      const cleanup = await database
        .prepare(
          `SELECT COUNT(*) AS count FROM jira_privacy_connections
           WHERE integration_id = ? AND cleanup_reason IS NOT NULL`,
        )
        .bind(integrationId)
        .first<{ count: number }>();
      const backfill = await database
        .prepare(
          `SELECT COUNT(*) AS count FROM personal_integration_connections c
           WHERE c.provider = 'jira' AND c.nango_integration_id = ?
             AND c.disconnected_at IS NULL AND c.jira_privacy_generation IS NULL`,
        )
        .bind(integrationId)
        .first<{ count: number }>();
      const owner = await database
        .prepare(
          `SELECT owner_authorization_required AS count,
            revoked_reporting_connection_id, cycle_blocked, reporter_retry_at
           FROM jira_privacy_integrations
           WHERE integration_id = ?`,
        )
        .bind(integrationId)
        .first<{
          count: number;
          revoked_reporting_connection_id: string | null;
          cycle_blocked: number;
          reporter_retry_at: string | null;
        }>();
      const blocked = await database
        .prepare(
          `SELECT COUNT(*) AS count FROM jira_privacy_accounts
           WHERE integration_id = ? AND blocked_reason IS NOT NULL`,
        )
        .bind(integrationId)
        .first<{ count: number }>();
      return {
        pendingCleanup: Number(cleanup?.count ?? 0),
        pendingBackfill: Number(backfill?.count ?? 0),
        blockedReports:
          Number(blocked?.count ?? 0) + Number(owner?.cycle_blocked ?? 0),
        cycleBlocked: Number(owner?.cycle_blocked ?? 0) === 1,
        ownerAuthorizationRequired: Number(owner?.count ?? 0) === 1,
        revokedReportingConnectionId:
          owner?.revoked_reporting_connection_id ?? null,
        reporterRetryAt: owner?.reporter_retry_at ?? null,
      };
    },

    async clearUnsupportedCycle(integrationId) {
      const blockedAccounts = await database
        .prepare(
          `SELECT account_id, last_reported_at FROM jira_privacy_accounts
           WHERE integration_id = ? AND blocked_reason = 'unsupported-cycle'`,
        )
        .bind(integrationId)
        .all<{ account_id: string; last_reported_at: string | null }>();
      await database.batch([
        database
          .prepare(
            `INSERT INTO jira_privacy_integrations (
            integration_id, owner_authorization_required, revoked_reporting_connection_id, cycle_blocked
          ) VALUES (?, 0, NULL, 0) ON CONFLICT(integration_id) DO UPDATE SET cycle_blocked = 0`,
          )
          .bind(integrationId),
        ...blockedAccounts.results.map((row) =>
          database
            .prepare(
              `UPDATE jira_privacy_accounts SET blocked_reason = NULL,
              next_report_at = ?
             WHERE integration_id = ? AND account_id = ?
               AND blocked_reason = 'unsupported-cycle'`,
            )
            .bind(
              row.last_reported_at
                ? dateAfter(row.last_reported_at, REPORT_PERIOD_MS)
                : new Date().toISOString(),
              integrationId,
              row.account_id,
            ),
        ),
      ]);
    },

    async retryReporter(integrationId, retryAt, authorizationRequired = false) {
      await database
        .prepare(
          `INSERT INTO jira_privacy_integrations (
            integration_id, owner_authorization_required, cycle_blocked, reporter_retry_at
          ) VALUES (?, ?, 0, ?) ON CONFLICT(integration_id) DO UPDATE SET
            reporter_retry_at = excluded.reporter_retry_at,
            owner_authorization_required = CASE WHEN excluded.owner_authorization_required = 1
              THEN 1 ELSE jira_privacy_integrations.owner_authorization_required END`,
        )
        .bind(integrationId, authorizationRequired ? 1 : 0, retryAt)
        .run();
    },
  };
}

export type { JiraPrivacyAccount };
