import type { ExtensionActionContext } from "@savia/crm-shared/extension-runtime";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type ExtensionConnectionKey = {
  tenantId: string;
  extensionId: string;
  connectionId: string;
};

export type ExtensionConnectionWrite = ExtensionConnectionKey & {
  connectorId: string;
  principalId: string;
};

export type ExtensionConnectionSummary = {
  connectionId: string;
  connectorId: string;
  configured: true;
  updatedAt: string;
};

type StoredConnection = {
  connector_id: string;
  credential_ciphertext: string;
  credential_iv: string;
  updated_at: string;
};

export type ExtensionActionRun = {
  runId: string;
  status: "pending" | "succeeded" | "failed" | "expired";
};

export type ExtensionActionRunRecord = ExtensionActionRun & {
  actionId: string;
  connectionId: string;
  output: unknown;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

type StoredActionRun = {
  run_id: string;
  action_id: string;
  connection_id: string;
  status: ExtensionActionRun["status"];
  output: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

export type ExtensionConnectionRepositoryOptions = {
  encryptionKey?: string;
  isExtensionActive: (
    tenantId: string,
    extensionId: string,
  ) => Promise<boolean>;
  now?: () => Date;
};

export class ExtensionRuntimeError extends Error {
  constructor(
    readonly code:
      | "EXTENSION_DISABLED"
      | "EXTENSION_CONNECTION_NOT_CONFIGURED"
      | "EXTENSION_CONNECTIONS_UNAVAILABLE"
      | "EXTENSION_CONNECTION_INVALID"
      | "EXTENSION_CONNECTION_UNREADABLE"
      | "EXTENSION_SETTINGS_INVALID"
      | "EXTENSION_SETTINGS_VERSION_CONFLICT",
  ) {
    super(code);
  }
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function decodeBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new ExtensionRuntimeError("EXTENSION_CONNECTION_UNREADABLE");
  }
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function connectionAad(
  key: ExtensionConnectionKey,
  connectorId: string,
): Uint8Array {
  return encoder.encode(
    `savia/extensions/connection/v1/${key.tenantId}/${key.extensionId}/${key.connectionId}/${connectorId}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedValues(
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(values))
    throw new ExtensionRuntimeError("EXTENSION_CONNECTION_INVALID");
  try {
    const json = JSON.stringify(values);
    if (!json || !isRecord(JSON.parse(json))) throw new Error("invalid");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new ExtensionRuntimeError("EXTENSION_CONNECTION_INVALID");
  }
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /authorization|password|secret|token|api[-_]?key|cookie/i.test(key)
        ? "[redacted]"
        : sanitize(item),
    ]),
  );
}

function sanitizedJson(value: unknown): string {
  try {
    return JSON.stringify(sanitize(value));
  } catch {
    return JSON.stringify({ value: "[unserializable]" });
  }
}

export class ExtensionConnectionRepository {
  private readonly cryptoKey?: Promise<CryptoKey>;
  private readonly now: () => Date;

  constructor(
    private readonly database: D1Database,
    private readonly options: ExtensionConnectionRepositoryOptions,
  ) {
    try {
      const material = options.encryptionKey?.trim()
        ? decodeBase64(options.encryptionKey.trim())
        : undefined;
      this.cryptoKey =
        material?.byteLength === 32
          ? crypto.subtle.importKey(
              "raw",
              bufferSource(material),
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

  async list(
    tenantId: string,
    extensionId: string,
  ): Promise<ExtensionConnectionSummary[]> {
    const rows = await this.database
      .prepare(
        "SELECT id,connector_id,updated_at FROM extension_connections WHERE tenant_id=? AND extension_id=? ORDER BY id",
      )
      .bind(tenantId, extensionId)
      .all<{ id: string; connector_id: string; updated_at: string }>();
    return rows.results.map((row) => ({
      connectionId: row.id,
      connectorId: row.connector_id,
      configured: true,
      updatedAt: row.updated_at,
    }));
  }

  async listRuns(input: {
    tenantId: string;
    extensionId: string;
    principalId: string;
    limit: number;
  }): Promise<ExtensionActionRunRecord[]> {
    await this.assertActive(input);
    const rows = await this.database
      .prepare(
        `SELECT run_id,action_id,connection_id,status,output,error_code,created_at,updated_at
         FROM extension_action_runs
         WHERE tenant_id=? AND extension_id=? AND principal_id=?
         ORDER BY updated_at DESC,run_id DESC LIMIT ?`,
      )
      .bind(
        input.tenantId,
        input.extensionId,
        input.principalId,
        Math.min(100, Math.max(1, Math.floor(input.limit))),
      )
      .all<StoredActionRun>();
    return rows.results.map((row) => ({
      runId: row.run_id,
      actionId: row.action_id,
      connectionId: row.connection_id,
      status: row.status,
      output: row.output ? JSON.parse(row.output) : null,
      errorCode: row.error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async summary(
    key: ExtensionConnectionKey,
  ): Promise<ExtensionConnectionSummary | null> {
    const row = await this.database
      .prepare(
        "SELECT id,connector_id,updated_at FROM extension_connections WHERE tenant_id=? AND extension_id=? AND id=?",
      )
      .bind(key.tenantId, key.extensionId, key.connectionId)
      .first<{ id: string; connector_id: string; updated_at: string }>();
    return row
      ? {
          connectionId: row.id,
          connectorId: row.connector_id,
          configured: true,
          updatedAt: row.updated_at,
        }
      : null;
  }

  async replace(
    connection: ExtensionConnectionWrite,
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.assertActive(connection);
    const normalized = normalizedValues(values);
    const existing = await this.summary(connection);
    const encrypted = await this.encrypt(
      connection,
      connection.connectorId,
      normalized,
    );
    const timestamp = this.now().toISOString();
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO extension_connections (
            tenant_id,extension_id,id,connector_id,credential_ciphertext,credential_iv,
            created_by_principal_id,updated_by_principal_id,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(tenant_id,extension_id,id) DO UPDATE SET
            connector_id=excluded.connector_id,
            credential_ciphertext=excluded.credential_ciphertext,
            credential_iv=excluded.credential_iv,
            updated_by_principal_id=excluded.updated_by_principal_id,
            updated_at=excluded.updated_at`,
        )
        .bind(
          connection.tenantId,
          connection.extensionId,
          connection.connectionId,
          connection.connectorId,
          encrypted.ciphertext,
          encrypted.iv,
          connection.principalId,
          connection.principalId,
          timestamp,
          timestamp,
        ),
      this.audit(
        connection,
        connection.principalId,
        existing ? "replaced" : "created",
        "success",
        null,
      ),
    ]);
  }

  async remove(
    connection: ExtensionConnectionKey & { principalId: string },
  ): Promise<boolean> {
    await this.assertActive(connection);
    const result = await this.database
      .prepare(
        "DELETE FROM extension_connections WHERE tenant_id=? AND extension_id=? AND id=?",
      )
      .bind(
        connection.tenantId,
        connection.extensionId,
        connection.connectionId,
      )
      .run();
    if (!result.meta.changes) return false;
    await this.audit(
      connection,
      connection.principalId,
      "deleted",
      "success",
      null,
    ).run();
    return true;
  }

  async revealForExecution(
    key: ExtensionConnectionKey,
  ): Promise<Record<string, unknown>> {
    await this.assertActive(key);
    const row = await this.database
      .prepare(
        `SELECT connector_id,credential_ciphertext,credential_iv,updated_at
         FROM extension_connections WHERE tenant_id=? AND extension_id=? AND id=?`,
      )
      .bind(key.tenantId, key.extensionId, key.connectionId)
      .first<StoredConnection>();
    if (!row)
      throw new ExtensionRuntimeError("EXTENSION_CONNECTION_NOT_CONFIGURED");
    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: bufferSource(decodeBase64(row.credential_iv)),
          additionalData: bufferSource(connectionAad(key, row.connector_id)),
        },
        await this.requireKey(),
        bufferSource(decodeBase64(row.credential_ciphertext)),
      );
      return normalizedValues(JSON.parse(decoder.decode(decrypted)));
    } catch (error) {
      if (error instanceof ExtensionRuntimeError) throw error;
      throw new ExtensionRuntimeError("EXTENSION_CONNECTION_UNREADABLE");
    }
  }

  async startRun(
    context: ExtensionActionContext,
    input: Record<string, unknown>,
  ): Promise<ExtensionActionRun> {
    await this.assertActive(context);
    await this.database
      .prepare(
        `INSERT INTO extension_action_runs (
          tenant_id,run_id,extension_id,action_id,connection_id,principal_id,status,input,created_at,updated_at
        ) VALUES (?,?,?,?,?,?, 'pending', ?, ?, ?)`,
      )
      .bind(
        context.tenantId,
        context.runId,
        context.extensionId,
        context.actionId,
        context.connectionId,
        context.principalId,
        sanitizedJson(input),
        this.now().toISOString(),
        this.now().toISOString(),
      )
      .run();
    return { runId: context.runId, status: "pending" };
  }

  async completeRun(
    context: ExtensionActionContext,
    output: unknown,
  ): Promise<ExtensionActionRun> {
    await this.updateRun(context, "succeeded", output, null);
    return { runId: context.runId, status: "succeeded" };
  }

  async failRun(
    context: ExtensionActionContext,
    errorCode: string,
    output: unknown = null,
  ): Promise<ExtensionActionRun> {
    await this.updateRun(context, "failed", output, errorCode.slice(0, 100));
    return { runId: context.runId, status: "failed" };
  }

  private async updateRun(
    context: ExtensionActionContext,
    status: "succeeded" | "failed",
    output: unknown,
    errorCode: string | null,
  ): Promise<void> {
    const result = await this.database
      .prepare(
        "UPDATE extension_action_runs SET status=?,output=?,error_code=?,updated_at=? WHERE tenant_id=? AND run_id=? AND status='pending'",
      )
      .bind(
        status,
        sanitizedJson(output),
        errorCode,
        this.now().toISOString(),
        context.tenantId,
        context.runId,
      )
      .run();
    if (!result.meta.changes)
      throw new ExtensionRuntimeError("EXTENSION_CONNECTION_NOT_CONFIGURED");
  }

  private async assertActive(
    key: Pick<ExtensionConnectionKey, "tenantId" | "extensionId">,
  ): Promise<void> {
    if (!(await this.options.isExtensionActive(key.tenantId, key.extensionId)))
      throw new ExtensionRuntimeError("EXTENSION_DISABLED");
  }

  private async encrypt(
    key: ExtensionConnectionKey,
    connectorId: string,
    values: Record<string, unknown>,
  ): Promise<{ ciphertext: string; iv: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: bufferSource(iv),
        additionalData: bufferSource(connectionAad(key, connectorId)),
      },
      await this.requireKey(),
      bufferSource(encoder.encode(JSON.stringify(values))),
    );
    return {
      ciphertext: encodeBase64(new Uint8Array(encrypted)),
      iv: encodeBase64(iv),
    };
  }

  private requireKey(): Promise<CryptoKey> {
    if (!this.cryptoKey)
      throw new ExtensionRuntimeError("EXTENSION_CONNECTIONS_UNAVAILABLE");
    return this.cryptoKey;
  }

  private audit(
    connection: ExtensionConnectionKey,
    principalId: string,
    eventType: "created" | "replaced" | "deleted",
    outcome: "success" | "failure",
    errorCode: string | null,
  ): D1PreparedStatement {
    return this.database
      .prepare(
        `INSERT INTO extension_connection_audit_events (
          id,tenant_id,extension_id,connection_id,actor_principal_id,event_type,outcome,error_code,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        crypto.randomUUID(),
        connection.tenantId,
        connection.extensionId,
        connection.connectionId,
        principalId,
        eventType,
        outcome,
        errorCode,
        this.now().toISOString(),
      );
  }
}
