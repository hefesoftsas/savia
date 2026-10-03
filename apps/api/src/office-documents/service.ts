import type { AppActor } from "../auth/types";
import { activeTenant, PagesError } from "../pages/service";
import {
  assertOfficeSuiteEnabled,
  OfficeSettingsError,
} from "../office-settings/service";
import {
  OFFICE_FORMATS,
  OFFICE_MAX_SIZE,
  officeFormat,
  validateOfficePackage,
} from "@savia/studio-shared/office";

type DocumentRow = {
  id: string;
  tenant_id: number;
  owner_id: string;
  name: string;
  mime: string;
  size: number;
  version: number;
  storage_key: string;
  created_at: string;
  updated_at: string;
};

export class OfficeDocumentsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const randomId = () => crypto.randomUUID();
const notFound = () =>
  new OfficeDocumentsError(404, "DOCUMENT_NOT_FOUND", "Document not found");

export type OfficeDocumentSummary = {
  id: string;
  name: string;
  mime: string;
  size: number;
  version: number;
  updatedAt: string;
};

export class OfficeDocumentsService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: AppActor,
    private readonly bucket: R2Bucket,
  ) {}

  private async tenant() {
    try {
      const tenantId = await activeTenant(this.db, this.actor);
      await assertOfficeSuiteEnabled(this.db, tenantId);
      return tenantId;
    } catch (error) {
      if (error instanceof PagesError) throw notFound();
      if (error instanceof OfficeSettingsError)
        throw new OfficeDocumentsError(error.status, error.code, error.message);
      throw error;
    }
  }

  private enabledScope(tenantColumn: string) {
    return `NOT EXISTS(SELECT 1 FROM office_settings os WHERE os.tenant_id=${tenantColumn} AND (os.platform_allowed=0 OR os.tenant_enabled=0))`;
  }

  private scope(alias = "d", tenantColumn = `${alias}.tenant_id`) {
    return `EXISTS(SELECT 1 FROM identity_principal p WHERE p.id=? AND p.is_active=1)
      AND ((${tenantColumn}=0 AND (NOT EXISTS(SELECT 1 FROM identity_tenant_membership m WHERE m.principal_id=? AND m.is_active=1)
        OR EXISTS(SELECT 1 FROM identity_tenant_membership m JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1 WHERE m.principal_id=? AND m.tenant_id=0 AND m.is_active=1)))
        OR (${tenantColumn}<>0 AND EXISTS(SELECT 1 FROM identity_tenant_membership m JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1 WHERE m.principal_id=? AND m.tenant_id=${tenantColumn} AND m.is_active=1)))`;
  }

  private summary(row: DocumentRow): OfficeDocumentSummary {
    return {
      id: row.id,
      name: row.name,
      mime: row.mime,
      size: row.size,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  async list(): Promise<OfficeDocumentSummary[]> {
    const tenantId = await this.tenant();
    const { results } = await this.db
      .prepare(
        `SELECT d.id,d.tenant_id,d.owner_id,d.name,d.mime,d.size,d.version,d.storage_key,d.created_at,d.updated_at
        FROM office_documents d WHERE d.tenant_id=? AND d.owner_id=? AND ${this.scope()}
        ORDER BY d.updated_at DESC,d.id`,
      )
      .bind(
        tenantId,
        this.actor.principal.id,
        this.actor.principal.id,
        this.actor.principal.id,
        this.actor.principal.id,
        this.actor.principal.id,
      )
      .all<DocumentRow>();
    return results.map((row) => this.summary(row));
  }

  private async validate(file: File) {
    if (!file.size || file.size > OFFICE_MAX_SIZE)
      throw new OfficeDocumentsError(
        413,
        "FILE_TOO_LARGE",
        "Office documents are limited to 5 MB",
      );
    const format = officeFormat(file.name, file.type);
    if (!format)
      throw new OfficeDocumentsError(
        422,
        "INVALID_FILE_TYPE",
        "Only DOCX, XLSX, and PPTX files are supported",
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await validateOfficePackage(bytes, format);
    } catch {
      throw new OfficeDocumentsError(
        422,
        "INVALID_OFFICE_PACKAGE",
        "The Office file is damaged or contains unsupported content",
      );
    }
    return { bytes, mime: OFFICE_FORMATS[format].mime };
  }

  private filename(value: string) {
    const name = value.split(/[\\/]/).pop()?.trim().slice(0, 200);
    if (!name)
      throw new OfficeDocumentsError(
        400,
        "INVALID_FILE",
        "A file name is required",
      );
    return name;
  }

  async create(file: File): Promise<OfficeDocumentSummary> {
    const tenantId = await this.tenant();
    const { bytes, mime } = await this.validate(file);
    const documentId = randomId();
    const storageKey = `${tenantId}/${this.actor.principal.id}/${documentId}/1/${randomId()}`;
    const createdAt = new Date().toISOString();
    await this.bucket.put(storageKey, bytes, {
      httpMetadata: { contentType: mime },
    });
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO office_documents(id,tenant_id,owner_id,name,mime,size,version,storage_key,created_at,updated_at)
          SELECT ?,?,?,?,?,?,1,?,?,? FROM tenants t WHERE t.id=? AND t.is_active=1 AND ${this.scope("t", "t.id")} AND ${this.enabledScope("t.id")}`,
          )
          .bind(
            documentId,
            tenantId,
            this.actor.principal.id,
            this.filename(file.name),
            mime,
            bytes.byteLength,
            storageKey,
            createdAt,
            createdAt,
            tenantId,
            this.actor.principal.id,
            this.actor.principal.id,
            this.actor.principal.id,
            this.actor.principal.id,
          ),
        this.db
          .prepare(
            `INSERT INTO office_document_revisions(document_id,version,storage_key,size,created_at,created_by)
          SELECT id,1,storage_key,size,created_at,owner_id FROM office_documents WHERE id=? AND tenant_id=? AND owner_id=?`,
          )
          .bind(documentId, tenantId, this.actor.principal.id),
      ]);
      const row = await this.load(documentId);
      return this.summary(row);
    } catch (error) {
      const referenced = await this.db
        .prepare("SELECT 1 FROM office_documents WHERE id=?")
        .bind(documentId)
        .first();
      if (!referenced) await this.bucket.delete(storageKey);
      throw error;
    }
  }

  private async load(id: string): Promise<DocumentRow> {
    const tenantId = await this.tenant();
    const row = await this.db
      .prepare(
        `SELECT d.* FROM office_documents d
      WHERE d.id=? AND d.tenant_id=? AND d.owner_id=? AND ${this.scope()}`,
      )
      .bind(
        id,
        tenantId,
        this.actor.principal.id,
        this.actor.principal.id,
        this.actor.principal.id,
        this.actor.principal.id,
        this.actor.principal.id,
      )
      .first<DocumentRow>();
    if (!row) throw notFound();
    return row;
  }

  async officeMetadata(id: string) {
    const row = await this.load(id);
    return {
      id: row.id,
      name: row.name,
      mime: row.mime,
      size: row.size,
      version: row.version,
      field: null,
      object: null,
      recordId: null,
      readOnly: false,
      maxSize: OFFICE_MAX_SIZE,
    };
  }

  async revisions(id: string) {
    const row = await this.load(id);
    const { results } = await this.db
      .prepare(
        `SELECT r.version,r.size,r.created_at,r.created_by
      FROM office_document_revisions r JOIN office_documents d ON d.id=r.document_id
      WHERE d.id=? AND d.tenant_id=? AND d.owner_id=? AND ${this.scope("d")} ORDER BY r.version DESC`,
      )
      .bind(
        id,
        row.tenant_id,
        this.actor.principal.id,
        this.actor.principal.id,
        this.actor.principal.id,
        this.actor.principal.id,
        this.actor.principal.id,
      )
      .all();
    return results;
  }

  async download(id: string, version: number) {
    const row = await this.load(id);
    const revision = await this.db
      .prepare(
        `SELECT r.storage_key FROM office_document_revisions r
      JOIN office_documents d ON d.id=r.document_id WHERE d.id=? AND d.tenant_id=? AND d.owner_id=? AND r.version=? AND ${this.scope("d")}`,
      )
      .bind(
        id,
        row.tenant_id,
        this.actor.principal.id,
        version,
        this.actor.principal.id,
        this.actor.principal.id,
        this.actor.principal.id,
        this.actor.principal.id,
      )
      .first<{ storage_key: string }>();
    if (!revision) throw notFound();
    const object = await this.bucket.get(revision.storage_key);
    if (!object) throw notFound();
    return new Response(object.body, {
      headers: {
        "content-type": row.mime,
        "content-length": String(object.size),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  async revise(
    id: string,
    version: number,
    file: File,
  ): Promise<OfficeDocumentSummary> {
    const row = await this.load(id);
    if (version !== row.version)
      throw new OfficeDocumentsError(
        409,
        "VERSION_CONFLICT",
        "A newer version exists; reload the document before saving",
      );
    const format = officeFormat(row.name, row.mime);
    const uploadedFormat = officeFormat(file.name, file.type);
    if (!format || format !== uploadedFormat)
      throw new OfficeDocumentsError(
        422,
        "INVALID_FILE_TYPE",
        "Keep the original Office document format",
      );
    const { bytes, mime } = await this.validate(file);
    const nextVersion = version + 1;
    const storageKey = `${row.tenant_id}/${row.owner_id}/${row.id}/${nextVersion}/${randomId()}`;
    const updatedAt = new Date().toISOString();
    await this.bucket.put(storageKey, bytes, {
      httpMetadata: { contentType: mime },
    });
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO office_document_revisions(document_id,version,storage_key,size,created_at,created_by)
          SELECT id,version,storage_key,size,created_at,owner_id FROM office_documents d
          WHERE id=? AND tenant_id=? AND owner_id=? AND version=? AND ${this.scope("d")} AND ${this.enabledScope("d.tenant_id")}
          ON CONFLICT(document_id,version) DO NOTHING`,
          )
          .bind(
            id,
            row.tenant_id,
            this.actor.principal.id,
            version,
            this.actor.principal.id,
            this.actor.principal.id,
            this.actor.principal.id,
            this.actor.principal.id,
          ),
        this.db
          .prepare(
            `INSERT INTO office_document_revisions(document_id,version,storage_key,size,created_at,created_by)
          SELECT id,?, ?,?,?,owner_id FROM office_documents d
          WHERE id=? AND tenant_id=? AND owner_id=? AND version=? AND ${this.scope("d")} AND ${this.enabledScope("d.tenant_id")}`,
          )
          .bind(
            nextVersion,
            storageKey,
            bytes.byteLength,
            updatedAt,
            id,
            row.tenant_id,
            this.actor.principal.id,
            version,
            this.actor.principal.id,
            this.actor.principal.id,
            this.actor.principal.id,
            this.actor.principal.id,
          ),
        this.db
          .prepare(
            `UPDATE office_documents SET size=?,version=?,storage_key=?,updated_at=?
          WHERE id=? AND tenant_id=? AND owner_id=? AND version=? AND ${this.scope("office_documents")} AND ${this.enabledScope("office_documents.tenant_id")}`,
          )
          .bind(
            bytes.byteLength,
            nextVersion,
            storageKey,
            updatedAt,
            id,
            row.tenant_id,
            this.actor.principal.id,
            version,
            this.actor.principal.id,
            this.actor.principal.id,
            this.actor.principal.id,
            this.actor.principal.id,
          ),
      ]);
      const current = await this.load(id);
      if (current.version !== nextVersion || current.storage_key !== storageKey)
        throw new OfficeDocumentsError(
          409,
          "VERSION_CONFLICT",
          "A newer version exists; reload the document before saving",
        );
      return this.summary(current);
    } catch (error) {
      const referenced = await this.db
        .prepare("SELECT 1 FROM office_document_revisions WHERE storage_key=?")
        .bind(storageKey)
        .first();
      if (!referenced) await this.bucket.delete(storageKey);
      throw error;
    }
  }
}
