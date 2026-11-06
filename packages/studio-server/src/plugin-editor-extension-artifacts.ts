import type { Env } from "./context";
import { dialectFor } from "@savia/db/dialect";
import { EDITOR_EXTENSION_MAX_COMPRESSED_BYTES } from "./plugin-editor-marketplace";

export const EDITOR_EXTENSION_TENANT_QUOTA_BYTES = 128 * 1024 * 1024;
export const EDITOR_EXTENSION_INSPECTION_TTL_MS = 15 * 60 * 1000;
export const EDITOR_EXTENSION_MAX_INSTALLATIONS_PER_PROJECT = 32;

export type EditorExtensionInspection = {
  inspectionId: string;
  metadata: {
    id: string;
    publisher: string;
    name: string;
    version: string;
    sha256: string;
    license: string | null;
    compressedBytes: number;
    expandedBytes: number;
    dependencies: string[];
    compatibility: { supported: boolean; reason: string | null };
  };
  manifestSummary: {
    description: string | null;
    categories: string[];
    contributes: Record<string, unknown>;
  };
};

export type InstalledEditorExtension = EditorExtensionInspection["metadata"] & {
  installationId: string;
  source: "open-vsx" | "vsix";
  createdAt: string;
};

type Scope = { tenantId: string; principalId: string };
type InspectionRow = {
  id: string;
  metadata_json: string;
  manifest_json: string;
  object_key: string;
  source: "open-vsx" | "vsix";
  expires_at: string;
  reservation_bytes: number;
};
type ExpiredInspectionRow = {
  id: string;
  object_key: string;
  tenant_id: string;
  principal_id: string;
};
type InstallationRow = {
  id: string;
  metadata_json: string;
  source: "open-vsx" | "vsix";
  created_at: string;
  object_key: string;
};

function prefix(scope: Scope): string {
  return `plugin-editor/${encodeURIComponent(scope.tenantId)}/${encodeURIComponent(scope.principalId)}`;
}

function parseMetadata(json: string): EditorExtensionInspection["metadata"] {
  return JSON.parse(json) as EditorExtensionInspection["metadata"];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function deleteOrRecordEditorObject(
  db: D1Database,
  files: R2Bucket,
  scope: Scope,
  objectKey: string,
): Promise<void> {
  try {
    await files.delete(objectKey);
  } catch {
    await db
      .prepare(
        "INSERT OR IGNORE INTO plugin_editor_extension_cleanup (object_key,tenant_id,principal_id,created_at) VALUES(?,?,?,?)",
      )
      .bind(
        objectKey,
        scope.tenantId,
        scope.principalId,
        new Date().toISOString(),
      )
      .run();
  }
}

function summaryFromManifest(manifest: Record<string, unknown>) {
  const contributes =
    manifest.contributes && typeof manifest.contributes === "object"
      ? (manifest.contributes as Record<string, unknown>)
      : {};
  const categories = Array.isArray(manifest.categories)
    ? manifest.categories
        .filter((x): x is string => typeof x === "string")
        .slice(0, 20)
        .map((category) => category.slice(0, 100))
    : [];
  // Keep only bounded contribution counts in D1 and API responses. A package
  // manifest can be much larger than the editor needs for its install preview.
  const contributionSummary: Record<string, unknown> = {};
  for (const key of Object.keys(contributes).sort().slice(0, 32)) {
    const value = contributes[key];
    contributionSummary[key.slice(0, 100)] = {
      count: Array.isArray(value)
        ? value.length
        : value && typeof value === "object"
          ? Object.keys(value).length
          : value === undefined
            ? 0
            : 1,
    };
  }
  return {
    description:
      typeof manifest.description === "string"
        ? manifest.description.slice(0, 1000)
        : null,
    categories,
    contributes: contributionSummary,
  };
}

export async function stageEditorExtensionInspection(
  db: D1Database,
  files: R2Bucket,
  scope: Scope,
  input: {
    bytes: Uint8Array;
    source: "open-vsx" | "vsix";
    runtimeVersion: string;
  },
): Promise<EditorExtensionInspection> {
  if (
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > EDITOR_EXTENSION_MAX_COMPRESSED_BYTES
  )
    throw Object.assign(new Error("VSIX must be between 1 byte and 20 MiB."), {
      status: 413,
    });
  const { parseEditorVsix } =
    await import("@savia/studio-shared/plugin-editor-vsix");
  const parsed = await parseEditorVsix(input.bytes, input.runtimeVersion);
  if (parsed.metadata.compressedBytes !== input.bytes.byteLength)
    throw new Error("VSIX compressed size did not match its bytes.");

  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = new Date(
    now + EDITOR_EXTENSION_INSPECTION_TTL_MS,
  ).toISOString();
  const objectKey = `${prefix(scope)}/inspections/${id}.vsix`;
  const manifestSummary = summaryFromManifest(parsed.manifest);
  // The conditional INSERT is one SQLite statement, so concurrent inspection
  // reservations cannot push retained and staged package data over the tenant cap.
  const retained = await db
    .prepare(
      "SELECT 1 FROM plugin_editor_extension_artifacts WHERE tenant_id=? AND principal_id=? AND sha256=?",
    )
    .bind(scope.tenantId, scope.principalId, parsed.metadata.sha256)
    .first();
  const reservation = retained ? 0 : input.bytes.byteLength;
  const inserted = await db
    .prepare(
      `INSERT INTO plugin_editor_extension_inspections
       (id,tenant_id,principal_id,source,metadata_json,manifest_json,object_key,created_at,expires_at,reservation_bytes)
     SELECT ?,?,?,?,?,?,?,?,?,?
     WHERE COALESCE((SELECT SUM(compressed_bytes) FROM plugin_editor_extension_artifacts WHERE tenant_id=?),0)
       + COALESCE((SELECT SUM(reservation_bytes) FROM plugin_editor_extension_inspections WHERE tenant_id=? AND expires_at>?),0)
       + ? <= ?`,
    )
    .bind(
      id,
      scope.tenantId,
      scope.principalId,
      input.source,
      JSON.stringify(parsed.metadata),
      JSON.stringify(manifestSummary),
      objectKey,
      new Date(now).toISOString(),
      expiresAt,
      reservation,
      scope.tenantId,
      scope.tenantId,
      new Date(now).toISOString(),
      reservation,
      EDITOR_EXTENSION_TENANT_QUOTA_BYTES,
    )
    .run();
  if (!inserted.meta.changes)
    throw Object.assign(
      new Error("Tenant editor extension storage quota exceeded."),
      { status: 413 },
    );
  try {
    await files.put(objectKey, input.bytes, {
      httpMetadata: { contentType: "application/zip" },
    });
  } catch (error) {
    await db
      .prepare(
        "DELETE FROM plugin_editor_extension_inspections WHERE id=? AND tenant_id=? AND principal_id=?",
      )
      .bind(id, scope.tenantId, scope.principalId)
      .run();
    await deleteOrRecordEditorObject(db, files, scope, objectKey);
    throw error;
  }
  return {
    inspectionId: id,
    metadata: parsed.metadata,
    manifestSummary,
  };
}

export async function expireEditorExtensionInspections(
  db: D1Database,
  files: R2Bucket,
  scope: Scope,
  limit = 50,
): Promise<void> {
  const now = new Date().toISOString();
  const rows = await db
    .prepare(
      `SELECT id,object_key,tenant_id,principal_id FROM plugin_editor_extension_inspections
     WHERE tenant_id=? AND expires_at<=? ORDER BY expires_at LIMIT ?`,
    )
    .bind(
      scope.tenantId,
      now,
      Math.max(1, Math.min(limit, 100)),
    )
    .all<ExpiredInspectionRow>();
  for (const row of rows.results) {
    try {
      await files.delete(row.object_key);
    } catch {
      // The persisted row supplies cleanup ownership; request principal is not used.
      await db
        .prepare(
          "INSERT OR IGNORE INTO plugin_editor_extension_cleanup (object_key,tenant_id,principal_id,created_at) VALUES(?,?,?,?)",
        )
        .bind(
          row.object_key,
          row.tenant_id,
          row.principal_id,
          new Date().toISOString(),
        )
        .run();
    }
    await db
      .prepare(
        "DELETE FROM plugin_editor_extension_inspections WHERE id=? AND tenant_id=? AND principal_id=? AND expires_at<=?",
      )
      .bind(row.id, row.tenant_id, row.principal_id, now)
      .run();
  }
}

export async function installStagedEditorExtension(
  db: D1Database,
  files: R2Bucket,
  scope: Scope,
  inspectionId: string,
): Promise<InstalledEditorExtension> {
  await expireEditorExtensionInspections(db, files, scope);
  const inspection = await db
    .prepare(
      `SELECT id,metadata_json,manifest_json,object_key,source,expires_at,reservation_bytes
     FROM plugin_editor_extension_inspections WHERE id=? AND tenant_id=? AND principal_id=? AND expires_at>?`,
    )
    .bind(
      inspectionId,
      scope.tenantId,
      scope.principalId,
      new Date().toISOString(),
    )
    .first<InspectionRow>();
  if (!inspection)
    throw Object.assign(new Error("Inspection not found or expired."), {
      status: 404,
    });
  const metadata = parseMetadata(inspection.metadata_json);
  if (!metadata.compatibility.supported)
    throw Object.assign(
      new Error(
        metadata.compatibility.reason ?? "Extension is not compatible.",
      ),
      { status: 422 },
    );
  const existing = await db
    .prepare(
      `SELECT id,metadata_json,source,created_at,object_key FROM plugin_editor_extension_installations
     WHERE tenant_id=? AND principal_id=? AND lower(publisher)=? AND lower(name)=? AND version=?`,
    )
    .bind(
      scope.tenantId,
      scope.principalId,
      metadata.publisher.toLowerCase(),
      metadata.name.toLowerCase(),
      metadata.version,
    )
    .first<InstallationRow>();
  if (existing) {
    const previous = parseMetadata(existing.metadata_json);
    if (previous.sha256 !== metadata.sha256) {
      await removeInspection(db, files, inspection, scope);
      throw Object.assign(
        new Error(
          "This extension version is already installed with different bytes.",
        ),
        { status: 409 },
      );
    }
    await removeInspection(db, files, inspection, scope);
    return {
      ...previous,
      installationId: existing.id,
      source: existing.source,
      createdAt: existing.created_at,
    };
  }

  const staged = await files.get(inspection.object_key);
  if (!staged) {
    await removeInspection(db, files, inspection, scope);
    throw Object.assign(new Error("Staged extension package is missing."), {
      status: 404,
    });
  }
  const stagedBytes = new Uint8Array(await staged.arrayBuffer());
  if (
    stagedBytes.byteLength !== metadata.compressedBytes ||
    (await sha256Hex(stagedBytes)) !== metadata.sha256
  ) {
    await removeInspection(db, files, inspection, scope);
    throw Object.assign(
      new Error("Staged extension package did not match its inspected digest."),
      { status: 409 },
    );
  }
  // The R2 write separates the advisory artifact lookup from the final D1
  // batch. Always stage a unique candidate: a retained artifact can be
  // uninstalled and retired while this request is between those operations.
  const candidateKey = `${prefix(scope)}/packages/${metadata.sha256}/${crypto.randomUUID()}.vsix`;
  try {
    await files.put(candidateKey, stagedBytes, {
      httpMetadata: { contentType: "application/zip" },
    });
  } catch (error) {
    await deleteOrRecordEditorObject(db, files, scope, candidateKey);
    await removeInspection(db, files, inspection, scope);
    throw error;
  }
  const candidateWritten = true;
  const retainedObjectKey = candidateKey;
  const installationId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const statements = [
    db
      .prepare(
        `INSERT INTO plugin_editor_extension_artifacts
       (tenant_id,principal_id,sha256,object_key,compressed_bytes,expanded_bytes,created_at,reference_count)
       SELECT ?,?,?,?,?,?,?,0
       WHERE EXISTS (
         SELECT 1 FROM plugin_editor_extension_inspections
         WHERE id=? AND tenant_id=? AND principal_id=? AND expires_at>?
       )
       AND COALESCE((SELECT SUM(compressed_bytes) FROM plugin_editor_extension_artifacts WHERE tenant_id=?),0)
         + COALESCE((SELECT SUM(reservation_bytes) FROM plugin_editor_extension_inspections
             WHERE tenant_id=? AND expires_at>? AND id<>?),0)
         + CASE WHEN EXISTS (
             SELECT 1 FROM plugin_editor_extension_artifacts WHERE tenant_id=? AND principal_id=? AND sha256=?
           ) THEN 0 ELSE ? END <= ?
       ON CONFLICT(tenant_id,principal_id,sha256) DO NOTHING`,
      )
      .bind(
        scope.tenantId,
        scope.principalId,
        metadata.sha256,
        retainedObjectKey,
        metadata.compressedBytes,
        metadata.expandedBytes,
        createdAt,
        inspection.id,
        scope.tenantId,
        scope.principalId,
        createdAt,
        scope.tenantId,
        scope.tenantId,
        createdAt,
        inspection.id,
        scope.tenantId,
        scope.principalId,
        metadata.sha256,
        metadata.compressedBytes,
        EDITOR_EXTENSION_TENANT_QUOTA_BYTES,
      ),
    db
      .prepare(
        `INSERT INTO plugin_editor_extension_installations
       (id,tenant_id,principal_id,publisher,name,version,sha256,metadata_json,source,object_key,created_at)
       SELECT ?,?,?,?,?,?,?,?,?,(SELECT object_key FROM plugin_editor_extension_artifacts
         WHERE tenant_id=? AND principal_id=? AND sha256=?),?
       WHERE EXISTS (
         SELECT 1 FROM plugin_editor_extension_artifacts
         WHERE tenant_id=? AND principal_id=? AND sha256=?
       )
       AND EXISTS (
         SELECT 1 FROM plugin_editor_extension_inspections
         WHERE id=? AND tenant_id=? AND principal_id=? AND expires_at>?
       )`,
      )
      .bind(
        installationId,
        scope.tenantId,
        scope.principalId,
        metadata.publisher.toLowerCase(),
        metadata.name.toLowerCase(),
        metadata.version,
        metadata.sha256,
        JSON.stringify(metadata),
        inspection.source,
        scope.tenantId,
        scope.principalId,
        metadata.sha256,
        createdAt,
        scope.tenantId,
        scope.principalId,
        metadata.sha256,
        inspection.id,
        scope.tenantId,
        scope.principalId,
        createdAt,
      ),
    db
      .prepare(
        `UPDATE plugin_editor_extension_artifacts SET reference_count=reference_count+1
       WHERE tenant_id=? AND principal_id=? AND sha256=?
         AND EXISTS (SELECT 1 FROM plugin_editor_extension_installations WHERE id=? AND tenant_id=? AND principal_id=?)`,
      )
      .bind(
        scope.tenantId,
        scope.principalId,
        metadata.sha256,
        installationId,
        scope.tenantId,
        scope.principalId,
      ),
    db
      .prepare(
        `UPDATE plugin_editor_extension_inspections SET reservation_bytes=0
         WHERE id=? AND tenant_id=? AND principal_id=? AND expires_at>?
           AND EXISTS (SELECT 1 FROM plugin_editor_extension_installations WHERE id=? AND tenant_id=? AND principal_id=?)`,
      )
      .bind(
        inspection.id,
        scope.tenantId,
        scope.principalId,
        createdAt,
        installationId,
        scope.tenantId,
        scope.principalId,
      ),
  ];
  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch (error) {
    const retainedAfterRace = await db
      .prepare(
        "SELECT object_key FROM plugin_editor_extension_artifacts WHERE tenant_id=? AND principal_id=? AND sha256=?",
      )
      .bind(scope.tenantId, scope.principalId, metadata.sha256)
      .first<{ object_key: string }>();
    if (candidateWritten) {
      if (retainedAfterRace?.object_key === candidateKey)
        await retireUnreferencedEditorArtifact(
          db,
          files,
          scope,
          metadata.sha256,
          candidateKey,
        );
      else await deleteOrRecordEditorObject(db, files, scope, candidateKey);
    }
    const raced = await db
      .prepare(
        `SELECT id,metadata_json,source,created_at FROM plugin_editor_extension_installations
       WHERE tenant_id=? AND principal_id=? AND lower(publisher)=? AND lower(name)=? AND version=?`,
      )
      .bind(
        scope.tenantId,
        scope.principalId,
        metadata.publisher.toLowerCase(),
        metadata.name.toLowerCase(),
        metadata.version,
      )
      .first<
        Pick<InstallationRow, "id" | "metadata_json" | "source" | "created_at">
      >();
    if (raced) {
      const prior = parseMetadata(raced.metadata_json);
      await removeInspection(db, files, inspection, scope);
      if (prior.sha256 !== metadata.sha256)
        throw Object.assign(
          new Error(
            "This extension version is already installed with different bytes.",
          ),
          { status: 409 },
        );
      return {
        ...prior,
        installationId: raced.id,
        source: raced.source,
        createdAt: raced.created_at,
      };
    }
    throw error;
  }
  if (results[1]?.meta.changes !== 1) {
    const activeInspection = await db
      .prepare(
        "SELECT 1 FROM plugin_editor_extension_inspections WHERE id=? AND tenant_id=? AND principal_id=? AND expires_at>?",
      )
      .bind(
        inspection.id,
        scope.tenantId,
        scope.principalId,
        new Date().toISOString(),
      )
      .first();
    const retained = await db
      .prepare(
        "SELECT object_key FROM plugin_editor_extension_artifacts WHERE tenant_id=? AND principal_id=? AND sha256=?",
      )
      .bind(scope.tenantId, scope.principalId, metadata.sha256)
      .first<{ object_key: string }>();
    if (candidateWritten && retained?.object_key === candidateKey) {
      await retireUnreferencedEditorArtifact(
        db,
        files,
        scope,
        metadata.sha256,
        candidateKey,
      );
    } else if (candidateWritten) {
      await deleteOrRecordEditorObject(db, files, scope, candidateKey);
    }
    await removeInspection(db, files, inspection, scope);
    throw Object.assign(
      new Error(
        !activeInspection
          ? "Inspection not found or expired."
          : "Tenant editor extension storage quota exceeded.",
      ),
      { status: activeInspection ? 413 : 404 },
    );
  }
  const winningArtifact = await db
    .prepare(
      "SELECT object_key FROM plugin_editor_extension_artifacts WHERE tenant_id=? AND principal_id=? AND sha256=?",
    )
    .bind(scope.tenantId, scope.principalId, metadata.sha256)
    .first<{ object_key: string }>();
  if (candidateWritten && winningArtifact?.object_key !== candidateKey)
    await deleteOrRecordEditorObject(db, files, scope, candidateKey);
  await removeInspection(db, files, inspection, scope);
  return { ...metadata, installationId, source: inspection.source, createdAt };
}

async function retireUnreferencedEditorArtifact(
  db: D1Database,
  files: R2Bucket,
  scope: Scope,
  sha256: string,
  objectKey: string,
) {
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO plugin_editor_extension_cleanup(object_key,tenant_id,principal_id,created_at)
         SELECT object_key,tenant_id,principal_id,? FROM plugin_editor_extension_artifacts
         WHERE tenant_id=? AND principal_id=? AND sha256=? AND object_key=? AND reference_count=0
           AND NOT EXISTS (SELECT 1 FROM plugin_editor_extension_installations WHERE tenant_id=? AND principal_id=? AND sha256=?)`,
      )
      .bind(
        new Date().toISOString(),
        scope.tenantId,
        scope.principalId,
        sha256,
        objectKey,
        scope.tenantId,
        scope.principalId,
        sha256,
      ),
    db
      .prepare(
        `DELETE FROM plugin_editor_extension_artifacts
         WHERE tenant_id=? AND principal_id=? AND sha256=? AND object_key=? AND reference_count=0
           AND NOT EXISTS (SELECT 1 FROM plugin_editor_extension_installations WHERE tenant_id=? AND principal_id=? AND sha256=?)`,
      )
      .bind(
        scope.tenantId,
        scope.principalId,
        sha256,
        objectKey,
        scope.tenantId,
        scope.principalId,
        sha256,
      ),
  ]);
  await cleanupEditorExtensionObjects(db, files, scope);
}

async function removeInspection(
  db: D1Database,
  files: R2Bucket,
  inspection: InspectionRow,
  scope: Scope,
) {
  try {
    await files.delete(inspection.object_key);
  } catch {
    await db
      .prepare(
        "INSERT OR IGNORE INTO plugin_editor_extension_cleanup (object_key,tenant_id,principal_id,created_at) VALUES(?,?,?,?)",
      )
      .bind(
        inspection.object_key,
        scope.tenantId,
        scope.principalId,
        new Date().toISOString(),
      )
      .run();
  }
  await db
    .prepare(
      "DELETE FROM plugin_editor_extension_inspections WHERE id=? AND tenant_id=? AND principal_id=?",
    )
    .bind(inspection.id, scope.tenantId, scope.principalId)
    .run();
}

export async function listOwnedEditorExtensions(
  db: D1Database,
  scope: Scope,
): Promise<InstalledEditorExtension[]> {
  const rows = await db
    .prepare(
      `SELECT id,metadata_json,source,created_at FROM plugin_editor_extension_installations
     WHERE tenant_id=? AND principal_id=? ORDER BY publisher,name,version`,
    )
    .bind(scope.tenantId, scope.principalId)
    .all<
      Pick<InstallationRow, "id" | "metadata_json" | "source" | "created_at">
    >();
  return rows.results.map((row) => ({
    ...parseMetadata(row.metadata_json),
    installationId: row.id,
    source: row.source,
    createdAt: row.created_at,
  }));
}

export async function findOwnedEditorExtension(
  db: D1Database,
  input: Scope & { installationId: string; sha256?: string },
): Promise<InstalledEditorExtension | null> {
  const row = await db
    .prepare(
      `SELECT id,metadata_json,source,created_at FROM plugin_editor_extension_installations
     WHERE tenant_id=? AND principal_id=? AND id=? AND (? IS NULL OR sha256=?)`,
    )
    .bind(
      input.tenantId,
      input.principalId,
      input.installationId,
      input.sha256 ?? null,
      input.sha256 ?? null,
    )
    .first<
      Pick<InstallationRow, "id" | "metadata_json" | "source" | "created_at">
    >();
  return row
    ? {
        ...parseMetadata(row.metadata_json),
        installationId: row.id,
        source: row.source,
        createdAt: row.created_at,
      }
    : null;
}

export async function readOwnedEditorExtensionPackage(
  db: D1Database,
  files: R2Bucket,
  input: Scope & { installationId: string },
): Promise<R2ObjectBody | null> {
  const row = await db
    .prepare(
      `SELECT object_key FROM plugin_editor_extension_installations WHERE tenant_id=? AND principal_id=? AND id=?`,
    )
    .bind(input.tenantId, input.principalId, input.installationId)
    .first<{ object_key: string }>();
  return row ? files.get(row.object_key) : null;
}

export async function uninstallOwnedEditorExtension(
  db: D1Database,
  files: R2Bucket,
  input: Scope & { installationId: string },
): Promise<{ removed: boolean; projectIds?: string[] }> {
  const row = await db
    .prepare(
      `SELECT id,sha256,object_key FROM plugin_editor_extension_installations WHERE tenant_id=? AND principal_id=? AND id=?`,
    )
    .bind(input.tenantId, input.principalId, input.installationId)
    .first<{ id: string; sha256: string; object_key: string }>();
  if (!row) return { removed: false };
  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM plugin_editor_extension_installations AS installation
         WHERE installation.id=? AND installation.tenant_id=? AND installation.principal_id=?
           AND NOT EXISTS (
             SELECT 1 FROM plugin_authoring_projects p,${dialectFor(db).jsonEach("p.installed_editor_extensions", "$", "editor_extension_ref")}
             WHERE p.tenant_id=installation.tenant_id AND p.principal_id=installation.principal_id
               AND ${dialectFor(db).jsonText("editor_extension_ref.value", "$.installationId")} = installation.id
           )`,
      )
      .bind(row.id, input.tenantId, input.principalId),
    db
      .prepare(
        `UPDATE plugin_editor_extension_artifacts SET reference_count=(
           SELECT COUNT(*) FROM plugin_editor_extension_installations
           WHERE tenant_id=? AND principal_id=? AND sha256=?
         ) WHERE tenant_id=? AND principal_id=? AND sha256=?`,
      )
      .bind(
        input.tenantId,
        input.principalId,
        row.sha256,
        input.tenantId,
        input.principalId,
        row.sha256,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO plugin_editor_extension_cleanup(object_key,tenant_id,principal_id,created_at)
         SELECT object_key,tenant_id,principal_id,? FROM plugin_editor_extension_artifacts
         WHERE tenant_id=? AND principal_id=? AND sha256=? AND reference_count=0
           AND NOT EXISTS (SELECT 1 FROM plugin_editor_extension_installations WHERE tenant_id=? AND principal_id=? AND sha256=?)`,
      )
      .bind(
        new Date().toISOString(),
        input.tenantId,
        input.principalId,
        row.sha256,
        input.tenantId,
        input.principalId,
        row.sha256,
      ),
    db
      .prepare(
        `DELETE FROM plugin_editor_extension_artifacts
         WHERE tenant_id=? AND principal_id=? AND sha256=? AND reference_count=0
           AND NOT EXISTS (SELECT 1 FROM plugin_editor_extension_installations WHERE tenant_id=? AND principal_id=? AND sha256=?)
           AND EXISTS (SELECT 1 FROM plugin_editor_extension_cleanup WHERE object_key=? AND tenant_id=? AND principal_id=?)`,
      )
      .bind(
        input.tenantId,
        input.principalId,
        row.sha256,
        input.tenantId,
        input.principalId,
        row.sha256,
        row.object_key,
        input.tenantId,
        input.principalId,
      ),
  ]);
  if (results[0]?.meta.changes !== 1) {
    const refs = await db
      .prepare(
        `SELECT DISTINCT p.id FROM plugin_authoring_projects p,${dialectFor(db).jsonEach("p.installed_editor_extensions", "$", "editor_extension_ref")}
         WHERE p.tenant_id=? AND p.principal_id=? AND ${dialectFor(db).jsonText("editor_extension_ref.value", "$.installationId")} = ? ORDER BY p.id`,
      )
      .bind(input.tenantId, input.principalId, input.installationId)
      .all<{ id: string }>();
    return refs.results.length
      ? { removed: false, projectIds: refs.results.map((x) => x.id) }
      : { removed: false };
  }
  // The row was retired and cleanup durably queued in the same batch. Reinstalls
  // use a new incarnation key, so this delete cannot remove their live object.
  await cleanupEditorExtensionObjects(db, files, input);
  return { removed: true };
}

export async function cleanupEditorExtensionObjects(
  db: D1Database,
  files: R2Bucket,
  scope: Scope,
  limit = 25,
) {
  const rows = await db
    .prepare(
      "SELECT object_key,tenant_id,principal_id FROM plugin_editor_extension_cleanup WHERE tenant_id=? ORDER BY created_at LIMIT ?",
    )
    .bind(scope.tenantId, Math.max(1, Math.min(limit, 100)))
    .all<{ object_key: string; tenant_id: string; principal_id: string }>();
  for (const row of rows.results) {
    try {
      const retained = await db
        .prepare(
          "SELECT reference_count FROM plugin_editor_extension_artifacts WHERE tenant_id=? AND principal_id=? AND object_key=?",
        )
        .bind(row.tenant_id, row.principal_id, row.object_key)
        .first<{ reference_count: number }>();
      if (retained && retained.reference_count > 0) {
        await db
          .prepare(
            "DELETE FROM plugin_editor_extension_cleanup WHERE object_key=? AND tenant_id=? AND principal_id=?",
          )
          .bind(row.object_key, row.tenant_id, row.principal_id)
          .run();
        continue;
      }
      await files.delete(row.object_key);
      if (retained)
        await db
          .prepare(
            "DELETE FROM plugin_editor_extension_artifacts WHERE tenant_id=? AND principal_id=? AND object_key=? AND reference_count=0",
          )
          .bind(row.tenant_id, row.principal_id, row.object_key)
          .run();
      await db
        .prepare(
          "DELETE FROM plugin_editor_extension_cleanup WHERE object_key=? AND tenant_id=? AND principal_id=?",
        )
        .bind(row.object_key, row.tenant_id, row.principal_id)
        .run();
    } catch {
      /* retry on the next operation */
    }
  }
}

export async function expireStaleInspectionsOnRequest(
  c: { env: Env["Bindings"] },
  scope: Scope,
) {
  await cleanupEditorExtensionObjects(c.env.DB, c.env.FILES, scope);
  await expireEditorExtensionInspections(c.env.DB, c.env.FILES, scope);
}
