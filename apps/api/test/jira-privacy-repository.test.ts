import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createJiraPrivacyRepository } from "../src/personal-integrations/jira-privacy-repository";
import type { JiraIdentity } from "../src/personal-integrations/jira-privacy-contracts";

const migrations = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

async function applyMigrations() {
  for (const migration of migrations)
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((value) =>
        value
          .replace(/^--.*$/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean))
      await env.DB.exec(statement);
}

async function seedPrincipal(id: string) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal
    (id,issuer,subject,email,display_name,is_active,created_at,updated_at)
    VALUES (?, 'test', ?, ?, ?, 1, ?, ?)`,
  )
    .bind(
      id,
      id,
      `${id}@example.test`,
      id,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    )
    .run();
}

function completion(principalId: string, nangoConnectionId: string) {
  return {
    principalId,
    provider: "jira" as const,
    nangoConnectionId,
    nangoIntegrationId: "jira",
    status: "connected" as const,
    externalAccountId: "untrusted-metadata-id",
    externalAccountLabel: "untrusted label",
    scopes: ["read:jira-work"],
  };
}

const identity = (accountId: string, retrievedAt: string, label = "Verified") =>
  ({ accountId, retrievedAt, label }) satisfies JiraIdentity;

describe("Jira privacy repository", () => {
  beforeAll(applyMigrations);
  beforeEach(async () => {
    await env.DB.exec(`DELETE FROM jira_privacy_connections;
      DELETE FROM jira_privacy_accounts;
      DELETE FROM personal_integration_connections;
      DELETE FROM identity_principal WHERE id LIKE 'jira-privacy-%';`);
  });

  it("deduplicates shared accounts and keeps the oldest retained-data time", async () => {
    await seedPrincipal("jira-privacy-one");
    await seedPrincipal("jira-privacy-two");
    const repository = createJiraPrivacyRepository(env.DB);
    await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "nango-one"),
      identity("acct-shared", "2026-03-01T00:00:00.000Z"),
    );
    await repository.saveVerifiedConnection(
      completion("jira-privacy-two", "nango-two"),
      identity("acct-shared", "2026-01-01T00:00:00.000Z"),
    );

    const lease = await repository.claimDueReports(
      "jira",
      "2026-07-01T00:00:00.000Z",
    );
    expect(lease.accounts).toEqual([
      expect.objectContaining({
        accountId: "acct-shared",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);
  });

  it("claims at most 90 accounts and does not overlap concurrent claims", async () => {
    await seedPrincipal("jira-privacy-one");
    const repository = createJiraPrivacyRepository(env.DB);
    for (let index = 0; index < 91; index++)
      await repository.saveVerifiedConnection(
        completion("jira-privacy-one", `nango-${index}`),
        identity(`acct-${index}`, "2026-01-01T00:00:00.000Z"),
      );
    const [first, second] = await Promise.all([
      repository.claimDueReports("jira", "2026-07-01T00:00:00.000Z"),
      repository.claimDueReports("jira", "2026-07-01T00:00:00.000Z"),
    ]);
    expect(first.accounts).toHaveLength(90);
    expect(second.accounts).toHaveLength(1);
    expect(
      new Set(
        [...first.accounts, ...second.accounts].map((item) => item.accountId),
      ).size,
    ).toBe(91);
  });

  it("reclaims a report lease after its five-minute expiry", async () => {
    await seedPrincipal("jira-privacy-one");
    const repository = createJiraPrivacyRepository(env.DB);
    await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "nango-one"),
      identity("acct-one", "2026-01-01T00:00:00.000Z"),
    );
    const first = await repository.claimDueReports(
      "jira",
      "2026-07-01T00:00:00.000Z",
    );
    const second = await repository.claimDueReports(
      "jira",
      "2026-07-01T00:05:00.000Z",
    );
    expect(second.accounts).toHaveLength(1);
    expect(second.token).not.toBe(first.token);
  });

  it("keeps cleanup references across restart and retains account age until the last copy is removed", async () => {
    await seedPrincipal("jira-privacy-one");
    await seedPrincipal("jira-privacy-two");
    const repository = createJiraPrivacyRepository(env.DB);
    const first = await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "nango-one"),
      identity("acct-shared", "2026-03-01T00:00:00.000Z"),
    );
    const second = await repository.saveVerifiedConnection(
      completion("jira-privacy-two", "nango-two"),
      identity("acct-shared", "2026-01-01T00:00:00.000Z"),
    );
    await repository.queueDisconnect(
      first,
      "disconnect",
      "2026-07-01T00:00:00.000Z",
    );
    const reopened = createJiraPrivacyRepository(env.DB);
    const pending = await reopened.listCleanup("2026-07-01T00:00:00.000Z", 10);
    expect(pending).toHaveLength(1);
    expect(pending[0].nangoConnectionId).toBe("nango-one");
    await reopened.retryCleanup(pending[0], "2026-07-01T00:05:00.000Z");
    expect(
      await reopened.listCleanup("2026-07-01T00:01:00.000Z", 10),
    ).toHaveLength(0);
    const afterRestart = await createJiraPrivacyRepository(env.DB).listCleanup(
      "2026-07-01T00:05:00.000Z",
      10,
    );
    expect(afterRestart).toHaveLength(1);
    await reopened.finishCleanup(afterRestart[0], "2026-07-01T00:06:00.000Z");
    const claim = await reopened.claimDueReports(
      "jira",
      "2026-07-01T00:06:00.000Z",
    );
    expect(claim.accounts[0]).toMatchObject({
      accountId: "acct-shared",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(second.status).toBe("connected");
  });

  it("keeps a replaced Nango reference for cleanup without erasing the new generation", async () => {
    await seedPrincipal("jira-privacy-one");
    const repository = createJiraPrivacyRepository(env.DB);
    const old = await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "nango-old"),
      identity("acct-old", "2026-01-01T00:00:00.000Z"),
    );
    const lease = await repository.claimDueReports(
      "jira",
      "2026-07-01T00:00:00.000Z",
    );
    expect(lease.accounts.map((item) => item.accountId)).toContain("acct-old");
    const fresh = await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "nango-new"),
      identity("acct-new", "2026-04-01T00:00:00.000Z"),
    );
    expect(old.externalAccountId).toBe("acct-old");
    await repository.acceptReport(
      lease,
      "2026-07-01T00:00:01.000Z",
      7 * 24 * 60 * 60 * 1000,
      [{ accountId: "acct-old", status: "closed" }],
    );
    const pending = await repository.listCleanup(
      "2026-07-01T00:00:00.000Z",
      10,
    );
    expect(pending.map((row) => row.nangoConnectionId)).toContain("nango-old");
    await repository.finishCleanup(
      pending.find((row) => row.nangoConnectionId === "nango-old")!,
      "2026-07-01T00:00:00.000Z",
    );
    const current = await env.DB.prepare(
      `SELECT status, external_account_id, nango_connection_id
      FROM personal_integration_connections WHERE principal_id=? AND provider='jira'`,
    )
      .bind("jira-privacy-one")
      .first();
    expect(current).toMatchObject({
      status: "connected",
      external_account_id: "acct-new",
      nango_connection_id: "nango-new",
    });
    expect(fresh.externalAccountId).toBe("acct-new");
  });

  it("does not reuse a Nango reference while cleanup is pending", async () => {
    await seedPrincipal("jira-privacy-one");
    const repository = createJiraPrivacyRepository(env.DB);
    const old = await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "nango-old"),
      identity("acct-old", "2026-01-01T00:00:00.000Z"),
    );
    await repository.queueDisconnect(
      old,
      "disconnect",
      "2026-07-01T00:00:00.000Z",
    );

    await expect(
      repository.saveVerifiedConnection(
        completion("jira-privacy-one", "nango-old"),
        identity("acct-old", "2026-01-01T00:00:00.000Z"),
      ),
    ).rejects.toThrow("pending privacy cleanup");
    const fresh = await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "nango-new"),
      identity("acct-new", "2026-02-01T00:00:00.000Z"),
    );
    expect(fresh.nangoConnectionId).toBe("nango-new");
    expect(
      await repository.listCleanup("2026-07-01T00:00:00.000Z", 10, "jira"),
    ).toEqual([
      expect.objectContaining({
        nangoConnectionId: "nango-old",
        cleanupReason: "disconnect",
      }),
    ]);
  });

  it("uses a compare-and-swap when concurrent completions replace one connection", async () => {
    await seedPrincipal("jira-privacy-one");
    const repository = createJiraPrivacyRepository(env.DB);
    await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "nango-start"),
      identity("acct-start", "2026-01-01T00:00:00.000Z"),
    );

    const outcomes = await Promise.allSettled([
      repository.saveVerifiedConnection(
        completion("jira-privacy-one", "nango-a"),
        identity("acct-a", "2026-02-01T00:00:00.000Z"),
      ),
      repository.saveVerifiedConnection(
        completion("jira-privacy-one", "nango-b"),
        identity("acct-b", "2026-03-01T00:00:00.000Z"),
      ),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);

    const active = await env.DB.prepare(
      `SELECT nango_connection_id, external_account_id, jira_privacy_generation
      FROM personal_integration_connections WHERE principal_id = 'jira-privacy-one'
        AND provider = 'jira' AND disconnected_at IS NULL`,
    ).all();
    expect(active.results).toHaveLength(1);
    const current = active.results[0] as {
      nango_connection_id: string;
      external_account_id: string;
      jira_privacy_generation: string;
    };
    const snapshots = await env.DB.prepare(
      `SELECT nango_connection_id, account_id, cleanup_reason, generation
      FROM jira_privacy_connections WHERE integration_id = 'jira'`,
    ).all();
    expect(
      snapshots.results.filter(
        (row) =>
          (row as { cleanup_reason: string | null }).cleanup_reason === null,
      ),
    ).toEqual([
      expect.objectContaining({
        nango_connection_id: current.nango_connection_id,
        account_id: current.external_account_id,
        generation: current.jira_privacy_generation,
      }),
    ]);
    expect(
      snapshots.results.some(
        (row) =>
          ["nango-a", "nango-b"].includes(
            (row as { nango_connection_id: string }).nango_connection_id,
          ) &&
          (row as { nango_connection_id: string }).nango_connection_id !==
            current.nango_connection_id &&
          (row as { cleanup_reason: string | null }).cleanup_reason === null,
      ),
    ).toBe(false);
  });

  it("keeps concurrent first completions from creating multiple active Jira rows", async () => {
    await seedPrincipal("jira-privacy-one");
    const repository = createJiraPrivacyRepository(env.DB);
    const outcomes = await Promise.allSettled([
      repository.saveVerifiedConnection(
        completion("jira-privacy-one", "nango-first-a"),
        identity("acct-first-a", "2026-01-01T00:00:00.000Z"),
      ),
      repository.saveVerifiedConnection(
        completion("jira-privacy-one", "nango-first-b"),
        identity("acct-first-b", "2026-02-01T00:00:00.000Z"),
      ),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await env.DB.prepare(
        `SELECT count(*) AS count FROM personal_integration_connections
      WHERE principal_id = 'jira-privacy-one' AND provider = 'jira' AND disconnected_at IS NULL`,
      ).first(),
    ).toEqual({ count: 1 });
    expect(
      (
        await env.DB.prepare(
          `SELECT account_id, nango_connection_id, cleanup_reason
      FROM jira_privacy_connections`,
        ).all()
      ).results,
    ).toEqual([
      expect.objectContaining({
        account_id: (
          outcomes.find(
            (result) => result.status === "fulfilled",
          ) as PromiseFulfilledResult<{ externalAccountId: string }>
        ).value.externalAccountId,
        nango_connection_id:
          outcomes[0].status === "fulfilled"
            ? "nango-first-a"
            : "nango-first-b",
        cleanup_reason: null,
      }),
    ]);
  });

  it("persists a global unsupported-cycle block until explicitly cleared", async () => {
    await seedPrincipal("jira-privacy-one");
    const repository = createJiraPrivacyRepository(env.DB);
    await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "nango-one"),
      identity("acct-one", "2026-01-01T00:00:00.000Z"),
    );
    const lease = await repository.claimDueReports(
      "jira",
      "2026-07-01T00:00:00.000Z",
    );
    await repository.acceptReport(lease, "2026-07-01T00:00:01.000Z", null, []);
    await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "nango-next"),
      identity("acct-next", "2026-01-01T00:00:00.000Z"),
    );
    expect(
      await repository.claimDueReports("jira", "2026-07-01T00:00:02.000Z"),
    ).toMatchObject({ accounts: [] });
    expect(await repository.getOperationalState("jira")).toMatchObject({
      cycleBlocked: true,
      blockedReports: 2,
    });
    await repository.clearUnsupportedCycle("jira");
    expect(
      await repository.claimDueReports("jira", "2026-07-01T00:00:02.000Z"),
    ).toMatchObject({
      accounts: [expect.objectContaining({ accountId: "acct-next" })],
    });
  });

  it("preserves an accepted erasure when another principal adds the account under an in-flight lease", async () => {
    await seedPrincipal("jira-privacy-one");
    await seedPrincipal("jira-privacy-two");
    const repository = createJiraPrivacyRepository(env.DB);
    await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "nango-one"),
      identity("acct-shared", "2026-01-01T00:00:00.000Z"),
    );
    const lease = await repository.claimDueReports(
      "jira",
      "2026-07-01T00:00:00.000Z",
    );
    await repository.saveVerifiedConnection(
      completion("jira-privacy-two", "nango-two"),
      identity("acct-shared", "2026-03-01T00:00:00.000Z"),
    );
    await repository.acceptReport(
      lease,
      "2026-07-01T00:00:01.000Z",
      7 * 24 * 60 * 60 * 1000,
      [{ accountId: "acct-shared", status: "updated" }],
    );
    const cleanup = await repository.listCleanup(
      "2026-07-01T00:00:01.000Z",
      10,
      "jira",
    );
    expect(cleanup.map((row) => row.nangoConnectionId).sort()).toEqual([
      "nango-one",
      "nango-two",
    ]);
    expect(
      (
        await env.DB.prepare(
          `SELECT status, external_account_id FROM personal_integration_connections
      WHERE provider='jira' ORDER BY principal_id`,
        ).all()
      ).results,
    ).toEqual([
      { status: "disconnected", external_account_id: null },
      { status: "disconnected", external_account_id: null },
    ]);
  });

  it("does not invalidate a report lease during an idempotent operational identity refresh", async () => {
    const repository = createJiraPrivacyRepository(env.DB);
    const reporter = {
      provider: "jira" as const,
      nangoConnectionId: "reporter-one",
      nangoIntegrationId: "jira",
    };
    await repository.recordOperationalIdentity(
      reporter,
      identity("acct-owner", "2026-01-01T00:00:00.000Z"),
    );
    const lease = await repository.claimDueReports(
      "jira",
      "2026-07-01T00:00:00.000Z",
    );
    await repository.recordOperationalIdentity(
      reporter,
      identity("acct-owner", "2026-06-01T00:00:00.000Z"),
    );
    await repository.acceptReport(
      lease,
      "2026-07-01T00:00:01.000Z",
      7 * 24 * 60 * 60 * 1000,
      [{ accountId: "acct-owner", status: "closed" }],
    );
    const pending = (
      await repository.listCleanup("2026-07-01T00:00:01.000Z", 10, "jira")
    )[0];
    await repository.finishCleanup(pending, "2026-07-01T00:00:02.000Z");
    expect(await repository.getOperationalState("jira")).toMatchObject({
      ownerAuthorizationRequired: true,
      revokedReportingConnectionId: "reporter-one",
    });
  });

  it("requires fresh operational owner authorization after cleanup and clears it for a new reference", async () => {
    const repository = createJiraPrivacyRepository(env.DB);
    const oldOwner = {
      provider: "jira" as const,
      nangoConnectionId: "reporter-old",
      nangoIntegrationId: "jira",
    };
    await repository.retryReporter("jira", "2026-07-01T00:05:00.000Z");
    expect((await repository.getOperationalState("jira")).reporterRetryAt).toBe(
      "2026-07-01T00:05:00.000Z",
    );
    await repository.recordOperationalIdentity(
      oldOwner,
      identity("acct-owner", "2026-01-01T00:00:00.000Z"),
    );
    const snapshot = (await env.DB.prepare(
      "SELECT * FROM jira_privacy_connections WHERE principal_id IS NULL",
    ).first()) as { generation: string };
    await env.DB.prepare(
      "UPDATE jira_privacy_connections SET cleanup_reason='closed' WHERE generation=?",
    )
      .bind(snapshot.generation)
      .run();
    const item = (
      await repository.listCleanup("2026-07-01T00:00:00.000Z", 10, "jira")
    )[0];
    await repository.finishCleanup(item, "2026-07-01T00:00:01.000Z");
    expect(await repository.getOperationalState("jira")).toMatchObject({
      ownerAuthorizationRequired: true,
      revokedReportingConnectionId: "reporter-old",
    });
    await repository.recordOperationalIdentity(
      { ...oldOwner, nangoConnectionId: "reporter-new" },
      identity("acct-owner-new", "2026-07-01T00:00:02.000Z"),
    );
    expect(await repository.getOperationalState("jira")).toMatchObject({
      ownerAuthorizationRequired: false,
      revokedReportingConnectionId: null,
      reporterRetryAt: null,
    });
  });

  it("keeps an unverified legacy Nango reference for cleanup without reporting metadata as an account ID", async () => {
    await seedPrincipal("jira-privacy-one");
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
      id, principal_id, provider, nango_connection_id, nango_integration_id,
      status, external_account_label, external_account_id, scopes, created_at, updated_at
    ) VALUES ('legacy-jira', ?, 'jira', 'legacy-nango', 'jira', 'connected',
      'unverified label', 'metadata-account-id', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
      .bind("jira-privacy-one")
      .run();
    const repository = createJiraPrivacyRepository(env.DB);
    const legacy = await repository.listUnverifiedJiraConnections("jira", 10);
    expect(legacy).toHaveLength(1);
    await repository.queueDisconnect(
      legacy[0],
      "disconnect",
      "2026-07-01T00:00:00.000Z",
    );
    const cleanup = await repository.listCleanup(
      "2026-07-01T00:00:00.000Z",
      10,
      "jira",
    );
    expect(cleanup).toMatchObject([
      { nangoConnectionId: "legacy-nango", accountId: null },
    ]);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM jira_privacy_accounts",
      ).first("count"),
    ).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT external_account_id, external_account_label FROM personal_integration_connections WHERE id='legacy-jira'",
      ).first(),
    ).toEqual({ external_account_id: null, external_account_label: null });
  });

  it("captures legacy Nango cleanup when a verified connection replaces an unverified row", async () => {
    await seedPrincipal("jira-privacy-one");
    await env.DB.prepare(
      `INSERT INTO personal_integration_connections (
      id, principal_id, provider, nango_connection_id, nango_integration_id,
      status, external_account_label, external_account_id, scopes, created_at, updated_at
    ) VALUES ('legacy-jira', ?, 'jira', 'legacy-nango', 'jira', 'connected',
      'unverified label', 'metadata-account-id', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
      .bind("jira-privacy-one")
      .run();
    const repository = createJiraPrivacyRepository(env.DB);
    const staleLegacy = (
      await repository.listUnverifiedJiraConnections("jira", 10)
    )[0];
    await repository.saveVerifiedConnection(
      completion("jira-privacy-one", "verified-nango"),
      identity("acct-verified", "2026-02-01T00:00:00.000Z"),
    );
    await repository.recordLegacyIdentity(
      staleLegacy,
      identity("acct-unverified-callback", "2026-02-02T00:00:00.000Z"),
    );
    expect(
      await repository.listCleanup("2026-07-01T00:00:00.000Z", 10, "jira"),
    ).toMatchObject([
      {
        nangoConnectionId: "legacy-nango",
        accountId: null,
        cleanupReason: "replace",
      },
    ]);
    expect(
      (
        await env.DB.prepare(
          "SELECT account_id FROM jira_privacy_accounts",
        ).all()
      ).results,
    ).toEqual([{ account_id: "acct-verified" }]);
  });
});
