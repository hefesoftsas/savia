import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalActionPayloadCipher } from "../src/assistant/personal-action-payload";
import type { ActivePersonalIntegrationConnection } from "../src/personal-integrations/contracts";
import { PersonalTicketSummaryCache } from "../src/personal-integrations/ticket-summary-cache";
import type { TicketSummary } from "@savia/studio-shared/ticket-summary";
import postgresManifest from "../../../packages/db/postgres/manifest.json";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

function migrationStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

async function applyMigrations() {
  for (const migration of migrationSqls) {
    for (const statement of migrationStatements(migration)) {
      await env.DB.exec(statement);
    }
  }
}

const principalId = "ticket-cache-principal";
const jiraId = "ticket-cache-jira";
const githubId = "ticket-cache-github";
const scopes = ["read:jira-work"];

function connection(
  provider: "jira" | "github",
  owner = principalId,
): ActivePersonalIntegrationConnection {
  const id =
    owner === principalId
      ? provider === "jira"
        ? jiraId
        : githubId
      : `${provider}-connection-${owner}`;
  return {
    id,
    principalId: owner,
    provider,
    status: "connected",
    externalAccountLabel: null,
    scopes: provider === "jira" ? scopes : ["repo"],
    lastValidatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    externalAccountId: null,
    nangoConnectionId: `${provider}-nango-${id}`,
    nangoIntegrationId: `${provider}-integration`,
    jiraPrivacyGeneration: provider === "jira" ? "privacy-generation-1" : null,
  };
}

const summary = (updatedAt: string): TicketSummary => ({
  updatedAt,
  tickets: [
    {
      key: "OPS-1",
      title: "Private ticket title",
      url: "https://example.atlassian.net/browse/OPS-1",
      status: "In Progress",
      comments: {
        total: 1,
        latest: {
          author: "Ari",
          body: "Private ticket comment",
          createdAt: "2026-10-01T12:00:00.000Z",
          url: "https://example.atlassian.net/browse/OPS-1?focusedCommentId=1",
        },
      },
      pullRequests: [],
      prLookup: "complete",
    },
  ],
  partial: false,
  warnings: [],
});

async function seedConnections(owner = principalId) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal
     (id, issuer, subject, email, display_name, is_active, created_at, updated_at)
     VALUES (?, 'test', ?, ?, 'Ticket Cache', 1, 'now', 'now')`,
  )
    .bind(owner, owner, `${owner}@example.test`)
    .run();
  for (const provider of ["jira", "github"] as const) {
    const item = connection(provider, owner);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO personal_integration_connections
       (id, principal_id, provider, nango_connection_id, nango_integration_id,
        status, scopes, jira_privacy_generation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'connected', ?, ?, 'now', 'now')`,
    )
      .bind(
        item.id,
        item.principalId,
        item.provider,
        item.nangoConnectionId,
        item.nangoIntegrationId,
        JSON.stringify(item.scopes),
        item.jiraPrivacyGeneration ?? null,
      )
      .run();
  }
}

function cache() {
  return new PersonalTicketSummaryCache(
    env.DB,
    new PersonalActionPayloadCipher("ticket-cache-test-secret"),
  );
}

async function read(input: {
  config?: { project?: string; statuses?: string[] };
  refresh?: boolean;
  jira?: ActivePersonalIntegrationConnection;
  github?: ActivePersonalIntegrationConnection | null;
}) {
  return cache().getOrFetch(
    {
      principalId,
      jira: input.jira ?? connection("jira"),
      github: input.github === undefined ? connection("github") : input.github,
      config: input.config ?? { project: "OPS" },
      refresh: input.refresh ?? false,
    },
    async () => summary("2026-10-05T12:00:00.000Z"),
  );
}

describe("personal ticket summary cache", () => {
  beforeAll(applyMigrations);

  beforeEach(async () => {
    await env.DB.exec(
      `DELETE FROM personal_ticket_summary_cache;
       DELETE FROM personal_integration_connections WHERE principal_id IN ('${principalId}', 'another-owner');
       DELETE FROM identity_principal WHERE id IN ('${principalId}', 'another-owner');`,
    );
    await seedConnections();
  });

  it("keeps its SQLite schema aligned with the PostgreSQL inventory", async () => {
    const inventory = postgresManifest.tables.find(
      (table) => table.name === "personal_ticket_summary_cache",
    );
    expect(inventory).toBeDefined();
    const columns = await env.DB.prepare(
      "PRAGMA table_info(personal_ticket_summary_cache)",
    ).all();
    expect(columns.results).toEqual(inventory?.columns);
    const foreignKeys = await env.DB.prepare(
      "PRAGMA foreign_key_list(personal_ticket_summary_cache)",
    ).all();
    expect(
      foreignKeys.results.map(
        ({ id, seq, table, from, to, on_update, on_delete, match }) => ({
          id,
          seq,
          table,
          from,
          to,
          on_update,
          on_delete,
          match,
        }),
      ),
    ).toEqual(inventory?.foreignKeys);
    const indexes = await env.DB.prepare(
      "PRAGMA index_list(personal_ticket_summary_cache)",
    ).all<{ name: string }>();
    expect(indexes.results.map(({ name }) => name)).toContain(
      "personal_ticket_summary_cache_updated_at_index",
    );
  });

  it("stores an encrypted snapshot and reuses it across cache instances", async () => {
    const first = cache();
    const expected = summary("2026-10-05T12:00:00.000Z");
    const fetched = await first.getOrFetch(
      {
        principalId,
        jira: connection("jira"),
        github: connection("github"),
        config: { project: "OPS" },
        refresh: false,
      },
      async () => expected,
    );
    let fetchCount = 0;
    const reopened = await cache().getOrFetch(
      {
        principalId,
        jira: connection("jira"),
        github: connection("github"),
        config: { project: "OPS" },
        refresh: false,
      },
      async () => {
        fetchCount += 1;
        return summary("should-not-be-fetched");
      },
    );

    expect(fetched).toEqual(expected);
    expect(reopened).toEqual(expected);
    expect(fetchCount).toBe(0);
    const stored = await env.DB.prepare(
      "SELECT encrypted_payload FROM personal_ticket_summary_cache WHERE principal_id=?",
    )
      .bind(principalId)
      .first<{ encrypted_payload: string }>();
    expect(stored?.encrypted_payload).not.toContain("Private ticket title");
    expect(stored?.encrypted_payload).not.toContain("Private ticket comment");
  });

  it("accepts equivalent stored scopes JSON with different whitespace", async () => {
    await env.DB.prepare(
      "UPDATE personal_integration_connections SET scopes='[ \"read:jira-work\" ]' WHERE id=?",
    )
      .bind(jiraId)
      .run();
    const result = await read({});
    expect(result.updatedAt).toBe("2026-10-05T12:00:00.000Z");
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM personal_ticket_summary_cache WHERE principal_id=?",
      )
        .bind(principalId)
        .first<{ count: number }>(),
    ).toMatchObject({ count: 1 });
  });

  it("purges and separates snapshots when a provider account identity changes", async () => {
    await read({});
    await env.DB.prepare(
      "UPDATE personal_integration_connections SET external_account_id='new-jira-account' WHERE id=?",
    )
      .bind(jiraId)
      .run();
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM personal_ticket_summary_cache WHERE principal_id=?",
      )
        .bind(principalId)
        .first<{ count: number }>(),
    ).toMatchObject({ count: 0 });

    const next = await cache().getOrFetch(
      {
        principalId,
        jira: { ...connection("jira"), externalAccountId: "new-jira-account" },
        github: connection("github"),
        config: { project: "OPS" },
        refresh: false,
      },
      async () => summary("new-account-snapshot"),
    );
    expect(next.updatedAt).toBe("new-account-snapshot");
  });

  it("refreshes the stored snapshot only after a successful fetch", async () => {
    await read({});
    const replacement = summary("2026-10-05T13:00:00.000Z");
    const refreshed = await cache().getOrFetch(
      {
        principalId,
        jira: connection("jira"),
        github: connection("github"),
        config: { project: "OPS" },
        refresh: true,
      },
      async () => replacement,
    );
    const afterRefresh = await read({});

    expect(refreshed).toEqual(replacement);
    expect(afterRefresh).toEqual(replacement);
    await expect(
      cache().getOrFetch(
        {
          principalId,
          jira: connection("jira"),
          github: connection("github"),
          config: { project: "OPS" },
          refresh: true,
        },
        async () => {
          throw new Error("provider unavailable");
        },
      ),
    ).rejects.toThrow("provider unavailable");
    expect(await read({})).toEqual(replacement);
  });

  it("keeps no more than twenty snapshots per principal", async () => {
    const instance = cache();
    for (let index = 0; index < 21; index += 1) {
      await instance.getOrFetch(
        {
          principalId,
          jira: connection("jira"),
          github: connection("github"),
          config: { project: `OPS${index}` },
          refresh: false,
        },
        async () => summary(`snapshot-${index}`),
      );
    }
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM personal_ticket_summary_cache WHERE principal_id=?",
      )
        .bind(principalId)
        .first<{ count: number }>(),
    ).toMatchObject({ count: 20 });
  });

  it("separates snapshots by owner, config, provider selection, and connection identity", async () => {
    let calls = 0;
    const first = cache();
    await seedConnections("another-owner");
    const get = (
      owner: string,
      config: { project?: string },
      withGithub: boolean,
      jira = connection("jira", owner),
    ) =>
      first.getOrFetch(
        {
          principalId: owner,
          jira,
          github: withGithub ? connection("github", owner) : null,
          config,
          refresh: false,
        },
        async () => {
          calls += 1;
          return summary(`fetch-${calls}`);
        },
      );

    const base = await get(principalId, { project: "OPS" }, true);
    expect(await get(principalId, { project: "OPS" }, true)).toEqual(base);
    expect(await get(principalId, { project: "FIN" }, true)).not.toEqual(base);
    expect(await get(principalId, { project: "OPS" }, false)).not.toEqual(base);
    await env.DB.prepare(
      "UPDATE personal_integration_connections SET nango_connection_id='replacement-jira-nango' WHERE id=?",
    )
      .bind(jiraId)
      .run();
    expect(
      await get(principalId, { project: "OPS" }, true, {
        ...connection("jira"),
        nangoConnectionId: "replacement-jira-nango",
      }),
    ).not.toEqual(base);
    expect(await get("another-owner", { project: "OPS" }, true)).not.toEqual(
      base,
    );
    expect(calls).toBe(5);
  });

  it("rejects cross-owner connection input and removes snapshots after connection revocation", async () => {
    const saved = await read({});
    const otherOwnerJira = {
      ...connection("jira"),
      principalId: "another-owner",
    };
    await expect(
      cache().getOrFetch(
        {
          principalId,
          jira: otherOwnerJira,
          github: connection("github"),
          config: { project: "OPS" },
          refresh: false,
        },
        async () => summary("should-not-run"),
      ),
    ).rejects.toThrow();

    await env.DB.prepare(
      "UPDATE personal_integration_connections SET status='reconnect_required', disconnected_at='now', jira_privacy_generation=NULL WHERE id=?",
    )
      .bind(jiraId)
      .run();
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM personal_ticket_summary_cache WHERE principal_id=?",
      )
        .bind(principalId)
        .first<{ count: number }>(),
    ).toMatchObject({ count: 0 });

    await expect(
      cache().getOrFetch(
        {
          principalId,
          jira: { ...connection("jira"), status: "reconnect_required" },
          github: connection("github"),
          config: { project: "OPS" },
          refresh: false,
        },
        async () => summary("after-revoke"),
      ),
    ).rejects.toThrow();
    expect(saved.updatedAt).toBe("2026-10-05T12:00:00.000Z");
  });

  it("does not persist a fetch that completes after the connection was revoked", async () => {
    let finishFetch!: (value: TicketSummary) => void;
    let started!: () => void;
    const fetchStarted = new Promise<void>((resolve) => (started = resolve));
    const pendingFetch = cache().getOrFetch(
      {
        principalId,
        jira: connection("jira"),
        github: connection("github"),
        config: { project: "OPS" },
        refresh: false,
      },
      () =>
        new Promise<TicketSummary>((resolve) => {
          finishFetch = resolve;
          started();
        }),
    );
    await fetchStarted;
    await env.DB.prepare(
      "UPDATE personal_integration_connections SET status='disconnected', disconnected_at='now' WHERE id=?",
    )
      .bind(jiraId)
      .run();
    finishFetch(summary("fetched-before-revoke-check"));

    await expect(pendingFetch).rejects.toThrow();
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM personal_ticket_summary_cache WHERE principal_id=?",
      )
        .bind(principalId)
        .first<{ count: number }>(),
    ).toMatchObject({ count: 0 });
  });

  it("does not persist a fetch after provider account identity changes", async () => {
    let finishFetch!: (value: TicketSummary) => void;
    let started!: () => void;
    const fetchStarted = new Promise<void>((resolve) => (started = resolve));
    const pendingFetch = cache().getOrFetch(
      {
        principalId,
        jira: connection("jira"),
        github: connection("github"),
        config: { project: "OPS" },
        refresh: false,
      },
      () =>
        new Promise<TicketSummary>((resolve) => {
          finishFetch = resolve;
          started();
        }),
    );
    await fetchStarted;
    await env.DB.prepare(
      "UPDATE personal_integration_connections SET external_account_id='changed-during-fetch' WHERE id=?",
    )
      .bind(jiraId)
      .run();
    finishFetch(summary("fetched-before-identity-check"));

    await expect(pendingFetch).rejects.toThrow();
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM personal_ticket_summary_cache WHERE principal_id=?",
      )
        .bind(principalId)
        .first<{ count: number }>(),
    ).toMatchObject({ count: 0 });
  });

  it("preserves a newer refresh when an older fetch finishes afterward", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T13:30:00.000Z"));
    try {
      let finishOlderFetch!: (value: TicketSummary) => void;
      let started!: () => void;
      const fetchStarted = new Promise<void>((resolve) => (started = resolve));
      const olderRequest = cache().getOrFetch(
        {
          principalId,
          jira: connection("jira"),
          github: connection("github"),
          config: { project: "OPS" },
          refresh: false,
        },
        () =>
          new Promise<TicketSummary>((resolve) => {
            finishOlderFetch = resolve;
            started();
          }),
      );
      await fetchStarted;

      const refreshed = await cache().getOrFetch(
        {
          principalId,
          jira: connection("jira"),
          github: connection("github"),
          config: { project: "OPS" },
          refresh: true,
        },
        async () => summary("newer-refresh"),
      );
      finishOlderFetch(summary("older-fetch"));
      await expect(olderRequest).resolves.toEqual(refreshed);

      expect(await read({})).toEqual(refreshed);
      expect(refreshed.updatedAt).toBe("newer-refresh");
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds ciphertext to its cache key and principal", async () => {
    const expected = await read({});
    const wrongOwnerCipher = new PersonalActionPayloadCipher(
      "ticket-cache-test-secret",
    );
    const first = await env.DB.prepare(
      "SELECT cache_key, encrypted_payload FROM personal_ticket_summary_cache WHERE principal_id=?",
    )
      .bind(principalId)
      .first<{ cache_key: string; encrypted_payload: string }>();
    expect(first).not.toBeNull();
    await expect(
      wrongOwnerCipher.unseal({
        actionId: `ticket-summary/${first!.cache_key}`,
        principalId: "another-owner",
        storedInput: { sealedPayload: first!.encrypted_payload },
      }),
    ).rejects.toThrow();
    expect(expected.tickets[0]?.title).toBe("Private ticket title");
  });
});
