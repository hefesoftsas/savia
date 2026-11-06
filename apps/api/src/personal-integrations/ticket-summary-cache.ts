import type { TicketSummaryConfig } from "@savia/studio-shared/ticket-summary";
import {
  defaultTicketStatuses,
  ticketSummarySchema,
} from "@savia/studio-shared/ticket-summary";
import type { TicketSummary } from "@savia/studio-shared/ticket-summary";
import { dialectFor } from "@savia/db/dialect";
import { PersonalActionPayloadCipher } from "../assistant/personal-action-payload";
import type { ActivePersonalIntegrationConnection } from "./contracts";
import { PersonalIntegrationUnavailableError } from "./contracts";

const maximumSnapshotsPerPrincipal = 20;
const maximumEncryptedPayloadCharacters = 1_500_000;
const encoder = new TextEncoder();

type TicketSummaryCacheInput = {
  principalId: string;
  jira: ActivePersonalIntegrationConnection;
  github: ActivePersonalIntegrationConnection | null;
  config: TicketSummaryConfig;
  refresh: boolean;
};

type StoredSummary = {
  encrypted_payload: string;
};

type StoredConnection = {
  principal_id: string;
  provider: string;
  nango_connection_id: string;
  nango_integration_id: string;
  external_account_id: string | null;
  status: string;
  disconnected_at: string | null;
  scopes: string;
  jira_privacy_generation: string | null;
  updated_at: string;
};

type ConnectionSnapshot = {
  jiraScopes: string;
  githubScopes: string | null;
  jiraRevision: string;
  githubRevision: string | null;
};

function assertOwnerConnections(input: TicketSummaryCacheInput): void {
  if (
    !input.principalId ||
    input.jira.principalId !== input.principalId ||
    input.jira.provider !== "jira" ||
    input.jira.status !== "connected" ||
    (input.github &&
      (input.github.principalId !== input.principalId ||
        input.github.provider !== "github" ||
        input.github.status !== "connected"))
  )
    throw new PersonalIntegrationUnavailableError();
}

function stableConfig(config: TicketSummaryConfig): TicketSummaryConfig {
  return {
    ...(config.project ? { project: config.project.trim() } : {}),
    statuses: [...(config.statuses ?? defaultTicketStatuses)]
      .map((status) => status.trim())
      .sort((left, right) => left.localeCompare(right)),
  };
}

function matchesScopes(stored: string, expected: string[]): boolean {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return false;
    const scopes = parsed.filter(
      (scope): scope is string => typeof scope === "string",
    );
    return (
      JSON.stringify([...scopes].sort()) ===
      JSON.stringify([...expected].sort())
    );
  } catch {
    return false;
  }
}

async function cacheKey(input: TicketSummaryCacheInput): Promise<string> {
  const fingerprint = {
    version: 1,
    principalId: input.principalId,
    config: stableConfig(input.config),
    jira: {
      id: input.jira.id,
      nangoConnectionId: input.jira.nangoConnectionId,
      nangoIntegrationId: input.jira.nangoIntegrationId,
      externalAccountId: input.jira.externalAccountId,
      scopes: [...input.jira.scopes].sort(),
      privacyGeneration: input.jira.jiraPrivacyGeneration ?? null,
    },
    github: input.github
      ? {
          id: input.github.id,
          nangoConnectionId: input.github.nangoConnectionId,
          nangoIntegrationId: input.github.nangoIntegrationId,
          externalAccountId: input.github.externalAccountId,
          scopes: [...input.github.scopes].sort(),
          privacyGeneration: input.github.jiraPrivacyGeneration ?? null,
        }
      : null,
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(JSON.stringify(fingerprint)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function parseSummary(payload: Record<string, unknown>): TicketSummary | null {
  try {
    const serialized = JSON.stringify(payload.summary);
    if (
      typeof serialized !== "string" ||
      serialized.length > maximumEncryptedPayloadCharacters
    )
      return null;
    const parsed = ticketSummarySchema.safeParse(payload.summary);
    if (!parsed.success || parsed.data.tickets.length > 30) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export class PersonalTicketSummaryCache {
  private readonly inFlight = new Map<string, Promise<TicketSummary>>();

  constructor(
    private readonly database: D1Database,
    private readonly cipher: PersonalActionPayloadCipher,
  ) {}

  async getOrFetch(
    input: TicketSummaryCacheInput,
    fetcher: () => Promise<TicketSummary>,
  ): Promise<TicketSummary> {
    assertOwnerConnections(input);
    const key = await cacheKey(input);
    const snapshot = await this.captureConnections(input);
    if (!input.refresh) {
      const cached = await this.read(input.principalId, key);
      if (cached) return cached;
    }

    const flightKey = `${input.principalId}/${key}/${input.refresh ? "refresh" : "cache"}`;
    const existing = this.inFlight.get(flightKey);
    if (existing) return existing;
    const pending = this.fetchAndStore(input, key, snapshot, fetcher);
    this.inFlight.set(flightKey, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(flightKey) === pending)
        this.inFlight.delete(flightKey);
    }
  }

  private async captureConnections(
    input: TicketSummaryCacheInput,
  ): Promise<ConnectionSnapshot> {
    const read = async (
      connection: ActivePersonalIntegrationConnection,
    ): Promise<StoredConnection> => {
      const row = await this.database
        .prepare(
          `SELECT principal_id, provider, nango_connection_id,
                  nango_integration_id, external_account_id, status,
                  disconnected_at, scopes,
                  jira_privacy_generation, updated_at
           FROM personal_integration_connections WHERE id=?`,
        )
        .bind(connection.id)
        .first<StoredConnection>();
      if (
        !row ||
        row.principal_id !== input.principalId ||
        row.provider !== connection.provider ||
        row.status !== "connected" ||
        row.disconnected_at !== null ||
        row.nango_connection_id !== connection.nangoConnectionId ||
        row.nango_integration_id !== connection.nangoIntegrationId ||
        row.external_account_id !== connection.externalAccountId ||
        !matchesScopes(row.scopes, connection.scopes) ||
        row.jira_privacy_generation !==
          (connection.jiraPrivacyGeneration ?? null)
      )
        throw new PersonalIntegrationUnavailableError();
      return row;
    };
    const jira = await read(input.jira);
    const github = input.github ? await read(input.github) : null;
    return {
      jiraScopes: jira.scopes,
      githubScopes: github?.scopes ?? null,
      jiraRevision: jira.updated_at,
      githubRevision: github?.updated_at ?? null,
    };
  }

  private async read(
    principalId: string,
    key: string,
  ): Promise<TicketSummary | null> {
    const row = await this.database
      .prepare(
        `SELECT encrypted_payload FROM personal_ticket_summary_cache
         WHERE principal_id=? AND cache_key=?`,
      )
      .bind(principalId, key)
      .first<StoredSummary>();
    if (!row) return null;
    let parsed: TicketSummary | null = null;
    try {
      const payload = await this.cipher.unseal({
        actionId: `ticket-summary/${key}`,
        principalId,
        storedInput: { sealedPayload: row.encrypted_payload },
      });
      parsed = parseSummary(payload);
    } catch {
      // A damaged or incompatible encrypted entry is discarded and fetched again.
    }
    if (parsed) return parsed;
    await this.database
      .prepare(
        `DELETE FROM personal_ticket_summary_cache
         WHERE principal_id=? AND cache_key=?`,
      )
      .bind(principalId, key)
      .run();
    return null;
  }

  private async fetchAndStore(
    input: TicketSummaryCacheInput,
    key: string,
    snapshot: ConnectionSnapshot,
    fetcher: () => Promise<TicketSummary>,
  ): Promise<TicketSummary> {
    const fetchStartedAt = `${new Date().toISOString()}|${input.refresh ? "1" : "0"}`;
    const fetched = await fetcher();
    const summary = parseSummary({ summary: fetched });
    if (!summary) throw new PersonalIntegrationUnavailableError();
    const encryptedPayload = await this.cipher.seal({
      actionId: `ticket-summary/${key}`,
      principalId: input.principalId,
      payload: { summary },
    });
    if (encryptedPayload.length > maximumEncryptedPayloadCharacters)
      throw new PersonalIntegrationUnavailableError();
    const nullSafeEqual = dialectFor(this.database).nullSafeEqual;
    const githubGuard = input.github
      ? `AND EXISTS (
           SELECT 1 FROM personal_integration_connections g
           WHERE g.id=? AND g.principal_id=? AND g.provider='github'
             AND g.status='connected' AND g.disconnected_at IS NULL
             AND g.nango_connection_id=? AND g.nango_integration_id=?
             AND g.external_account_id ${nullSafeEqual} ?
             AND g.scopes=?
             AND g.updated_at=?
             AND g.jira_privacy_generation ${nullSafeEqual} ?
         )`
      : "";
    const write = await this.database
      .prepare(
        `INSERT INTO personal_ticket_summary_cache (
           principal_id, cache_key, jira_connection_id, github_connection_id,
           encrypted_payload, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM personal_integration_connections j
           WHERE j.id=? AND j.principal_id=? AND j.provider='jira'
             AND j.status='connected' AND j.disconnected_at IS NULL
             AND j.nango_connection_id=? AND j.nango_integration_id=?
             AND j.external_account_id ${nullSafeEqual} ?
             AND j.scopes=?
             AND j.updated_at=?
             AND j.jira_privacy_generation ${nullSafeEqual} ?
         ) ${githubGuard}
         ON CONFLICT (principal_id, cache_key) DO UPDATE SET
           jira_connection_id=excluded.jira_connection_id,
           github_connection_id=excluded.github_connection_id,
           encrypted_payload=excluded.encrypted_payload,
           updated_at=excluded.updated_at
         WHERE personal_ticket_summary_cache.updated_at < excluded.updated_at`,
      )
      .bind(
        input.principalId,
        key,
        input.jira.id,
        input.github?.id ?? null,
        encryptedPayload,
        fetchStartedAt,
        input.jira.id,
        input.principalId,
        input.jira.nangoConnectionId,
        input.jira.nangoIntegrationId,
        input.jira.externalAccountId,
        snapshot.jiraScopes,
        snapshot.jiraRevision,
        input.jira.jiraPrivacyGeneration ?? null,
        ...(input.github
          ? [
              input.github.id,
              input.principalId,
              input.github.nangoConnectionId,
              input.github.nangoIntegrationId,
              input.github.externalAccountId,
              snapshot.githubScopes,
              snapshot.githubRevision,
              input.github.jiraPrivacyGeneration ?? null,
            ]
          : []),
      )
      .run();
    if (!write.meta.changes) {
      const latest = await this.read(input.principalId, key);
      if (latest) return latest;
      throw new PersonalIntegrationUnavailableError();
    }
    await this.database
      .prepare(
        `DELETE FROM personal_ticket_summary_cache
         WHERE principal_id=? AND cache_key NOT IN (
           SELECT cache_key FROM personal_ticket_summary_cache
           WHERE principal_id=?
           ORDER BY updated_at DESC, cache_key ASC LIMIT ?
         )`,
      )
      .bind(input.principalId, input.principalId, maximumSnapshotsPerPrincipal)
      .run();
    return summary;
  }
}
