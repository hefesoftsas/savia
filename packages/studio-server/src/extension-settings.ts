import type { ExtensionSettingsDefinition } from "@savia/studio-shared/extension-runtime";
import { ExtensionRuntimeError } from "./extension-connections";

export type ExtensionSettingsKey = {
  tenantId: string;
  extensionId: string;
};

export type ExtensionSettingsWrite = ExtensionSettingsKey & {
  principalId: string;
  version: number;
};

export type ExtensionSettingsSnapshot = {
  value: Record<string, unknown>;
  version: number;
  updatedAt: string | null;
};

export type ExtensionSettingsRepositoryOptions = {
  isExtensionActive: (
    tenantId: string,
    extensionId: string,
  ) => Promise<boolean>;
  now?: () => Date;
};

type StoredSettings = {
  value: string;
  version: number;
  updated_at: string;
};

function validatedValue(
  definition: ExtensionSettingsDefinition,
  value: unknown,
): Record<string, unknown> {
  try {
    const parsed = definition.schema.parse(value);
    const serialized = JSON.stringify(parsed);
    if (!serialized) throw new Error("La configuración no es serializable.");
    return definition.schema.parse(JSON.parse(serialized));
  } catch {
    throw new ExtensionRuntimeError("EXTENSION_SETTINGS_INVALID");
  }
}

function assertDefinition(
  key: ExtensionSettingsKey,
  definition: ExtensionSettingsDefinition,
): void {
  if (definition.extensionId !== key.extensionId)
    throw new ExtensionRuntimeError("EXTENSION_SETTINGS_INVALID");
}

export class ExtensionSettingsRepository {
  private readonly now: () => Date;

  constructor(
    private readonly database: D1Database,
    private readonly options: ExtensionSettingsRepositoryOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async get(
    key: ExtensionSettingsKey,
    definition: ExtensionSettingsDefinition,
  ): Promise<ExtensionSettingsSnapshot> {
    assertDefinition(key, definition);
    await this.assertActive(key);
    const row = await this.database
      .prepare(
        "SELECT value,version,updated_at FROM extension_settings WHERE tenant_id=? AND extension_id=?",
      )
      .bind(key.tenantId, key.extensionId)
      .first<StoredSettings>();
    if (!row)
      return {
        value: validatedValue(definition, definition.defaults),
        version: 0,
        updatedAt: null,
      };
    return {
      value: this.readStoredValue(definition, row.value),
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  async replace(
    key: ExtensionSettingsWrite,
    definition: ExtensionSettingsDefinition,
    value: Record<string, unknown>,
  ): Promise<ExtensionSettingsSnapshot> {
    assertDefinition(key, definition);
    await this.assertActive(key);
    if (!Number.isInteger(key.version) || key.version < 0)
      throw new ExtensionRuntimeError("EXTENSION_SETTINGS_INVALID");
    const parsed = validatedValue(definition, value);
    const timestamp = this.now().toISOString();
    const serialized = JSON.stringify(parsed);
    const result =
      key.version === 0
        ? await this.database
            .prepare(
              `INSERT INTO extension_settings (
                tenant_id,extension_id,value,version,created_by_principal_id,
                updated_by_principal_id,created_at,updated_at
              ) VALUES (?,?,?,?,?,?,?,?)
              ON CONFLICT(tenant_id,extension_id) DO NOTHING`,
            )
            .bind(
              key.tenantId,
              key.extensionId,
              serialized,
              1,
              key.principalId,
              key.principalId,
              timestamp,
              timestamp,
            )
            .run()
        : await this.database
            .prepare(
              `UPDATE extension_settings SET value=?,version=version+1,
                updated_by_principal_id=?,updated_at=?
               WHERE tenant_id=? AND extension_id=? AND version=?`,
            )
            .bind(
              serialized,
              key.principalId,
              timestamp,
              key.tenantId,
              key.extensionId,
              key.version,
            )
            .run();
    if (!result.meta.changes)
      throw new ExtensionRuntimeError("EXTENSION_SETTINGS_VERSION_CONFLICT");
    return { value: parsed, version: key.version + 1, updatedAt: timestamp };
  }

  private readStoredValue(
    definition: ExtensionSettingsDefinition,
    value: string,
  ): Record<string, unknown> {
    try {
      return validatedValue(definition, JSON.parse(value));
    } catch {
      throw new ExtensionRuntimeError("EXTENSION_SETTINGS_INVALID");
    }
  }

  private async assertActive(key: ExtensionSettingsKey): Promise<void> {
    if (!(await this.options.isExtensionActive(key.tenantId, key.extensionId)))
      throw new ExtensionRuntimeError("EXTENSION_DISABLED");
  }
}
