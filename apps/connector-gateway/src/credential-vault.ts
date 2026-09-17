import {
  ProviderConfigurationInvalidError,
  ProviderCredentialsNotConfiguredError,
  ProviderCredentialsUnavailableError,
  type ProviderCredentialSummaryList,
  type ProviderCredentialValues,
} from "./contracts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type CredentialRow = {
  id: string;
  schema_version: number;
  credential_ciphertext: string;
  credential_iv: string;
};

type CredentialSummaryRow = {
  provider: string;
  schema_version: number;
  last_validation_status: "valid" | "invalid" | null;
  last_validation_error_code: string | null;
  last_validated_at: string | null;
  updated_at: string;
};

export type ProviderCredentialVaultOptions = {
  encryptionKey?: string;
  now?: () => Date;
};

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new ProviderCredentialsUnavailableError();
  }
}

function credentialAad(
  ownerPrincipalId: string,
  provider: string,
  schemaVersion: number,
): Uint8Array {
  return encoder.encode(
    `savia/providers/user/v2/${ownerPrincipalId}/${provider}/${schemaVersion}`,
  );
}

function normalizedCredentialValues(
  values: ProviderCredentialValues,
): ProviderCredentialValues {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new ProviderConfigurationInvalidError();
  }

  const normalized = Object.entries(values).map(([name, value]) => {
    if (!name || typeof value !== "string" || !value.trim()) {
      throw new ProviderConfigurationInvalidError();
    }
    return [name, value.trim()] as const;
  });
  if (!normalized.length) throw new ProviderConfigurationInvalidError();
  return Object.fromEntries(normalized);
}

function parsedCredentialValues(value: string): ProviderCredentialValues {
  try {
    return normalizedCredentialValues(JSON.parse(value));
  } catch (error) {
    if (error instanceof ProviderConfigurationInvalidError) throw error;
    throw new ProviderConfigurationInvalidError();
  }
}

export class ProviderCredentialVault {
  private readonly cryptoKey?: Promise<CryptoKey>;
  private readonly now: () => Date;

  constructor(
    private readonly database: D1Database,
    options: ProviderCredentialVaultOptions = {},
  ) {
    const key = options.encryptionKey?.trim();
    try {
      const material = key ? decodeBase64(key) : undefined;
      this.cryptoKey =
        material?.byteLength === 32
          ? crypto.subtle.importKey(
              "raw",
              material,
              { name: "AES-GCM" },
              false,
              ["encrypt", "decrypt"],
            )
          : undefined;
    } catch {
      this.cryptoKey = undefined;
    }
    this.now = options.now ?? (() => new Date());
  }

  async summary(
    ownerPrincipalId: string,
  ): Promise<ProviderCredentialSummaryList> {
    const rows = await this.database
      .prepare(
        `SELECT provider, schema_version, last_validation_status,
                last_validation_error_code, last_validated_at, updated_at
         FROM user_provider_credentials
         WHERE owner_principal_id = ? ORDER BY provider`,
      )
      .bind(ownerPrincipalId)
      .all<CredentialSummaryRow>();
    return {
      providers: rows.results.map((row) => ({
        provider: row.provider,
        schemaVersion: row.schema_version,
        lastValidationStatus: row.last_validation_status,
        lastValidationErrorCode: row.last_validation_error_code,
        lastValidatedAt: row.last_validated_at,
        updatedAt: row.updated_at,
      })),
    };
  }

  async replace(
    ownerPrincipalId: string,
    provider: string,
    schemaVersion: number,
    values: ProviderCredentialValues,
    actorId: string,
  ): Promise<void> {
    const credentials = normalizedCredentialValues(values);
    const existing = await this.database
      .prepare(
        `SELECT id FROM user_provider_credentials
         WHERE owner_principal_id = ? AND provider = ?`,
      )
      .bind(ownerPrincipalId, provider)
      .first<{ id: string }>();
    const encrypted = await this.encrypt(
      ownerPrincipalId,
      provider,
      schemaVersion,
      JSON.stringify(credentials),
    );
    const timestamp = this.now().toISOString();
    const eventType = existing ? "replaced" : "created";

    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO user_provider_credentials (
            id, owner_principal_id, provider, schema_version, credential_ciphertext,
            credential_iv, last_validation_status, last_validation_error_code,
            last_validated_at, created_at, updated_at, created_by_principal_id,
            updated_by_principal_id
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
          ON CONFLICT(owner_principal_id, provider) DO UPDATE SET
            schema_version = excluded.schema_version,
            credential_ciphertext = excluded.credential_ciphertext,
            credential_iv = excluded.credential_iv,
            last_validation_status = NULL,
            last_validation_error_code = NULL,
            last_validated_at = NULL,
            updated_at = excluded.updated_at,
            updated_by_principal_id = excluded.updated_by_principal_id`,
        )
        .bind(
          existing?.id ?? crypto.randomUUID(),
          ownerPrincipalId,
          provider,
          schemaVersion,
          encrypted.ciphertext,
          encrypted.iv,
          timestamp,
          timestamp,
          actorId,
          actorId,
        ),
      this.audit(
        ownerPrincipalId,
        provider,
        actorId,
        eventType,
        "success",
        null,
      ),
    ]);
  }

  async remove(
    ownerPrincipalId: string,
    provider: string,
    actorId: string,
  ): Promise<boolean> {
    const result = await this.database
      .prepare(
        "DELETE FROM user_provider_credentials WHERE owner_principal_id = ? AND provider = ?",
      )
      .bind(ownerPrincipalId, provider)
      .run();
    if (!result.meta.changes) return false;
    await this.audit(
      ownerPrincipalId,
      provider,
      actorId,
      "deleted",
      "success",
      null,
    ).run();
    return true;
  }

  async test(
    ownerPrincipalId: string,
    provider: string,
    actorId: string,
    outcome: "success" | "failure",
    errorCode: string | null = null,
  ): Promise<void> {
    const status = outcome === "success" ? "valid" : "invalid";
    const timestamp = this.now().toISOString();
    const result = await this.database
      .prepare(
        `UPDATE user_provider_credentials
         SET last_validation_status = ?, last_validation_error_code = ?,
             last_validated_at = ?, updated_at = ?, updated_by_principal_id = ?
         WHERE owner_principal_id = ? AND provider = ?`,
      )
      .bind(
        status,
        errorCode,
        timestamp,
        timestamp,
        actorId,
        ownerPrincipalId,
        provider,
      )
      .run();
    if (!result.meta.changes) throw new ProviderCredentialsNotConfiguredError();
    await this.audit(
      ownerPrincipalId,
      provider,
      actorId,
      "tested",
      outcome,
      errorCode,
    ).run();
  }

  async credentialsFor(
    ownerPrincipalId: string,
    provider: string,
  ): Promise<ProviderCredentialValues> {
    const row = await this.database
      .prepare(
        `SELECT id, schema_version, credential_ciphertext, credential_iv
         FROM user_provider_credentials
         WHERE owner_principal_id = ? AND provider = ?`,
      )
      .bind(ownerPrincipalId, provider)
      .first<CredentialRow>();
    if (!row) throw new ProviderCredentialsNotConfiguredError();

    try {
      const cleartext = await this.decrypt(
        ownerPrincipalId,
        provider,
        row.schema_version,
        row.credential_ciphertext,
        row.credential_iv,
      );
      return parsedCredentialValues(cleartext);
    } catch (error) {
      if (error instanceof ProviderCredentialsUnavailableError) throw error;
      if (error instanceof ProviderConfigurationInvalidError) throw error;
      throw new ProviderConfigurationInvalidError();
    }
  }

  async reveal(
    ownerPrincipalId: string,
    provider: string,
    actorId: string,
  ): Promise<ProviderCredentialValues> {
    try {
      const values = await this.credentialsFor(ownerPrincipalId, provider);
      await this.audit(
        ownerPrincipalId,
        provider,
        actorId,
        "revealed",
        "success",
        null,
      ).run();
      return values;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "PROVIDER_CONFIGURATION_INVALID";
      await this.audit(
        ownerPrincipalId,
        provider,
        actorId,
        "revealed",
        "failure",
        code,
      ).run();
      throw error;
    }
  }

  private async encrypt(
    ownerPrincipalId: string,
    provider: string,
    schemaVersion: number,
    cleartext: string,
  ): Promise<{ ciphertext: string; iv: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: credentialAad(
          ownerPrincipalId,
          provider,
          schemaVersion,
        ),
      },
      await this.requireKey(),
      encoder.encode(cleartext),
    );
    return {
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      iv: encodeBase64(iv),
    };
  }

  private async decrypt(
    ownerPrincipalId: string,
    provider: string,
    schemaVersion: number,
    ciphertext: string,
    iv: string,
  ): Promise<string> {
    const cleartext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBase64(iv),
        additionalData: credentialAad(
          ownerPrincipalId,
          provider,
          schemaVersion,
        ),
      },
      await this.requireKey(),
      decodeBase64(ciphertext),
    );
    return decoder.decode(cleartext);
  }

  private requireKey(): Promise<CryptoKey> {
    if (!this.cryptoKey) throw new ProviderCredentialsUnavailableError();
    return this.cryptoKey;
  }

  private audit(
    ownerPrincipalId: string,
    provider: string,
    actorId: string,
    eventType: "created" | "replaced" | "revealed" | "tested" | "deleted",
    outcome: "success" | "failure",
    errorCode: string | null,
  ): D1PreparedStatement {
    return this.database
      .prepare(
        `INSERT INTO user_provider_credential_audit_events (
          id, owner_principal_id, provider, actor_principal_id, event_type,
          outcome, error_code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        ownerPrincipalId,
        provider,
        actorId,
        eventType,
        outcome,
        errorCode,
        this.now().toISOString(),
      );
  }
}
