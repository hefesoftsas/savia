import type { AppActor } from "../auth/types";
import { activeTenant, activeTenantScope, PagesError } from "../pages/service";
import {
  assertOfficeSuiteEnabled,
  OfficeSettingsError,
} from "../office-settings/service";
import type {
  ActivePersonalIntegrationConnection,
  PersonalIntegrationNangoClient,
  PersonalIntegrationProviderDefinition,
  PersonalIntegrationProviderId,
  PersonalIntegrationRepository,
} from "../personal-integrations/contracts";
import { PersonalIntegrationUpstreamError } from "../personal-integrations/contracts";
import {
  OFFICE_FORMATS,
  OFFICE_MAX_SIZE,
  validateOfficePackage,
  type OfficeFormat,
} from "@savia/studio-shared/office";

export type ConnectedOfficeProvider = Extract<
  PersonalIntegrationProviderId,
  "google_drive" | "onedrive_personal" | "onedrive_business"
>;

export type ConnectedOfficeSummary = {
  id: string;
  name: string;
  format: OfficeFormat;
  provider: ConnectedOfficeProvider;
  url: string;
  createdAt: string;
};

export class ConnectedOfficeDocumentsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type OperationRow = {
  id: string;
  tenant_id: number;
  owner_id: string;
  request_id: string;
  request_hash: string;
  provider: ConnectedOfficeProvider;
  format: OfficeFormat;
  name: string;
  provider_file_id: string | null;
  provider_drive_id: string | null;
  nango_connection_id: string;
  url: string | null;
  state: "pending" | "ready" | "failed";
  created_at: string;
};

const providerLabels: Record<ConnectedOfficeProvider, string> = {
  google_drive: "Google Drive",
  onedrive_personal: "OneDrive Personal",
  onedrive_business: "OneDrive for Business",
};
const googleMime: Record<OfficeFormat, string> = {
  docx: "application/vnd.google-apps.document",
  xlsx: "application/vnd.google-apps.spreadsheet",
  pptx: "application/vnd.google-apps.presentation",
};
const googlePath: Record<OfficeFormat, string> = {
  docx: "document",
  xlsx: "spreadsheets",
  pptx: "presentation",
};
const providerIds: readonly ConnectedOfficeProvider[] = [
  "google_drive",
  "onedrive_personal",
  "onedrive_business",
];

function asProvider(value: string): ConnectedOfficeProvider {
  if ((providerIds as readonly string[]).includes(value))
    return value as ConnectedOfficeProvider;
  throw new ConnectedOfficeDocumentsError(
    400,
    "INVALID_PROVIDER",
    "Choose a supported connected drive",
  );
}

function safeName(
  value: string,
  format: OfficeFormat,
  addExtension: boolean,
): string {
  const name = value.trim();
  if (!name || name.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(name))
    throw new ConnectedOfficeDocumentsError(
      400,
      "INVALID_NAME",
      "A valid document name is required",
    );
  if (!addExtension || name.toLowerCase().endsWith(`.${format}`)) return name;
  return `${name}.${format}`;
}

async function fingerprint(
  provider: ConnectedOfficeProvider,
  format: OfficeFormat,
  name: string,
  bytes?: Uint8Array,
): Promise<string> {
  const metadata = new TextEncoder().encode(
    `${provider}\0${format}\0${name}\0`,
  );
  const input = new Uint8Array(metadata.length + (bytes?.length ?? 0));
  input.set(metadata);
  if (bytes) input.set(bytes, metadata.length);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function googleEditorUrl(id: unknown, format: OfficeFormat): string {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id))
    throw new PersonalIntegrationUpstreamError();
  return `https://docs.google.com/${googlePath[format]}/d/${id}/edit`;
}

function oneDriveEditorUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048)
    throw new PersonalIntegrationUpstreamError();
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const trusted =
      hostname === "onedrive.live.com" ||
      hostname.endsWith(".sharepoint.com") ||
      hostname.endsWith(".onedrive.com");
    if (
      url.protocol !== "https:" ||
      !trusted ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error("unsafe url");
    return url.toString();
  } catch {
    throw new PersonalIntegrationUpstreamError();
  }
}

function providerMime(format: OfficeFormat): string {
  return OFFICE_FORMATS[format].mime;
}

export class ConnectedOfficeDocumentsService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: AppActor,
    private readonly providers: Record<
      PersonalIntegrationProviderId,
      PersonalIntegrationProviderDefinition
    >,
    private readonly repository: PersonalIntegrationRepository,
    private readonly nango?: PersonalIntegrationNangoClient,
  ) {}

  private async tenant(): Promise<number> {
    try {
      const tenantId = await activeTenant(this.db, this.actor);
      await assertOfficeSuiteEnabled(this.db, tenantId);
      return tenantId;
    } catch (error) {
      if (error instanceof PagesError)
        throw new ConnectedOfficeDocumentsError(
          404,
          "DOCUMENT_NOT_FOUND",
          "Document not found",
        );
      if (error instanceof OfficeSettingsError)
        throw new ConnectedOfficeDocumentsError(
          error.status,
          error.code,
          error.message,
        );
      throw error;
    }
  }

  async listProviders() {
    await this.tenant();
    if (!this.nango) return [];
    const result = [];
    for (const provider of providerIds) {
      const definition = this.providers[provider];
      if (definition?.availability !== "enabled" || !definition.integrationId)
        continue;
      const connection = await this.repository.findActiveConnection(
        this.actor.principal.id,
        provider,
      );
      if (
        connection?.status === "connected" &&
        connection.nangoIntegrationId === definition.integrationId
      )
        result.push({
          provider,
          label: providerLabels[provider],
          accountLabel: connection.externalAccountLabel,
        });
    }
    return result;
  }

  async list(): Promise<ConnectedOfficeSummary[]> {
    const tenantId = await this.tenant();
    const { results } = await this.db
      .prepare(
        `SELECT id,name,format,provider,url,created_at FROM connected_office_document_operations
       WHERE tenant_id=? AND owner_id=? AND state='ready' ORDER BY created_at DESC,id`,
      )
      .bind(tenantId, this.actor.principal.id)
      .all<
        Pick<
          OperationRow,
          "id" | "name" | "format" | "provider" | "url" | "created_at"
        >
      >();
    return results.flatMap((row) =>
      row.url
        ? [
            {
              id: row.id,
              name: row.name,
              format: row.format,
              provider: row.provider,
              url: row.url,
              createdAt: row.created_at,
            },
          ]
        : [],
    );
  }

  async remove(id: string): Promise<void> {
    const tenantId = await this.tenant();
    const result = await this.db
      .prepare(
        `DELETE FROM connected_office_document_operations
        WHERE id=? AND tenant_id=? AND owner_id=? AND state='ready'
          AND EXISTS(
            SELECT 1 FROM identity_principal p
            WHERE p.id=? AND p.is_active=1
              AND ${activeTenantScope("p.id", "connected_office_document_operations.tenant_id")}
          )
          AND NOT EXISTS(
            SELECT 1 FROM office_settings os
            WHERE os.tenant_id=? AND (os.platform_allowed=0 OR os.tenant_enabled=0)
          )`,
      )
      .bind(
        id,
        tenantId,
        this.actor.principal.id,
        this.actor.principal.id,
        tenantId,
      )
      .run();
    if (!result.meta.changes)
      throw new ConnectedOfficeDocumentsError(
        404,
        "DOCUMENT_NOT_FOUND",
        "Document not found",
      );
  }

  private async validateFile(
    provider: ConnectedOfficeProvider,
    format: OfficeFormat,
    file?: File,
  ): Promise<Uint8Array | undefined> {
    if (provider === "google_drive") {
      if (file)
        throw new ConnectedOfficeDocumentsError(
          400,
          "UNEXPECTED_FILE",
          "Google creates native documents without an upload",
        );
      return undefined;
    }
    if (!file)
      throw new ConnectedOfficeDocumentsError(
        400,
        "FILE_REQUIRED",
        "An Office template file is required for OneDrive",
      );
    if (!file.size || file.size > OFFICE_MAX_SIZE)
      throw new ConnectedOfficeDocumentsError(
        413,
        "FILE_TOO_LARGE",
        "Office templates are limited to 5 MB",
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await validateOfficePackage(bytes, format);
    } catch {
      throw new ConnectedOfficeDocumentsError(
        422,
        "INVALID_OFFICE_PACKAGE",
        "The Office template is damaged or unsupported",
      );
    }
    return bytes;
  }

  private async connected(
    provider: ConnectedOfficeProvider,
  ): Promise<ActivePersonalIntegrationConnection> {
    const definition = this.providers[provider];
    if (
      !definition ||
      definition.availability !== "enabled" ||
      !definition.integrationId
    )
      throw new ConnectedOfficeDocumentsError(
        503,
        "PROVIDER_UNAVAILABLE",
        "The selected provider is unavailable",
      );
    const connection = await this.repository.findActiveConnection(
      this.actor.principal.id,
      provider,
    );
    if (
      !connection ||
      connection.status !== "connected" ||
      connection.nangoIntegrationId !== definition.integrationId
    )
      throw new ConnectedOfficeDocumentsError(
        403,
        "PROVIDER_NOT_CONNECTED",
        "Connect this drive before creating a document",
      );
    return connection;
  }

  async create(input: {
    provider: string;
    format: string;
    name: string;
    requestId: string;
    file?: File;
  }): Promise<{ summary: ConnectedOfficeSummary; created: boolean }> {
    const tenantId = await this.tenant();
    if (!this.nango)
      throw new ConnectedOfficeDocumentsError(
        503,
        "PROVIDER_UNAVAILABLE",
        "Connected drive providers are not configured",
      );
    const provider = asProvider(input.provider);
    if (!Object.hasOwn(OFFICE_FORMATS, input.format))
      throw new ConnectedOfficeDocumentsError(
        400,
        "INVALID_FORMAT",
        "Choose DOCX, XLSX, or PPTX",
      );
    const format = input.format as OfficeFormat;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.requestId,
      )
    )
      throw new ConnectedOfficeDocumentsError(
        400,
        "INVALID_REQUEST_ID",
        "A UUID requestId is required",
      );
    const name = safeName(input.name, format, provider !== "google_drive");
    const bytes = await this.validateFile(provider, format, input.file);
    const requestHash = await fingerprint(provider, format, name, bytes);
    let connection = await this.connected(provider);

    // Recheck live membership and tenant policy at the write boundary; actor claims alone are not authoritative.
    if ((await this.tenant()) !== tenantId)
      throw new ConnectedOfficeDocumentsError(
        403,
        "TENANT_CONTEXT_CHANGED",
        "The active tenant changed",
      );
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const membershipScope = `((?=0 AND (NOT EXISTS(SELECT 1 FROM identity_tenant_membership m WHERE m.principal_id=? AND m.is_active=1)
      OR EXISTS(SELECT 1 FROM identity_tenant_membership m JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1 WHERE m.principal_id=? AND m.tenant_id=0 AND m.is_active=1)))
      OR (?<>0 AND EXISTS(SELECT 1 FROM identity_tenant_membership m JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1 WHERE m.principal_id=? AND m.tenant_id=? AND m.is_active=1)))`;
    const reservation = await this.db
      .prepare(
        `INSERT OR IGNORE INTO connected_office_document_operations
       (id,tenant_id,owner_id,request_id,request_hash,provider,format,name,nango_connection_id,state,created_at)
       SELECT ?,?,?,?,?,?,?,?,?, 'pending',? FROM identity_principal p
       WHERE p.id=? AND p.is_active=1 AND ${membershipScope}
       AND NOT EXISTS(SELECT 1 FROM office_settings os WHERE os.tenant_id=? AND (os.platform_allowed=0 OR os.tenant_enabled=0))`,
      )
      .bind(
        id,
        tenantId,
        this.actor.principal.id,
        input.requestId,
        requestHash,
        provider,
        format,
        name,
        connection.nangoConnectionId,
        now,
        this.actor.principal.id,
        tenantId,
        this.actor.principal.id,
        this.actor.principal.id,
        tenantId,
        this.actor.principal.id,
        tenantId,
        tenantId,
      )
      .run();
    const inserted = Number(reservation.meta.changes ?? 0) > 0;

    const operation = await this.db
      .prepare(
        "SELECT * FROM connected_office_document_operations WHERE tenant_id=? AND owner_id=? AND request_id=?",
      )
      .bind(tenantId, this.actor.principal.id, input.requestId)
      .first<OperationRow>();
    if (!operation)
      throw new ConnectedOfficeDocumentsError(
        403,
        "OFFICE_SUITE_DISABLED",
        "The office suite is disabled or this tenant is no longer active",
      );
    if (operation.request_hash !== requestHash)
      throw new ConnectedOfficeDocumentsError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This requestId was already used for a different document",
      );
    if (operation.state === "ready" && operation.url)
      return {
        summary: this.summary(operation, operation.url),
        created: false,
      };
    if (!inserted && operation.state === "pending")
      throw new ConnectedOfficeDocumentsError(
        409,
        "REQUEST_IN_PROGRESS",
        "This document request is already in progress; use a new requestId for another attempt",
      );
    if (operation.state === "pending") {
      let response: Response;
      try {
        const liveTenant = await this.tenant();
        const liveConnection = await this.repository.findActiveConnection(
          this.actor.principal.id,
          provider,
        );
        if (
          liveTenant !== tenantId ||
          !liveConnection ||
          liveConnection.status !== "connected" ||
          liveConnection.id !== connection.id ||
          liveConnection.nangoIntegrationId !== connection.nangoIntegrationId ||
          liveConnection.nangoConnectionId !== connection.nangoConnectionId
        )
          throw new ConnectedOfficeDocumentsError(
            403,
            "PROVIDER_NOT_CONNECTED",
            "The connected drive or active tenant changed before document creation",
          );
        connection = liveConnection;
      } catch (error) {
        // No provider request has been sent yet, so removing the reservation is safe.
        await this.db
          .prepare(
            "DELETE FROM connected_office_document_operations WHERE id=? AND owner_id=? AND state='pending'",
          )
          .bind(id, this.actor.principal.id)
          .run();
        throw error;
      }
      try {
        if (provider === "google_drive") {
          response = await this.nango.proxy({
            method: "POST",
            path: "/drive/v3/files?fields=id,name,webViewLink",
            connection,
            body: { name, mimeType: googleMime[format] },
          });
        } else {
          const path = `/v1.0/me/drive/root:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=fail`;
          response = await this.nango.proxy({
            method: "PUT",
            path,
            connection,
            rawBody: Uint8Array.from(bytes!),
            contentType: providerMime(format),
          });
        }
      } catch {
        // A failed transport can mean the provider created the file but its response was lost.
        // Keep this request reserved so retrying the same idempotency key cannot duplicate it.
        await this.audit(connection, "failed");
        throw new ConnectedOfficeDocumentsError(
          502,
          "PROVIDER_REQUEST_UNCERTAIN",
          "The provider response was not received; check the drive before starting a new request",
        );
      }
      if (!response.ok) {
        await this.audit(connection, "failed");
        if (
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500
        )
          throw new ConnectedOfficeDocumentsError(
            502,
            "PROVIDER_REQUEST_UNCERTAIN",
            "The provider did not confirm whether it created the file; check the drive before starting a new request",
          );
        await this.db
          .prepare(
            "UPDATE connected_office_document_operations SET state='failed' WHERE id=? AND state='pending'",
          )
          .bind(id)
          .run();
        if (response.status === 409)
          throw new ConnectedOfficeDocumentsError(
            409,
            "DOCUMENT_NAME_CONFLICT",
            "A document with this name already exists in the connected drive",
          );
        throw new ConnectedOfficeDocumentsError(
          502,
          "PROVIDER_REQUEST_FAILED",
          "The provider rejected this document request",
        );
      }
      const payload: unknown = await response.json().catch(() => undefined);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        await this.audit(connection, "failed");
        throw new ConnectedOfficeDocumentsError(
          502,
          "PROVIDER_RESPONSE_INVALID",
          "The provider response could not be safely saved",
        );
      }
      const data = payload as Record<string, unknown>;
      const providerFileId =
        typeof data.id === "string" &&
        (provider === "google_drive"
          ? /^[A-Za-z0-9_-]{1,200}$/.test(data.id)
          : data.id.length > 0 &&
            data.id.length <= 2048 &&
            !/[\u0000-\u001f\u007f]/.test(data.id))
          ? data.id
          : undefined;
      if (!providerFileId) {
        await this.audit(connection, "failed");
        throw new ConnectedOfficeDocumentsError(
          502,
          "PROVIDER_RESPONSE_INVALID",
          "The provider response did not include a valid file id",
        );
      }
      let url: string;
      let driveId: string | null = null;
      try {
        if (provider === "google_drive")
          url = googleEditorUrl(providerFileId, format);
        else {
          url = oneDriveEditorUrl(data.webUrl);
          const parent = data.parentReference;
          if (parent && typeof parent === "object" && !Array.isArray(parent)) {
            const candidate = (parent as Record<string, unknown>).driveId;
            if (typeof candidate === "string" && candidate.length <= 255)
              driveId = candidate;
          }
        }
      } catch {
        await this.db
          .prepare(
            `UPDATE connected_office_document_operations SET provider_file_id=?,provider_drive_id=?
           WHERE id=? AND tenant_id=? AND owner_id=? AND state='pending'`,
          )
          .bind(providerFileId, driveId, id, tenantId, this.actor.principal.id)
          .run();
        await this.audit(connection, "failed");
        throw new ConnectedOfficeDocumentsError(
          502,
          "PROVIDER_URL_UNSAFE",
          "The provider returned an unsafe editor URL",
        );
      }
      let saved: D1Result;
      try {
        saved = await this.db
          .prepare(
            `UPDATE connected_office_document_operations SET provider_file_id=?,provider_drive_id=?,url=?,state='ready'
         WHERE id=? AND tenant_id=? AND owner_id=? AND state='pending'`,
          )
          .bind(
            providerFileId,
            driveId,
            url,
            id,
            tenantId,
            this.actor.principal.id,
          )
          .run();
      } catch {
        await this.audit(connection, "failed");
        throw new ConnectedOfficeDocumentsError(
          503,
          "METADATA_SAVE_FAILED",
          "The provider file was created but its private link is pending; check the connected drive before starting another request",
        );
      }
      if (Number(saved.meta.changes ?? 0) !== 1) {
        await this.audit(connection, "failed");
        throw new ConnectedOfficeDocumentsError(
          503,
          "METADATA_SAVE_FAILED",
          "The provider file was created but its private link could not be saved; do not retry this request",
        );
      }
      await this.audit(connection, "succeeded");
      const ready = await this.db
        .prepare(
          "SELECT * FROM connected_office_document_operations WHERE id=? AND tenant_id=? AND owner_id=? AND state='ready'",
        )
        .bind(id, tenantId, this.actor.principal.id)
        .first<OperationRow>();
      if (!ready)
        throw new ConnectedOfficeDocumentsError(
          503,
          "METADATA_SAVE_FAILED",
          "The provider file was created but its private link could not be loaded; do not retry this request",
        );
      return { summary: this.summary(ready, url), created: true };
    }
    throw new ConnectedOfficeDocumentsError(
      502,
      "PROVIDER_REQUEST_FAILED",
      "The provider did not complete this document request",
    );
  }

  private async audit(
    connection: ActivePersonalIntegrationConnection,
    outcome: "succeeded" | "failed",
  ) {
    try {
      await this.repository.appendAuditEvent({
        connection,
        eventType: "upload-file",
        outcome,
        ...(outcome === "failed"
          ? { errorCode: "CONNECTED_OFFICE_DOCUMENT" }
          : {}),
      });
    } catch {
      /* Audit persistence must not change provider or document state. */
    }
  }

  private summary(row: OperationRow, url: string): ConnectedOfficeSummary {
    return {
      id: row.id,
      name: row.name,
      format: row.format,
      provider: row.provider,
      url,
      createdAt: row.created_at,
    };
  }
}
