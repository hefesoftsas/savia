import type { AppActor } from "../auth/types";
import { activeTenant, activeTenantScope, PagesError } from "../pages/service";
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
  share_version: number;
  storage_key: string;
  created_at: string;
  updated_at: string;
  owner_display_name: string | null;
  owner_email: string;
  share_role: "reader" | "editor" | null;
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
  role: "owner" | "reader" | "editor";
  ownerName: string;
};

export type OfficeDocumentShare = {
  principalId: string;
  role: "reader" | "editor";
  displayName: string;
  email: string;
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

  private accessScope(
    alias: string,
    access: "read" | "edit" | "owner" = "read",
  ) {
    const shared =
      access === "read" ? "s.role IN ('reader','editor')" : "s.role='editor'";
    return `EXISTS(
      SELECT 1 FROM identity_principal actor
      JOIN identity_principal owner ON owner.id=${alias}.owner_id AND owner.is_active=1
      WHERE actor.id=? AND actor.is_active=1
        AND ${activeTenantScope("actor.id", `${alias}.tenant_id`)}
        AND (${alias}.owner_id=actor.id OR (${
          access === "owner"
            ? "0"
            : `EXISTS(
          SELECT 1 FROM office_document_shares s
          JOIN identity_principal member ON member.id=s.principal_id AND member.is_active=1
          JOIN identity_tenant_membership m ON m.principal_id=member.id AND m.tenant_id=${alias}.tenant_id AND m.is_active=1
          JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1
          WHERE s.document_id=${alias}.id AND s.tenant_id=${alias}.tenant_id
            AND s.principal_id=actor.id AND ${shared}
        )`
        }))
    )`;
  }

  private shareJoin(alias: string) {
    return `LEFT JOIN office_document_shares actor_share
      ON actor_share.document_id=${alias}.id AND actor_share.tenant_id=${alias}.tenant_id
        AND actor_share.principal_id=?
        AND EXISTS(SELECT 1 FROM identity_principal member
          JOIN identity_tenant_membership m ON m.principal_id=member.id AND m.tenant_id=${alias}.tenant_id AND m.is_active=1
          JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1
          WHERE member.id=actor_share.principal_id AND member.is_active=1)`;
  }

  private summary(row: DocumentRow): OfficeDocumentSummary {
    return {
      id: row.id,
      name: row.name,
      mime: row.mime,
      size: row.size,
      version: row.version,
      updatedAt: row.updated_at,
      role:
        row.owner_id === this.actor.principal.id
          ? "owner"
          : row.share_role === "editor"
            ? "editor"
            : "reader",
      ownerName: row.owner_display_name?.trim() || row.owner_email,
    };
  }

  async list(): Promise<OfficeDocumentSummary[]> {
    const tenantId = await this.tenant();
    const { results } = await this.db
      .prepare(
        `SELECT d.*,owner.display_name AS owner_display_name,owner.email AS owner_email,
          actor_share.role AS share_role
        FROM office_documents d
        JOIN identity_principal owner ON owner.id=d.owner_id AND owner.is_active=1
        ${this.shareJoin("d")}
        WHERE d.tenant_id=? AND ${this.accessScope("d")} AND ${this.enabledScope("d.tenant_id")}
        ORDER BY d.updated_at DESC,d.id`,
      )
      .bind(this.actor.principal.id, tenantId, this.actor.principal.id)
      .all<DocumentRow>();
    return results.map((row) => this.summary(row));
  }

  async members(query: string) {
    const tenantId = await this.tenant();
    const pattern = `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
    const result = await this.db
      .prepare(
        `SELECT p.id AS "principalId",COALESCE(NULLIF(trim(p.display_name),''),p.email) AS "displayName",p.email
        FROM identity_principal p
        JOIN identity_tenant_membership m ON m.principal_id=p.id AND m.is_active=1
        JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1
        WHERE p.is_active=1 AND p.id<>? AND m.tenant_id=?
          AND (p.display_name LIKE ? ESCAPE '\\' OR p.email LIKE ? ESCAPE '\\')
        ORDER BY p.display_name LIMIT 50`,
      )
      .bind(this.actor.principal.id, tenantId, pattern, pattern)
      .all<{ principalId: string; displayName: string; email: string }>();
    return result.results ?? [];
  }

  async shares(id: string) {
    const row = await this.load(id);
    if (row.owner_id !== this.actor.principal.id) throw notFound();
    const result = await this.db
      .prepare(
        `SELECT s.principal_id AS "principalId",s.role,COALESCE(NULLIF(trim(p.display_name),''),p.email) AS "displayName",p.email
        FROM office_document_shares s
        JOIN identity_principal p ON p.id=s.principal_id
        WHERE s.document_id=? AND s.tenant_id=? ORDER BY s.principal_id`,
      )
      .bind(id, row.tenant_id)
      .all<OfficeDocumentShare>();
    return { version: row.share_version, shares: result.results ?? [] };
  }

  async setShares(
    id: string,
    input: {
      version: number;
      shares: Array<{ principalId: string; role: "reader" | "editor" }>;
    },
  ) {
    const row = await this.load(id);
    if (row.owner_id !== this.actor.principal.id) throw notFound();
    if (input.version !== row.share_version)
      throw new OfficeDocumentsError(
        409,
        "VERSION_CONFLICT",
        "Shares changed since they were loaded",
      );
    if (!Array.isArray(input.shares) || input.shares.length > 200)
      throw new OfficeDocumentsError(
        400,
        "INVALID_SHARES",
        "Share list is invalid",
      );
    const dedup = new Set<string>();
    for (const share of input.shares) {
      if (
        !share ||
        typeof share.principalId !== "string" ||
        !["reader", "editor"].includes(share.role) ||
        dedup.has(share.principalId) ||
        share.principalId === this.actor.principal.id
      )
        throw new OfficeDocumentsError(
          400,
          "INVALID_SHARES",
          "Share list is invalid",
        );
      dedup.add(share.principalId);
      const member = await this.db
        .prepare(
          `SELECT 1 FROM identity_principal p
          JOIN identity_tenant_membership m ON m.principal_id=p.id AND m.is_active=1
          JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1
          WHERE p.id=? AND p.is_active=1 AND m.tenant_id=? LIMIT 1`,
        )
        .bind(share.principalId, row.tenant_id)
        .first();
      if (!member)
        throw new OfficeDocumentsError(
          400,
          "INVALID_SHARE_MEMBER",
          "Shares are limited to active members of this tenant",
        );
    }

    const nextVersion = row.share_version + 1;
    const guardId = randomId();
    const recipientScope = input.shares
      .map(
        () => `AND EXISTS(SELECT 1 FROM identity_principal invitee
      JOIN identity_tenant_membership membership ON membership.principal_id=invitee.id AND membership.is_active=1
      JOIN tenants active_tenant ON active_tenant.id=membership.tenant_id AND active_tenant.is_active=1
      WHERE invitee.id=? AND invitee.is_active=1 AND membership.tenant_id=d.tenant_id)`,
      )
      .join(" ");
    const authorization = `EXISTS(SELECT 1 FROM office_documents d
      JOIN identity_principal actor ON actor.id=? AND actor.is_active=1
      WHERE d.id=? AND d.tenant_id=? AND d.owner_id=actor.id AND d.share_version=?
        AND ${activeTenantScope("actor.id", "d.tenant_id")}
        AND ${this.enabledScope("d.tenant_id")} ${recipientScope})`;
    const statements = [
      this.db
        .prepare(
          `INSERT INTO studio_write_guards(id,valid) SELECT ?,CASE WHEN ${authorization} THEN 1 ELSE 0 END`,
        )
        .bind(
          guardId,
          this.actor.principal.id,
          id,
          row.tenant_id,
          input.version,
          ...input.shares.map((share) => share.principalId),
        ),
      this.db
        .prepare(
          `UPDATE office_documents SET share_version=?
          WHERE id=? AND tenant_id=? AND owner_id=? AND share_version=?
            AND ${activeTenantScope("office_documents.owner_id", "office_documents.tenant_id")} AND ${this.enabledScope("office_documents.tenant_id")}`,
        )
        .bind(
          nextVersion,
          id,
          row.tenant_id,
          this.actor.principal.id,
          input.version,
        ),
      this.db
        .prepare(
          "DELETE FROM office_document_shares WHERE document_id=? AND tenant_id=?",
        )
        .bind(id, row.tenant_id),
      ...input.shares.map((share) =>
        this.db
          .prepare(
            "INSERT INTO office_document_shares(document_id,tenant_id,principal_id,role,created_at) VALUES(?,?,?,?,?)",
          )
          .bind(
            id,
            row.tenant_id,
            share.principalId,
            share.role,
            new Date().toISOString(),
          ),
      ),
      this.db
        .prepare("DELETE FROM studio_write_guards WHERE id=?")
        .bind(guardId),
    ];
    try {
      await this.db.batch(statements);
    } catch (error) {
      const current = await this.load(id);
      if (current.owner_id !== this.actor.principal.id) throw notFound();
      if (current.share_version !== input.version)
        throw new OfficeDocumentsError(
          409,
          "VERSION_CONFLICT",
          "Shares changed since they were loaded",
        );
      for (const share of input.shares) {
        const activeMember = await this.db
          .prepare(
            `SELECT 1 FROM identity_principal p
          JOIN identity_tenant_membership m ON m.principal_id=p.id AND m.is_active=1
          JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1
          WHERE p.id=? AND p.is_active=1 AND m.tenant_id=? LIMIT 1`,
          )
          .bind(share.principalId, row.tenant_id)
          .first();
        if (!activeMember)
          throw new OfficeDocumentsError(
            400,
            "INVALID_SHARE_MEMBER",
            "Shares are limited to active members of this tenant",
          );
      }
      throw error;
    }
    return this.shares(id);
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
        `SELECT d.*,owner.display_name AS owner_display_name,owner.email AS owner_email,
          actor_share.role AS share_role
        FROM office_documents d
        JOIN identity_principal owner ON owner.id=d.owner_id AND owner.is_active=1
        ${this.shareJoin("d")}
        WHERE d.id=? AND d.tenant_id=? AND ${this.accessScope("d")} AND ${this.enabledScope("d.tenant_id")}`,
      )
      .bind(this.actor.principal.id, id, tenantId, this.actor.principal.id)
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
      updatedAt: row.updated_at,
      field: null,
      object: null,
      recordId: null,
      readOnly:
        row.owner_id !== this.actor.principal.id && row.share_role !== "editor",
      role: this.summary(row).role,
      ownerName: this.summary(row).ownerName,
      maxSize: OFFICE_MAX_SIZE,
    };
  }

  async revisions(id: string) {
    const row = await this.load(id);
    const { results } = await this.db
      .prepare(
        `SELECT r.version,r.size,r.created_at,r.created_by
      FROM office_document_revisions r JOIN office_documents d ON d.id=r.document_id
      WHERE d.id=? AND d.tenant_id=? AND ${this.accessScope("d")} ORDER BY r.version DESC`,
      )
      .bind(id, row.tenant_id, this.actor.principal.id)
      .all();
    return results;
  }

  async download(id: string, version: number) {
    const row = await this.load(id);
    const revision = await this.db
      .prepare(
        `SELECT r.storage_key FROM office_document_revisions r
      JOIN office_documents d ON d.id=r.document_id WHERE d.id=? AND d.tenant_id=? AND r.version=? AND ${this.accessScope("d")}`,
      )
      .bind(id, row.tenant_id, version, this.actor.principal.id)
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

  async remove(id: string, version: number): Promise<void> {
    const row = await this.load(id);
    if (row.owner_id !== this.actor.principal.id) throw notFound();
    if (version !== row.version)
      throw new OfficeDocumentsError(
        409,
        "VERSION_CONFLICT",
        "A newer version exists; reload the document before deleting",
      );
    const revisions = await this.db
      .prepare(
        `SELECT r.storage_key FROM office_document_revisions r
        JOIN office_documents d ON d.id=r.document_id
        WHERE d.id=? AND d.tenant_id=? AND d.owner_id=? AND d.version=? AND ${this.scope("d")} AND ${this.enabledScope("d.tenant_id")}`,
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
      .all<{ storage_key: string }>();
    const guardId = randomId();
    let results: D1Result[];
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO studio_write_guards(id,valid)
            SELECT ?,CASE WHEN EXISTS(
              SELECT 1 FROM office_documents d
              WHERE d.id=? AND d.tenant_id=? AND d.owner_id=? AND d.version=?
                AND ${this.scope("d")} AND ${this.enabledScope("d.tenant_id")}
            ) THEN 1 ELSE 0 END`,
          )
          .bind(
            guardId,
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
            `DELETE FROM office_documents
            WHERE id=? AND tenant_id=? AND owner_id=? AND version=?
              AND ${this.scope("office_documents")} AND ${this.enabledScope("office_documents.tenant_id")}`,
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
          .prepare("DELETE FROM studio_write_guards WHERE id=?")
          .bind(guardId),
      ]);
    } catch (error) {
      const current = await this.load(id);
      if (current.version !== version)
        throw new OfficeDocumentsError(
          409,
          "VERSION_CONFLICT",
          "A newer version exists; reload the document before deleting",
        );
      throw error;
    }
    if (!results[1]?.meta.changes) {
      const current = await this.load(id);
      if (current.version !== version)
        throw new OfficeDocumentsError(
          409,
          "VERSION_CONFLICT",
          "A newer version exists; reload the document before deleting",
        );
      throw notFound();
    }
    try {
      await this.bucket.delete(
        revisions.results.map((revision) => revision.storage_key),
      );
    } catch (error) {
      // The D1 row is gone, so preserve delete success and leave only inaccessible R2 orphans.
      console.error(
        "Unable to delete removed office document revisions",
        error,
      );
    }
  }

  async revise(
    id: string,
    version: number,
    file: File,
  ): Promise<OfficeDocumentSummary> {
    const row = await this.load(id);
    if (row.owner_id !== this.actor.principal.id && row.share_role !== "editor")
      throw new OfficeDocumentsError(
        403,
        "DOCUMENT_READ_ONLY",
        "Only document editors can save revisions",
      );
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
          SELECT id,version,storage_key,size,created_at,? FROM office_documents d
          WHERE id=? AND tenant_id=? AND version=? AND share_version=? AND ${this.accessScope("d", "edit")} AND ${this.enabledScope("d.tenant_id")}
          ON CONFLICT(document_id,version) DO NOTHING`,
          )
          .bind(
            this.actor.principal.id,
            id,
            row.tenant_id,
            version,
            row.share_version,
            this.actor.principal.id,
          ),
        this.db
          .prepare(
            `INSERT INTO office_document_revisions(document_id,version,storage_key,size,created_at,created_by)
          SELECT id,?, ?,?,?,? FROM office_documents d
          WHERE id=? AND tenant_id=? AND version=? AND share_version=? AND ${this.accessScope("d", "edit")} AND ${this.enabledScope("d.tenant_id")}`,
          )
          .bind(
            nextVersion,
            storageKey,
            bytes.byteLength,
            updatedAt,
            this.actor.principal.id,
            id,
            row.tenant_id,
            version,
            row.share_version,
            this.actor.principal.id,
          ),
        this.db
          .prepare(
            `UPDATE office_documents SET size=?,version=?,storage_key=?,updated_at=?
          WHERE id=? AND tenant_id=? AND version=? AND share_version=? AND ${this.accessScope("office_documents", "edit")} AND ${this.enabledScope("office_documents.tenant_id")}`,
          )
          .bind(
            bytes.byteLength,
            nextVersion,
            storageKey,
            updatedAt,
            id,
            row.tenant_id,
            version,
            row.share_version,
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
