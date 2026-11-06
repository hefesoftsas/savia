import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProviderConfigurationInvalidError } from "../src/contracts";
import { ProviderCredentialVault } from "../src/credential-vault";

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

async function seedPrincipal(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal (
      id, issuer, subject, email, display_name, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      "savia:better-auth",
      id,
      `${id}@acme.test`,
      id,
      1,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    )
    .run();
}

const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

function vault() {
  return new ProviderCredentialVault(env.DB, {
    encryptionKey,
    now: () => new Date("2026-09-03T00:00:00.000Z"),
  });
}

describe("provider credential vault", () => {
  beforeAll(async () => {
    await applyMigrations();
    await Promise.all([seedPrincipal("actor-2"), seedPrincipal("actor-1")]);
  }, 30_000);

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM user_provider_credential_audit_events");
    await env.DB.exec("DELETE FROM user_provider_credentials");
  });

  it("isolates reads, reveals, validation, and deletion between users", async () => {
    const providerVault = vault();
    await providerVault.replace(
      "actor-1",
      "sura",
      1,
      { sura_api_key: "first-secret" },
      "actor-1",
    );
    expect((await providerVault.summary("actor-2")).providers).toEqual([]);
    await expect(
      providerVault.credentialsFor("actor-2", "sura"),
    ).rejects.toMatchObject({ code: "PROVIDER_CREDENTIALS_NOT_CONFIGURED" });
    await expect(
      providerVault.reveal("actor-2", "sura", "actor-2"),
    ).rejects.toMatchObject({ code: "PROVIDER_CREDENTIALS_NOT_CONFIGURED" });
    await expect(
      providerVault.test("actor-2", "sura", "actor-2", "success"),
    ).rejects.toMatchObject({ code: "PROVIDER_CREDENTIALS_NOT_CONFIGURED" });
    expect(await providerVault.remove("actor-2", "sura", "actor-2")).toBe(
      false,
    );
    await providerVault.replace(
      "actor-2",
      "sura",
      1,
      { sura_api_key: "second-secret" },
      "actor-2",
    );
    expect(await providerVault.credentialsFor("actor-1", "sura")).toEqual({
      sura_api_key: "first-secret",
    });
    expect(await providerVault.credentialsFor("actor-2", "sura")).toEqual({
      sura_api_key: "second-secret",
    });
  });

  it("encrypts bundles with a fresh IV and returns only configured metadata", async () => {
    const credentials = { sura_api_key: "provider-secret" };
    const providerVault = vault();

    await providerVault.replace("actor-1", "sura", 1, credentials, "actor-1");
    const first = await env.DB.prepare(
      `SELECT credential_ciphertext, credential_iv
       FROM user_provider_credentials WHERE owner_principal_id = 'actor-1' AND provider = 'sura'`,
    ).first<{ credential_ciphertext: string; credential_iv: string }>();
    await providerVault.replace("actor-1", "sura", 1, credentials, "actor-1");
    const second = await env.DB.prepare(
      `SELECT credential_ciphertext, credential_iv
       FROM user_provider_credentials WHERE owner_principal_id = 'actor-1' AND provider = 'sura'`,
    ).first<{ credential_ciphertext: string; credential_iv: string }>();

    expect(first?.credential_ciphertext).not.toContain("provider-secret");
    expect(first?.credential_iv).not.toBe(second?.credential_iv);
    await expect(
      providerVault.credentialsFor("actor-1", "sura"),
    ).resolves.toEqual(credentials);
    const summary = await providerVault.summary("actor-1");
    expect(summary.providers).toEqual([
      expect.objectContaining({ provider: "sura", schemaVersion: 1 }),
    ]);
    expect(summary.providers[0]).not.toHaveProperty("credentials");
  });

  it("rejects a bundle moved to a different user because its AAD no longer matches", async () => {
    const providerVault = vault();
    await providerVault.replace(
      "actor-1",
      "sura",
      1,
      { sura_api_key: "provider-secret" },
      "actor-1",
    );
    await env.DB.prepare(
      `UPDATE user_provider_credentials
       SET owner_principal_id = 'actor-2' WHERE owner_principal_id = 'actor-1' AND provider = 'sura'`,
    ).run();

    await expect(
      providerVault.credentialsFor("actor-2", "sura"),
    ).rejects.toBeInstanceOf(ProviderConfigurationInvalidError);
  });

  it("does not persist a bundle when its Worker-only encryption key is unavailable", async () => {
    const unavailableVault = new ProviderCredentialVault(env.DB);

    await expect(
      unavailableVault.replace(
        "actor-1",
        "sura",
        1,
        { sura_api_key: "provider-secret" },
        "actor-1",
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_CREDENTIALS_UNAVAILABLE" });
    const stored = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM user_provider_credentials",
    ).first<{ count: number }>();
    expect(stored?.count).toBe(0);
  });

  it("deletes the encrypted bundle and records only safe audit evidence", async () => {
    const providerVault = vault();
    await providerVault.replace(
      "actor-1",
      "sura",
      1,
      { sura_api_key: "provider-secret" },
      "actor-1",
    );

    await expect(
      providerVault.remove("actor-1", "sura", "actor-1"),
    ).resolves.toBe(true);
    await expect(
      providerVault.credentialsFor("actor-1", "sura"),
    ).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIALS_NOT_CONFIGURED",
    });
    const events = await env.DB.prepare(
      `SELECT event_type, outcome, error_code
       FROM user_provider_credential_audit_events
       WHERE owner_principal_id = 'actor-1' AND provider = 'sura' ORDER BY rowid`,
    ).all<{ event_type: string; outcome: string; error_code: string | null }>();

    expect(events.results).toEqual([
      { event_type: "created", outcome: "success", error_code: null },
      { event_type: "deleted", outcome: "success", error_code: null },
    ]);
    expect(JSON.stringify(events.results)).not.toContain("provider-secret");
  });
});
