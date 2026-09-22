import { AuthenticationError, type AppActor } from "../auth/types";

const defaultOpenRouterModel = "deepseek/deepseek-v4-flash";
const modelIdentifier = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type AssistantSettingScope = "global" | "agency";

export type EffectiveAssistantConfiguration = {
  apiKey?: string;
  model: string;
  agencyId?: number;
  tenantId?: number;
};

export type AssistantModelModalities = {
  text: boolean;
  image: boolean;
  audio: boolean;
  file: boolean;
};

export type AssistantModel = {
  id: string;
  name: string;
  contextLength: number | null;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  modalities?: AssistantModelModalities;
  supportsTools?: boolean;
};

export type AssistantModelCatalog = {
  list(
    configuration: EffectiveAssistantConfiguration,
  ): Promise<AssistantModel[]>;
};

export type AssistantConfigurationWrite = {
  actorId: string;
  apiKey?: string;
  clearApiKey?: boolean;
  model?: string | null;
};

type AssistantSettingRow = {
  id: string;
  scope: AssistantSettingScope;
  agency_id: number | null;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  model: string | null;
  updated_at: string;
  updated_by: string;
};

type ActiveAgencyRow = { agency_id: number };

export type AssistantConfigurationSummary = {
  global: AssistantConfigurationSettingSummary | null;
  agencies: AssistantConfigurationSettingSummary[];
  tenants: AssistantConfigurationSettingSummary[];
  deployment: AssistantConfigurationDeploymentSummary;
};

export type AssistantConfigurationKeyState =
  "configured" | "inherited" | "deployment_fallback" | "not_configured";

export type AssistantConfigurationSettingSummary = {
  scope: AssistantSettingScope;
  agencyId?: number;
  tenantId?: number;
  keyState: AssistantConfigurationKeyState;
  model: string | null;
  updatedAt: string;
  updatedBy: string;
};

export type AssistantConfigurationDeploymentSummary = {
  keyState: "deployment_fallback" | "not_configured";
  model: string;
};

export class AssistantConfigurationUnavailableError extends Error {
  readonly code = "ASSISTANT_CONFIGURATION_UNAVAILABLE" as const;

  constructor() {
    super("Assistant configuration encryption is unavailable");
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new AssistantConfigurationUnavailableError();
  }
}

function encryptionAad(
  scope: AssistantSettingScope,
  agencyId?: number,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    `savia/assistant/openrouter/${scope}/${agencyId ?? "global"}`,
  );
}

function settingId(scope: AssistantSettingScope, agencyId?: number): string {
  return scope === "global" ? "global" : `agency:${agencyId}`;
}

function normalizedApiKey(apiKey: string): string {
  const value = apiKey.trim();
  if (!value) throw new TypeError("An OpenRouter API key cannot be blank");
  return value;
}

export function normalizeAssistantModel(
  candidate: string | null | undefined,
): string | null | undefined {
  if (candidate === undefined || candidate === null) return candidate;
  const model = candidate.trim();
  if (!model || !modelIdentifier.test(model)) {
    throw new TypeError("An OpenRouter model must use provider/model format");
  }
  return model;
}

function summary(
  row: AssistantSettingRow,
  keyState: AssistantConfigurationKeyState,
): AssistantConfigurationSettingSummary {
  return {
    scope: row.scope,
    ...(row.agency_id === null
      ? {}
      : { agencyId: row.agency_id, tenantId: row.agency_id }),
    keyState,
    model: row.model,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

async function resolveKeyMaterial(masterKey: string): Promise<Uint8Array> {
  const trimmed = masterKey.trim();
  if (!trimmed) throw new AssistantConfigurationUnavailableError();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(trimmed.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  try {
    const binary = atob(trimmed);
    if (binary.length === 32) {
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
  } catch {}

  const utf8 = encoder.encode(trimmed);
  if (utf8.byteLength === 32) {
    return utf8;
  }

  const digest = await crypto.subtle.digest("SHA-256", utf8);
  return new Uint8Array(digest);
}

export class AssistantEncryption {
  private readonly cryptoKey: Promise<CryptoKey>;

  constructor(masterKey: string) {
    if (!masterKey?.trim()) {
      throw new AssistantConfigurationUnavailableError();
    }
    this.cryptoKey = resolveKeyMaterial(masterKey).then((keyMaterial) =>
      crypto.subtle.importKey(
        "raw",
        keyMaterial as BufferSource,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      ),
    );
  }

  async encrypt(
    scope: AssistantSettingScope,
    agencyId: number | undefined,
    apiKey: string,
  ): Promise<{ ciphertext: string; iv: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encryptionAad(scope, agencyId),
      },
      await this.cryptoKey,
      encoder.encode(apiKey),
    );
    return {
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      iv: encodeBase64(iv),
    };
  }

  async decrypt(
    scope: AssistantSettingScope,
    agencyId: number | undefined,
    ciphertext: string,
    iv: string,
  ): Promise<string> {
    try {
      const cleartext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decodeBase64(iv),
          additionalData: encryptionAad(scope, agencyId),
        },
        await this.cryptoKey,
        decodeBase64(ciphertext),
      );
      return decoder.decode(cleartext);
    } catch {
      throw new AssistantConfigurationUnavailableError();
    }
  }
}

export type AssistantConfigurationRepositoryOptions = {
  encryptionKey?: string;
  deploymentApiKey?: string;
  deploymentModel?: string;
  now?: () => Date;
};

export class AssistantConfigurationRepository {
  private readonly encryption?: AssistantEncryption;
  private readonly now: () => Date;
  private readonly deploymentApiKey?: string;
  private readonly deploymentModel: string;

  constructor(
    private readonly database: D1Database,
    options: AssistantConfigurationRepositoryOptions = {},
  ) {
    const configuredKey = options.encryptionKey?.trim();
    try {
      this.encryption = configuredKey
        ? new AssistantEncryption(configuredKey)
        : undefined;
    } catch {
      this.encryption = undefined;
    }
    this.now = options.now ?? (() => new Date());
    this.deploymentApiKey = options.deploymentApiKey?.trim() || undefined;
    try {
      this.deploymentModel =
        normalizeAssistantModel(options.deploymentModel) ??
        defaultOpenRouterModel;
    } catch {
      this.deploymentModel = defaultOpenRouterModel;
    }
  }

  async saveGlobal(input: AssistantConfigurationWrite): Promise<void> {
    await this.save("global", undefined, input);
  }

  async saveAgencyOverride(
    agencyId: number,
    input: AssistantConfigurationWrite,
  ): Promise<void> {
    await this.save("agency", agencyId, input);
  }

  async saveTenantOverride(
    tenantId: number,
    input: AssistantConfigurationWrite,
  ): Promise<void> {
    return this.saveAgencyOverride(tenantId, input);
  }

  async clearAgencyOverride(agencyId: number): Promise<boolean> {
    const result = await this.database
      .prepare(
        "DELETE FROM assistant_openrouter_settings WHERE id = ? AND scope = 'agency'",
      )
      .bind(settingId("agency", agencyId))
      .run();
    return result.meta.changes > 0;
  }

  async clearTenantOverride(tenantId: number): Promise<boolean> {
    return this.clearAgencyOverride(tenantId);
  }

  async summary(): Promise<AssistantConfigurationSummary> {
    const rows = await this.database
      .prepare(
        `SELECT id, scope, agency_id, api_key_ciphertext, api_key_iv, model, updated_at, updated_by
         FROM assistant_openrouter_settings
         ORDER BY CASE scope WHEN 'global' THEN 0 ELSE 1 END, agency_id`,
      )
      .all<AssistantSettingRow>();
    const global = rows.results.find((row) => row.scope === "global");
    const deployment = {
      keyState: this.deploymentApiKey
        ? "deployment_fallback"
        : "not_configured",
      model: this.deploymentModel,
    } as const;
    const globalKeyState = global?.api_key_ciphertext
      ? "configured"
      : deployment.keyState;
    const agencySettings = rows.results
      .filter((row) => row.scope === "agency")
      .map((row) =>
        summary(
          row,
          row.api_key_ciphertext
            ? "configured"
            : globalKeyState === "configured"
              ? "inherited"
              : globalKeyState,
        ),
      );
    return {
      global: global ? summary(global, globalKeyState) : null,
      agencies: agencySettings,
      tenants: agencySettings,
      deployment,
    };
  }

  async setActiveAgency(
    principalId: string,
    agencyId: number,
    actor: AppActor,
  ): Promise<void> {
    if (actor.principal.id !== principalId) {
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "An actor can only select their own active agency",
      );
    }
    const agency = await this.database
      .prepare("SELECT id FROM tenants WHERE id = ? AND kind='commercial' AND is_active = 1")
      .bind(agencyId)
      .first<{ id: number }>();
    if (!agency) {
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "The selected agency is not available",
      );
    }
    const isPlatformAdministrator =
      actor.globalRoles.includes("platform_admin");
    if (!isPlatformAdministrator) {
      const membership = await this.database
        .prepare(
          `SELECT id FROM identity_tenant_membership
           WHERE principal_id = ? AND tenant_id = ? AND is_active = 1`,
        )
        .bind(principalId, agencyId)
        .first<{ id: string }>();
      if (!membership) {
        throw new AuthenticationError(
          "AUTHORIZATION_FORBIDDEN",
          "The selected agency is not in the actor's active memberships",
        );
      }
    }
    await this.database
      .prepare(
        `INSERT INTO assistant_active_agencies (principal_id, agency_id, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(principal_id) DO UPDATE SET
           agency_id = excluded.agency_id,
           updated_at = excluded.updated_at`,
      )
      .bind(principalId, agencyId, this.now().toISOString())
      .run();
  }

  async setActiveTenant(
    principalId: string,
    tenantId: number,
    actor: AppActor,
  ): Promise<void> {
    return this.setActiveAgency(principalId, tenantId, actor);
  }

  async activeAgencyFor(principalId: string): Promise<number | undefined> {
    const row = await this.database
      .prepare(
        `SELECT active.agency_id
         FROM assistant_active_agencies AS active
         INNER JOIN tenants ON tenants.id = active.agency_id
           AND tenants.kind = 'commercial'
           AND tenants.is_active = 1
         WHERE active.principal_id = ?
           AND (
             EXISTS (
               SELECT 1 FROM identity_tenant_membership AS membership
               WHERE membership.principal_id = active.principal_id
                 AND membership.tenant_id = active.agency_id
                 AND membership.is_active = 1
             )
             OR EXISTS (
               SELECT 1 FROM identity_global_role AS role
               WHERE role.principal_id = active.principal_id
                 AND role.role = 'platform_admin'
             )
           )`,
      )
      .bind(principalId)
      .first<ActiveAgencyRow>();
    return row?.agency_id;
  }

  async activeTenantFor(principalId: string): Promise<number | undefined> {
    return this.activeAgencyFor(principalId);
  }

  async effectiveConfigurationFor(
    principalId: string,
  ): Promise<EffectiveAssistantConfiguration> {
    const agencyId = await this.activeAgencyFor(principalId);
    const rows = await this.database
      .prepare(
        `SELECT id, scope, agency_id, api_key_ciphertext, api_key_iv, model, updated_at, updated_by
         FROM assistant_openrouter_settings
         WHERE id = ? OR id = 'global'`,
      )
      .bind(
        agencyId === undefined
          ? "__no_active_agency__"
          : settingId("agency", agencyId),
      )
      .all<AssistantSettingRow>();
    const global = rows.results.find((row) => row.scope === "global");
    const agency = rows.results.find((row) => row.scope === "agency");
    const keyRow = agency?.api_key_ciphertext
      ? agency
      : global?.api_key_ciphertext
        ? global
        : undefined;
    const apiKey = keyRow
      ? await this.decryptKey(keyRow)
      : this.deploymentApiKey;
    const model = agency?.model ?? global?.model ?? this.deploymentModel;
    return {
      ...(apiKey ? { apiKey } : {}),
      model,
      ...(agencyId === undefined ? {} : { agencyId, tenantId: agencyId }),
    };
  }

  private async save(
    scope: AssistantSettingScope,
    agencyId: number | undefined,
    input: AssistantConfigurationWrite,
  ): Promise<void> {
    const id = settingId(scope, agencyId);
    const existing = await this.database
      .prepare(
        `SELECT id, scope, agency_id, api_key_ciphertext, api_key_iv, model, updated_at, updated_by
         FROM assistant_openrouter_settings WHERE id = ?`,
      )
      .bind(id)
      .first<AssistantSettingRow>();
    let ciphertext = existing?.api_key_ciphertext ?? null;
    let iv = existing?.api_key_iv ?? null;
    if (input.apiKey !== undefined) {
      if (input.clearApiKey) {
        throw new TypeError(
          "An API key cannot be replaced and cleared together",
        );
      }
      if (!this.encryption) throw new AssistantConfigurationUnavailableError();
      const encrypted = await this.encryption.encrypt(
        scope,
        agencyId,
        normalizedApiKey(input.apiKey),
      );
      ciphertext = encrypted.ciphertext;
      iv = encrypted.iv;
    } else if (input.clearApiKey) {
      ciphertext = null;
      iv = null;
    }
    const model =
      input.model === undefined
        ? (existing?.model ?? null)
        : normalizeAssistantModel(input.model);
    if (scope === "agency" && ciphertext === null && model === null) {
      await this.clearAgencyOverride(agencyId!);
      return;
    }
    await this.database
      .prepare(
        `INSERT INTO assistant_openrouter_settings (
          id, scope, agency_id, api_key_ciphertext, api_key_iv, model, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          api_key_ciphertext = excluded.api_key_ciphertext,
          api_key_iv = excluded.api_key_iv,
          model = excluded.model,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by`,
      )
      .bind(
        id,
        scope,
        agencyId ?? null,
        ciphertext,
        iv,
        model ?? null,
        this.now().toISOString(),
        input.actorId,
      )
      .run();
  }

  private async decryptKey(row: AssistantSettingRow): Promise<string> {
    if (!row.api_key_ciphertext || !row.api_key_iv || !this.encryption) {
      throw new AssistantConfigurationUnavailableError();
    }
    return this.encryption.decrypt(
      row.scope,
      row.agency_id ?? undefined,
      row.api_key_ciphertext,
      row.api_key_iv,
    );
  }
}

export function openRouterModelCatalog(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): AssistantModelCatalog {
  return {
    async list(configuration) {
      const headers: Record<string, string> = {};
      if (configuration.apiKey) {
        headers.authorization = `Bearer ${configuration.apiKey}`;
      }
      const response = await fetcher(
        "https://openrouter.ai/api/v1/models?output_modalities=text&supported_parameters=tools&sort=most-popular",
        Object.keys(headers).length ? { headers } : undefined,
      );
      if (!response.ok) throw new Error("OpenRouter models request failed");
      const decoded: unknown = await response.json().catch(() => undefined);
      if (
        typeof decoded !== "object" ||
        decoded === null ||
        !("data" in decoded) ||
        !Array.isArray(decoded.data)
      ) {
        throw new Error("OpenRouter model response is invalid");
      }
      return decoded.data
        .flatMap((candidate): AssistantModel[] => {
          if (
            typeof candidate !== "object" ||
            candidate === null ||
            !("id" in candidate) ||
            typeof candidate.id !== "string"
          ) {
            return [];
          }
          try {
            const id = normalizeAssistantModel(candidate.id);
            if (!id) return [];
            const name =
              "name" in candidate && typeof candidate.name === "string"
                ? candidate.name.slice(0, 240)
                : id;
            const pricing =
              "pricing" in candidate &&
              typeof candidate.pricing === "object" &&
              candidate.pricing !== null
                ? candidate.pricing
                : undefined;
            const pricePerMillion = (value: unknown): number | null => {
              const perToken =
                typeof value === "string" || typeof value === "number"
                  ? Number(value)
                  : NaN;
              const perMillion = perToken * 1_000_000;
              return Number.isFinite(perMillion) && perMillion >= 0
                ? perMillion
                : null;
            };
            const contextLength =
              "context_length" in candidate &&
              typeof candidate.context_length === "number" &&
              Number.isSafeInteger(candidate.context_length) &&
              candidate.context_length > 0
                ? candidate.context_length
                : null;
            const architecture =
              "architecture" in candidate &&
              typeof candidate.architecture === "object" &&
              candidate.architecture !== null
                ? (candidate.architecture as Record<string, unknown>)
                : undefined;

            const inputModalities = Array.isArray(architecture?.input_modalities)
              ? (architecture.input_modalities as string[])
              : typeof architecture?.modality === "string"
                ? (architecture.modality as string).split("->")[0].split("+")
                : ["text"];

            const supportedParams = Array.isArray(
              (candidate as Record<string, unknown>).supported_parameters,
            )
              ? ((candidate as Record<string, unknown>).supported_parameters as string[])
              : [];

            const modalities: AssistantModelModalities = {
              text: true,
              image: inputModalities.includes("image"),
              audio: inputModalities.includes("audio"),
              file:
                inputModalities.includes("file") ||
                inputModalities.includes("image"),
            };
            const supportsTools = supportedParams.includes("tools");

            return [
              {
                id,
                name,
                contextLength,
                inputPricePerMillion: pricePerMillion(
                  pricing && "prompt" in pricing ? pricing.prompt : undefined,
                ),
                outputPricePerMillion: pricePerMillion(
                  pricing && "completion" in pricing
                    ? pricing.completion
                    : undefined,
                ),
                modalities,
                supportsTools,
              },
            ];
          } catch {
            return [];
          }
        })
        .slice(0, 200);
    },
  };
}
