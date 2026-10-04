import { AuthenticationError, type AppActor } from "../auth/types";

const defaultOpenRouterModel = "deepseek/deepseek-v4-flash";
const modelIdentifier = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type AssistantSettingScope = "global" | "agency";

export type EffectiveAssistantConfiguration = {
  apiKey?: string;
  model: string;
  transcriptionModel?: string;
  summaryModel?: string;
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
  transcriptionModel?: string | null;
  summaryModel?: string | null;
};

type AssistantSettingRow = {
  id: string;
  scope: AssistantSettingScope;
  agency_id: number | null;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  model: string | null;
  transcription_model: string | null;
  summary_model: string | null;
  updated_at: string;
  updated_by: string;
};

type ActiveTenantRow = { tenant_id?: number; agency_id?: number };
type ActiveAgencyRow = ActiveTenantRow;

export type AssistantConfigurationSummary = {
  global: AssistantConfigurationSettingSummary | null;
  tenants: AssistantConfigurationSettingSummary[];
  deployment: AssistantConfigurationDeploymentSummary;
  canManageGlobal: boolean;
  manageableTenantIds: number[];
};

export type AssistantConfigurationKeyState =
  "configured" | "inherited" | "deployment_fallback" | "not_configured";

export type AssistantConfigurationSettingSummary = {
  scope: "global" | "tenant";
  tenantId?: number;
  keyState: AssistantConfigurationKeyState;
  model: string | null;
  transcriptionModel?: string | null;
  summaryModel?: string | null;
  updatedAt?: string;
  updatedBy?: string;
};

export type AssistantConfigurationDeploymentSummary = {
  keyState: "deployment_fallback" | "not_configured";
  model: string;
  transcriptionModel: string;
  summaryModel: string;
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
    scope: row.scope === "global" ? "global" : "tenant",
    ...(row.agency_id === null ? {} : { tenantId: row.agency_id }),
    keyState,
    model: row.model,
    transcriptionModel: row.transcription_model,
    summaryModel: row.summary_model,
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
  deploymentTranscriptionModel?: string;
  now?: () => Date;
};

export class AssistantConfigurationRepository {
  private readonly encryption?: AssistantEncryption;
  private readonly now: () => Date;
  private readonly deploymentApiKey?: string;
  private readonly deploymentModel: string;
  private readonly deploymentTranscriptionModel: string;

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
    try {
      this.deploymentTranscriptionModel =
        normalizeAssistantModel(options.deploymentTranscriptionModel) ??
        "google/gemini-2.5-flash";
    } catch {
      this.deploymentTranscriptionModel = "google/gemini-2.5-flash";
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
        `SELECT id, scope, agency_id, api_key_ciphertext, api_key_iv, model, transcription_model, summary_model, updated_at, updated_by
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
      transcriptionModel: this.deploymentTranscriptionModel,
      summaryModel: this.deploymentModel,
    } as const;
    const globalKeyState = global?.api_key_ciphertext
      ? "configured"
      : deployment.keyState;
    const tenantSettings = rows.results
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
    const tenants = await this.database
      .prepare(
        "SELECT id FROM tenants WHERE kind='commercial' AND is_active = 1 ORDER BY id",
      )
      .all<{ id: number }>();
    return {
      global: global ? summary(global, globalKeyState) : null,
      tenants: tenantSettings,
      deployment,
      canManageGlobal: true,
      manageableTenantIds: tenants.results.map((tenant) => tenant.id),
    };
  }

  async manageableTenantIds(principalId: string): Promise<number[]> {
    const tenants = await this.database
      .prepare(
        `SELECT tenants.id FROM identity_principal AS principal
         INNER JOIN identity_tenant_membership AS membership
           ON membership.principal_id = principal.id
         INNER JOIN tenants ON tenants.id = membership.tenant_id
         WHERE principal.id = ? AND principal.is_active = 1
           AND membership.is_active = 1
           AND membership.role IN ('tenant_admin', 'agency_admin')
           AND tenants.kind = 'commercial' AND tenants.is_active = 1
         ORDER BY tenants.id`,
      )
      .bind(principalId)
      .all<{ id: number }>();
    return tenants.results.map((tenant) => tenant.id);
  }

  async assertTenantAdministrator(
    principalId: string,
    tenantId: number,
  ): Promise<void> {
    if (!(await this.manageableTenantIds(principalId)).includes(tenantId)) {
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "An active tenant administrator membership is required",
      );
    }
  }

  async summaryForTenantAdministrator(
    principalId: string,
  ): Promise<AssistantConfigurationSummary> {
    const manageableTenantIds = await this.manageableTenantIds(principalId);
    if (!manageableTenantIds.length) {
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "An active tenant administrator membership is required",
      );
    }
    const fullSummary = await this.summary();
    const global = fullSummary.global
      ? {
          scope: "global" as const,
          keyState: fullSummary.global.keyState,
          model: fullSummary.global.model,
          transcriptionModel: fullSummary.global.transcriptionModel ?? null,
          summaryModel: fullSummary.global.summaryModel ?? null,
        }
      : null;
    return {
      global,
      tenants: fullSummary.tenants.filter(
        (setting) =>
          setting.tenantId !== undefined &&
          manageableTenantIds.includes(setting.tenantId),
      ),
      deployment: fullSummary.deployment,
      canManageGlobal: false,
      manageableTenantIds,
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
      .prepare(
        "SELECT id FROM tenants WHERE id = ? AND kind='commercial' AND is_active = 1",
      )
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
        `INSERT INTO assistant_active_tenants (principal_id, tenant_id, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(principal_id) DO UPDATE SET
           tenant_id = excluded.tenant_id,
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

  async activeTenantFor(principalId: string): Promise<number | undefined> {
    const row = await this.database
      .prepare(
        `SELECT active.tenant_id
         FROM assistant_active_tenants AS active
         INNER JOIN tenants ON tenants.id = active.tenant_id
           AND tenants.kind = 'commercial'
           AND tenants.is_active = 1
         WHERE active.principal_id = ?
           AND (
             EXISTS (
               SELECT 1 FROM identity_tenant_membership AS membership
               WHERE membership.principal_id = active.principal_id
                 AND membership.tenant_id = active.tenant_id
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
      .first<{ tenant_id: number }>();
    if (row) return row.tenant_id;

    const platformAdministrator = await this.database
      .prepare(
        `SELECT 1 AS present FROM identity_global_role
         WHERE principal_id = ? AND role = 'platform_admin' LIMIT 1`,
      )
      .bind(principalId)
      .first<{ present: number }>();
    if (platformAdministrator) return undefined;

    const memberships = await this.database
      .prepare(
        `SELECT membership.tenant_id
         FROM identity_tenant_membership AS membership
         INNER JOIN tenants ON tenants.id = membership.tenant_id
           AND tenants.kind = 'commercial'
           AND tenants.is_active = 1
         WHERE membership.principal_id = ?
           AND membership.is_active = 1
         ORDER BY membership.tenant_id
         LIMIT 2`,
      )
      .bind(principalId)
      .all<{ tenant_id: number }>();
    return memberships.results?.length === 1
      ? memberships.results[0].tenant_id
      : undefined;
  }

  async activeAgencyFor(principalId: string): Promise<number | undefined> {
    return this.activeTenantFor(principalId);
  }

  async effectiveConfigurationFor(
    principalId: string,
  ): Promise<EffectiveAssistantConfiguration> {
    const agencyId = await this.activeAgencyFor(principalId);
    return this.configurationForTenant(agencyId);
  }

  async effectiveGlobalConfiguration(): Promise<EffectiveAssistantConfiguration> {
    return this.configurationForTenant(undefined);
  }

  async effectiveConfigurationForPlatformTenant(
    tenantId: number,
  ): Promise<EffectiveAssistantConfiguration> {
    const tenant = await this.database
      .prepare(
        "SELECT id FROM tenants WHERE id = ? AND kind='commercial' AND is_active = 1",
      )
      .bind(tenantId)
      .first<{ id: number }>();
    if (!tenant) {
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "The selected tenant is not available",
      );
    }
    return this.configurationForTenant(tenantId);
  }

  async effectiveConfigurationForTenant(
    principalId: string,
    tenantId: number,
  ): Promise<EffectiveAssistantConfiguration> {
    const eligible = await this.database
      .prepare(
        `SELECT 1 AS eligible FROM identity_principal p
      INNER JOIN identity_tenant_membership m ON m.principal_id=p.id
      INNER JOIN tenants t ON t.id=m.tenant_id
      WHERE p.id=? AND p.is_active=1 AND m.is_active=1 AND t.is_active=1 AND t.id=?
      AND (t.id<>0 OR EXISTS (SELECT 1 FROM identity_global_role g WHERE g.principal_id=p.id AND g.role='platform_admin'))`,
      )
      .bind(principalId, tenantId)
      .first();
    if (!eligible)
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "An active tenant membership is required",
      );
    return this.configurationForTenant(tenantId === 0 ? undefined : tenantId);
  }

  private async configurationForTenant(
    agencyId?: number,
  ): Promise<EffectiveAssistantConfiguration> {
    const rows = await this.database
      .prepare(
        `SELECT id, scope, agency_id, api_key_ciphertext, api_key_iv, model, transcription_model, summary_model, updated_at, updated_by
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
      transcriptionModel:
        agency?.transcription_model ??
        global?.transcription_model ??
        this.deploymentTranscriptionModel,
      summaryModel: agency?.summary_model ?? global?.summary_model ?? model,
      ...(agencyId === undefined ? {} : { tenantId: agencyId }),
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
        `SELECT id, scope, agency_id, api_key_ciphertext, api_key_iv, model, transcription_model, summary_model, updated_at, updated_by
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
    const transcriptionModel =
      input.transcriptionModel === undefined
        ? (existing?.transcription_model ?? null)
        : (normalizeAssistantModel(input.transcriptionModel) ?? null);
    const summaryModel =
      input.summaryModel === undefined
        ? (existing?.summary_model ?? null)
        : (normalizeAssistantModel(input.summaryModel) ?? null);
    if (
      scope === "agency" &&
      ciphertext === null &&
      model === null &&
      transcriptionModel === null &&
      summaryModel === null
    ) {
      await this.clearAgencyOverride(agencyId!);
      return;
    }
    await this.database
      .prepare(
        `INSERT INTO assistant_openrouter_settings (
          id, scope, agency_id, api_key_ciphertext, api_key_iv, model, transcription_model, summary_model, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          api_key_ciphertext = excluded.api_key_ciphertext,
          api_key_iv = excluded.api_key_iv,
          model = excluded.model,
          transcription_model = excluded.transcription_model,
          summary_model = excluded.summary_model,
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
        transcriptionModel,
        summaryModel,
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
        "https://openrouter.ai/api/v1/models?output_modalities=text&sort=most-popular",
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

            const inputModalities = Array.isArray(
              architecture?.input_modalities,
            )
              ? (architecture.input_modalities as string[])
              : typeof architecture?.modality === "string"
                ? (architecture.modality as string).split("->")[0].split("+")
                : [];

            const outputModalities = Array.isArray(
              architecture?.output_modalities,
            )
              ? (architecture.output_modalities as string[])
              : typeof architecture?.modality === "string"
                ? ((architecture.modality as string)
                    .split("->")
                    .at(-1)
                    ?.split("+") ?? [])
                : [];

            const supportedParams = Array.isArray(
              (candidate as Record<string, unknown>).supported_parameters,
            )
              ? ((candidate as Record<string, unknown>)
                  .supported_parameters as string[])
              : [];

            const modalities: AssistantModelModalities = {
              text: outputModalities.includes("text"),
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
