import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AssistantConfigurationRepository,
  AssistantConfigurationUnavailableError,
  AssistantEncryption,
} from "../src/assistant/configuration";
import type { AppActor } from "../src/auth/types";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

const masterKey = btoa("a".repeat(32));

type SettingRow = {
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
};

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

function repository() {
  return new AssistantConfigurationRepository(env.DB, {
    encryptionKey: masterKey,
    deploymentApiKey: "deployment-key",
    deploymentModel: "anthropic/claude-sonnet-4",
  });
}

function agencyActor(agencyId: number): AppActor {
  return {
    principal: {
      id: "test-agency-member",
      issuer: "savia:test",
      subject: "test-agency-member",
      email: "member@savia.test",
      displayName: "Savia Test Member",
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    globalRoles: [],
    memberships: [
      {
        id: "test-membership",
        principalId: "test-agency-member",
        agencyId,
        role: "viewer",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

async function seedAgencyAndMember(agencyId: number) {
  const now = "2026-01-01T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenants(id,id_slug,name,is_active,created_at,updated_at,kind) VALUES(?,?,?,1,?,?,'commercial')",
  )
    .bind(
      agencyId,
      `assistant-tenant-${agencyId}`,
      `Assistant Tenant ${agencyId}`,
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_principal (
      id, issuer, subject, email, display_name, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      "test-agency-member",
      "savia:test",
      "test-agency-member",
      "member@savia.test",
      "Savia Test Member",
      1,
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO identity_tenant_membership (
      id, principal_id, tenant_id, role, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `assistant-membership-${agencyId}`,
      "test-agency-member",
      agencyId,
      "viewer",
      1,
      now,
      now,
    )
    .run();
}

describe("assistant OpenRouter configuration", () => {
  beforeAll(applyMigrations);

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM assistant_active_tenants");
    await env.DB.exec("DELETE FROM identity_tenant_membership");
    await env.DB.exec("DELETE FROM assistant_openrouter_settings");
  });

  it("pins API key processing to its tenant independently of browser selection", async () => {
    await seedAgencyAndMember(101);
    const settings = repository();
    await settings.saveAgencyOverride(101, {
      apiKey: "tenant-key",
      model: "test/tenant",
      actorId: "test-agency-member",
    });
    expect(
      await settings.effectiveConfigurationForTenant("test-agency-member", 101),
    ).toMatchObject({
      apiKey: "tenant-key",
      model: "test/tenant",
      tenantId: 101,
    });
    await expect(
      settings.effectiveConfigurationForTenant("test-agency-member", 102),
    ).rejects.toThrow();
    await env.DB.prepare(
      "UPDATE identity_tenant_membership SET is_active=0 WHERE principal_id=?",
    )
      .bind("test-agency-member")
      .run();
    await expect(
      settings.effectiveConfigurationForTenant("test-agency-member", 101),
    ).rejects.toThrow();
  });

  it("uses a new IV and omits a saved key from summaries", async () => {
    const settings = repository();
    await settings.saveGlobal({
      actorId: "test-platform-admin",
      apiKey: "not-a-real-key",
      model: "openai/gpt-5",
    });
    const first = await env.DB.prepare(
      "SELECT api_key_ciphertext, api_key_iv FROM assistant_openrouter_settings WHERE id = 'global'",
    ).first<SettingRow>();

    await settings.saveGlobal({
      actorId: "test-platform-admin",
      apiKey: "not-a-real-key",
      model: "openai/gpt-5",
    });
    const second = await env.DB.prepare(
      "SELECT api_key_ciphertext, api_key_iv FROM assistant_openrouter_settings WHERE id = 'global'",
    ).first<SettingRow>();

    expect(first?.api_key_ciphertext).not.toContain("not-a-real-key");
    expect(first?.api_key_iv).not.toBe(second?.api_key_iv);
    expect(JSON.stringify(await settings.summary())).not.toContain(
      "not-a-real-key",
    );
  });

  it("reports deployment fallback state without exposing the deployment key", async () => {
    const settings = repository();

    await expect(settings.summary()).resolves.toEqual({
      global: null,
      tenants: [],
      deployment: {
        keyState: "deployment_fallback",
        model: "anthropic/claude-sonnet-4",
        transcriptionModel: "openai/whisper-large-v3",
        summaryModel: "anthropic/claude-sonnet-4",
      },
    });
  });

  it("persists global meeting models across partial key and chat-model updates", async () => {
    const settings = repository();
    await settings.saveGlobal({
      actorId: "test-platform-admin",
      apiKey: "not-a-real-key",
      model: "deepseek/deepseek-v4-flash",
      transcriptionModel: "openai/whisper-large-v3-turbo",
      summaryModel: "openai/gpt-4o-mini",
    });
    await settings.saveGlobal({
      actorId: "test-platform-admin",
      model: "openai/gpt-5",
    });

    await expect(settings.summary()).resolves.toMatchObject({
      global: {
        model: "openai/gpt-5",
        transcriptionModel: "openai/whisper-large-v3-turbo",
        summaryModel: "openai/gpt-4o-mini",
      },
    });
    await expect(
      settings.effectiveConfigurationFor("test-platform-admin"),
    ).resolves.toMatchObject({
      apiKey: "not-a-real-key",
      model: "openai/gpt-5",
      transcriptionModel: "openai/whisper-large-v3-turbo",
      summaryModel: "openai/gpt-4o-mini",
    });
  });

  it("keeps meeting model choices global when saving a tenant assistant override", async () => {
    const settings = repository();
    await seedAgencyAndMember(101);
    await settings.saveGlobal({
      actorId: "test-platform-admin",
      model: "deepseek/deepseek-v4-flash",
      transcriptionModel: "openai/whisper-large-v3",
      summaryModel: "openai/gpt-4o-mini",
    });
    await settings.saveAgencyOverride(101, {
      actorId: "test-platform-admin",
      model: "openai/gpt-5",
    });

    await expect(settings.summary()).resolves.toMatchObject({
      global: {
        transcriptionModel: "openai/whisper-large-v3",
        summaryModel: "openai/gpt-4o-mini",
      },
    });
    await expect(
      settings.effectiveConfigurationFor("tenantless-user"),
    ).resolves.toMatchObject({
      model: "deepseek/deepseek-v4-flash",
      transcriptionModel: "openai/whisper-large-v3",
      summaryModel: "openai/gpt-4o-mini",
    });
  });

  it("uses a tenant assistant model as the meeting summary fallback", async () => {
    const settings = repository();
    await seedAgencyAndMember(115);
    await settings.saveGlobal({
      actorId: "test-platform-admin",
      model: "deepseek/deepseek-v4-flash",
      transcriptionModel: "openai/whisper-large-v3",
    });
    await settings.saveAgencyOverride(115, {
      actorId: "test-platform-admin",
      model: "openai/gpt-5",
    });
    await settings.setActiveAgency("test-agency-member", 115, agencyActor(115));

    await expect(
      settings.effectiveConfigurationFor("test-agency-member"),
    ).resolves.toMatchObject({
      model: "openai/gpt-5",
      transcriptionModel: "openai/whisper-large-v3",
      summaryModel: "openai/gpt-5",
    });
  });

  it("validates global meeting model identifiers", async () => {
    await expect(
      repository().saveGlobal({
        actorId: "test-platform-admin",
        transcriptionModel: "invalid",
      }),
    ).rejects.toThrow("provider/model format");
  });

  it("uses agency, global, and deployment values in field order", async () => {
    const settings = repository();
    await seedAgencyAndMember(101);
    await settings.saveGlobal({
      actorId: "test-platform-admin",
      apiKey: "not-a-real-global-key",
      model: "deepseek/deepseek-v4-flash",
    });
    await settings.saveAgencyOverride(101, {
      actorId: "test-platform-admin",
      model: "openai/gpt-5",
    });
    await settings.setActiveAgency("test-agency-member", 101, agencyActor(101));

    await expect(
      settings.effectiveConfigurationFor("test-agency-member"),
    ).resolves.toEqual({
      apiKey: "not-a-real-global-key",
      model: "openai/gpt-5",
      transcriptionModel: "openai/whisper-large-v3",
      summaryModel: "openai/gpt-5",
      tenantId: 101,
    });
  });

  it("derives an unambiguous tenant when the member has no saved selection", async () => {
    const settings = repository();
    await seedAgencyAndMember(105);

    await expect(settings.activeAgencyFor("test-agency-member")).resolves.toBe(
      105,
    );
    await expect(
      settings.effectiveConfigurationFor("test-agency-member"),
    ).resolves.toMatchObject({ tenantId: 105 });
  });

  it("does not guess when the actor has no active tenant membership", async () => {
    const settings = repository();
    await seedAgencyAndMember(107);
    await env.DB.prepare(
      "DELETE FROM identity_tenant_membership WHERE principal_id = ?",
    )
      .bind("test-agency-member")
      .run();

    await expect(
      settings.activeAgencyFor("test-agency-member"),
    ).resolves.toBeUndefined();
  });

  it("rejects ciphertext used with another agency AAD", async () => {
    const encryption = new AssistantEncryption(masterKey);
    const encrypted = await encryption.encrypt("agency", 101, "not-a-real-key");

    await expect(
      encryption.decrypt("agency", 102, encrypted.ciphertext, encrypted.iv),
    ).rejects.toThrow();
  });

  it("supports 64-character hex master keys and passphrase master keys", async () => {
    const hexKey = "a".repeat(64);
    const hexEncryption = new AssistantEncryption(hexKey);
    const encryptedHex = await hexEncryption.encrypt(
      "global",
      undefined,
      "secret-openrouter-key",
    );
    await expect(
      hexEncryption.decrypt(
        "global",
        undefined,
        encryptedHex.ciphertext,
        encryptedHex.iv,
      ),
    ).resolves.toBe("secret-openrouter-key");

    const passphraseEncryption = new AssistantEncryption(
      "passphrase-of-any-length",
    );
    const encryptedPass = await passphraseEncryption.encrypt(
      "global",
      undefined,
      "secret-openrouter-key-2",
    );
    await expect(
      passphraseEncryption.decrypt(
        "global",
        undefined,
        encryptedPass.ciphertext,
        encryptedPass.iv,
      ),
    ).resolves.toBe("secret-openrouter-key-2");
  });

  it("treats corrupted stored ciphertext as unavailable configuration", async () => {
    const settings = repository();
    await settings.saveGlobal({
      actorId: "test-platform-admin",
      apiKey: "not-a-real-global-key",
      model: "openai/gpt-5",
    });
    await env.DB.prepare(
      "UPDATE assistant_openrouter_settings SET api_key_ciphertext = ? WHERE id = 'global'",
    )
      .bind(btoa("corrupted-ciphertext"))
      .run();

    await expect(
      settings.effectiveConfigurationFor("test-agency-member"),
    ).rejects.toBeInstanceOf(AssistantConfigurationUnavailableError);
  });

  it("removes a principal's saved active agency when that principal is deleted", async () => {
    const settings = repository();
    await seedAgencyAndMember(101);
    await settings.setActiveAgency("test-agency-member", 101, agencyActor(101));

    await env.DB.prepare("DELETE FROM identity_principal WHERE id = ?")
      .bind("test-agency-member")
      .run();

    await expect(
      env.DB.prepare(
        "SELECT principal_id FROM assistant_active_tenants WHERE principal_id = ?",
      )
        .bind("test-agency-member")
        .first(),
    ).resolves.toBeNull();
  });

  it("removes tenant settings and active selections when their tenant is deleted", async () => {
    const settings = repository();
    await seedAgencyAndMember(102);
    await settings.saveAgencyOverride(102, {
      actorId: "test-platform-admin",
      model: "openai/gpt-5",
    });
    await settings.setActiveAgency("test-agency-member", 102, agencyActor(102));

    await env.DB.prepare("DELETE FROM tenants WHERE id = ?").bind(102).run();

    await expect(
      env.DB.prepare(
        "SELECT id FROM assistant_openrouter_settings WHERE id = 'agency:102'",
      ).first(),
    ).resolves.toBeNull();
    await expect(
      env.DB.prepare(
        "SELECT principal_id FROM assistant_active_tenants WHERE tenant_id = 102",
      ).first(),
    ).resolves.toBeNull();
  });

  it("stops resolving an active agency after that agency is deactivated", async () => {
    const settings = repository();
    await seedAgencyAndMember(103);
    await settings.setActiveAgency("test-agency-member", 103, agencyActor(103));
    await env.DB.prepare("UPDATE tenants SET is_active = 0 WHERE id = ?")
      .bind(103)
      .run();

    await expect(
      settings.activeAgencyFor("test-agency-member"),
    ).resolves.toBeUndefined();
  });

  it("rejects selecting an inactive agency", async () => {
    const settings = repository();
    await seedAgencyAndMember(104);
    await env.DB.prepare("UPDATE tenants SET is_active = 0 WHERE id = ?")
      .bind(104)
      .run();

    await expect(
      settings.setActiveAgency("test-agency-member", 104, agencyActor(104)),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_FORBIDDEN" });
  });

  it("rejects an agency outside an ordinary actor membership", async () => {
    const settings = repository();
    await seedAgencyAndMember(101);

    await expect(
      settings.setActiveAgency("test-agency-member", 202, agencyActor(101)),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_FORBIDDEN" });
  });
});
