import type { PagesArchive, PlateNode } from "@savia/studio-shared/pages";
import type { AppActor } from "../auth/types";
import {
  activeTenant,
  activeTenantScope,
  PagesError,
  parsePageContent,
} from "./service";

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME =
  /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/;

type Archive = PagesArchive;
type StoredPage = {
  id: string;
  parent_id: string | null;
  root_id: string;
  title: string;
  kind: "page" | "folder";
  content_json: string;
  version: number;
  updated_at: string;
};
type StoredFile = {
  id: string;
  page_id: string;
  root_id: string;
  tenant_id: number;
  storage_key: string;
  file_name: string;
  mime_type: string;
  size: number;
};

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}
function base64ToBytes(value: string): Uint8Array {
  if (
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value) ||
    /=/.test(value.slice(0, -2))
  )
    throw invalidArchive("Attachment data must be valid base64");
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw invalidArchive("Attachment data must be valid base64");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64(bytes) !== value)
    throw invalidArchive("Attachment data must use canonical base64 encoding");
  return bytes;
}
function invalidArchive(message: string): PagesError {
  return new PagesError(400, "INVALID_ARCHIVE", message);
}
function walkNodes(nodes: PlateNode[], visitor: (node: PlateNode) => void) {
  for (const node of nodes) {
    visitor(node);
    if (node.children) walkNodes(node.children, visitor);
  }
}
function sourceReferences(
  page: Archive["pages"][number],
  importing = false,
): string[] {
  const ids: string[] = [];
  walkNodes(page.content, (node) => {
    if (node.type === "attachment") {
      if (typeof node.fileId !== "string" || !node.fileId)
        throw importing
          ? invalidArchive("An attachment reference is invalid")
          : new PagesError(
              409,
              "PAGE_FILE_MISSING",
              "An attachment reference is invalid",
            );
      ids.push(node.fileId);
    }
  });
  return ids;
}

export async function exportPages(
  db: D1Database,
  actor: AppActor,
  bucket?: R2Bucket,
): Promise<Archive> {
  const tenantId = await activeTenant(db, actor);
  const rows = await db
    .prepare(
      `SELECT id,parent_id,root_id,title,kind,content_json,version,updated_at
     FROM pages WHERE tenant_id=? AND owner_id=? ORDER BY created_at,id`,
    )
    .bind(tenantId, actor.principal.id)
    .all<StoredPage>();
  const source = rows.results ?? [];
  const pages: Archive["pages"] = [];
  let estimatedArchiveBytes = jsonBytes({
    format: "savia-pages",
    version: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    files: [],
  });
  for (const row of source) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(row.content_json);
    } catch {
      throw new PagesError(
        409,
        "PAGE_CONTENT_INVALID",
        "A page contains invalid content",
      );
    }
    const content = parsePageContent(decoded);
    if (row.kind === "folder" && content.length)
      throw new PagesError(
        409,
        "PAGE_CONTENT_INVALID",
        "A folder contains page content",
      );
    const page = {
      id: row.id,
      parentId: row.parent_id,
      title: row.title,
      kind: row.kind,
      content,
    };
    pages.push(page);
    estimatedArchiveBytes += jsonBytes(page) + (pages.length > 1 ? 1 : 0);
    if (estimatedArchiveBytes > MAX_ARCHIVE_BYTES)
      throw new PagesError(
        413,
        "ARCHIVE_TOO_LARGE",
        "The Pages archive exceeds the 50 MB limit",
      );
  }
  const ownedIds = new Set(pages.map((page) => page.id));
  if (pages.some((page) => page.parentId && !ownedIds.has(page.parentId)))
    throw new PagesError(
      409,
      "PAGE_HIERARCHY_INVALID",
      "The owned page hierarchy is incomplete",
    );

  const references = new Map<string, Set<string>>();
  const needed = new Set<string>();
  for (const page of pages) {
    const refs = new Set(sourceReferences(page));
    references.set(page.id, refs);
    for (const fileId of refs) needed.add(fileId);
  }
  const fileRows = await db
    .prepare(
      `SELECT f.id,f.page_id,f.root_id,f.tenant_id,f.storage_key,f.file_name,f.mime_type,f.size
     FROM page_files f JOIN pages p ON p.id=f.page_id
     WHERE p.tenant_id=? AND p.owner_id=?`,
    )
    .bind(tenantId, actor.principal.id)
    .all<StoredFile>();
  const available = new Map(
    (fileRows.results ?? []).map((file) => [
      `${file.page_id}\0${file.id}`,
      file,
    ]),
  );
  const files: Archive["files"] = [];
  if (needed.size && !bucket)
    throw new PagesError(
      503,
      "FILE_STORAGE_UNAVAILABLE",
      "Page file storage is not configured",
    );
  for (const page of pages) {
    for (const fileId of references.get(page.id) ?? []) {
      const file = available.get(`${page.id}\0${fileId}`);
      if (!file || file.tenant_id !== tenantId)
        throw new PagesError(
          409,
          "PAGE_FILE_MISSING",
          "A referenced attachment is unavailable",
        );
      if (
        file.size < 1 ||
        file.size > MAX_FILE_BYTES ||
        !ALLOWED_MIME.test(file.mime_type)
      )
        throw new PagesError(
          409,
          "PAGE_FILE_INVALID",
          "A referenced attachment has unsupported metadata",
        );
      const dataLength = 4 * Math.ceil(file.size / 3);
      const fileWithoutData = {
        id: file.id,
        pageId: file.page_id,
        name: file.file_name,
        mimeType: file.mime_type,
        size: file.size,
        data: "",
      };
      const nextFileSize =
        jsonBytes(fileWithoutData) + dataLength + (files.length ? 1 : 0);
      if (estimatedArchiveBytes + nextFileSize > MAX_ARCHIVE_BYTES)
        throw new PagesError(
          413,
          "ARCHIVE_TOO_LARGE",
          "The Pages archive exceeds the 50 MB limit",
        );
      const object = await bucket!.get(file.storage_key);
      if (!object)
        throw new PagesError(
          409,
          "PAGE_FILE_MISSING",
          "A referenced attachment blob is missing",
        );
      const data = new Uint8Array(
        await new Response(object.body).arrayBuffer(),
      );
      if (data.byteLength !== file.size)
        throw new PagesError(
          409,
          "PAGE_FILE_INVALID",
          "A referenced attachment blob has an unexpected size",
        );
      const dataBase64 = bytesToBase64(data);
      files.push({
        id: file.id,
        pageId: file.page_id,
        name: file.file_name,
        mimeType: file.mime_type,
        size: file.size,
        data: dataBase64,
      });
      estimatedArchiveBytes +=
        jsonBytes({ ...fileWithoutData, data: "" }) +
        dataBase64.length +
        (files.length > 1 ? 1 : 0);
    }
  }

  // Detect edits made while R2 objects were being read so the archive represents one stable snapshot.
  const latest = await db
    .prepare(
      `SELECT id,version,updated_at FROM pages WHERE tenant_id=? AND owner_id=? ORDER BY created_at,id`,
    )
    .bind(tenantId, actor.principal.id)
    .all<Pick<StoredPage, "id" | "version" | "updated_at">>();
  const current = latest.results ?? [];
  if (
    current.length !== source.length ||
    current.some(
      (row, index) =>
        row.id !== source[index]?.id ||
        row.version !== source[index]?.version ||
        row.updated_at !== source[index]?.updated_at,
    )
  )
    throw new PagesError(
      409,
      "EXPORT_CHANGED",
      "Pages changed during export; retry the export",
    );
  await activeTenant(db, actor);
  const archive: Archive = {
    format: "savia-pages",
    version: 1,
    exportedAt: new Date().toISOString(),
    pages,
    files,
  };
  if (jsonBytes(archive) > MAX_ARCHIVE_BYTES)
    throw new PagesError(
      413,
      "ARCHIVE_TOO_LARGE",
      "The Pages archive exceeds the 50 MB limit",
    );
  return archive;
}

type ValidPage = Archive["pages"][number];
type ValidFile = Archive["files"][number] & { bytes: Uint8Array };
function exactKeys(
  value: Record<string, unknown>,
  allowed: string[],
  required: string[],
) {
  return (
    Object.keys(value).every((key) => allowed.includes(key)) &&
    required.every((key) => key in value)
  );
}
function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function validateArchive(input: unknown): {
  pages: ValidPage[];
  files: ValidFile[];
  order: ValidPage[];
} {
  if (jsonBytes(input) > MAX_ARCHIVE_BYTES)
    throw new PagesError(
      413,
      "ARCHIVE_TOO_LARGE",
      "The Pages archive exceeds the 50 MB limit",
    );
  const archive = asObject(input);
  if (
    !archive ||
    !exactKeys(
      archive,
      ["format", "version", "exportedAt", "pages", "files"],
      ["format", "version", "exportedAt", "pages", "files"],
    ) ||
    archive.format !== "savia-pages" ||
    archive.version !== 1 ||
    typeof archive.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(archive.exportedAt)) ||
    !Array.isArray(archive.pages) ||
    !Array.isArray(archive.files)
  )
    throw invalidArchive("Archive header or structure is invalid");
  const pages: ValidPage[] = [];
  const byId = new Map<string, ValidPage>();
  for (const item of archive.pages) {
    const page = asObject(item);
    if (
      !page ||
      !exactKeys(
        page,
        ["id", "parentId", "title", "kind", "content"],
        ["id", "parentId", "title", "kind", "content"],
      ) ||
      typeof page.id !== "string" ||
      !page.id ||
      page.id.length > 128 ||
      (page.parentId !== null &&
        (typeof page.parentId !== "string" ||
          !page.parentId ||
          page.parentId.length > 128)) ||
      typeof page.title !== "string" ||
      !page.title.trim() ||
      page.title.length > 200 ||
      (page.kind !== "page" && page.kind !== "folder") ||
      !Array.isArray(page.content) ||
      byId.has(page.id)
    )
      throw invalidArchive("Archive contains an invalid or duplicate page");
    let content: PlateNode[];
    try {
      content = parsePageContent(page.content);
    } catch {
      throw invalidArchive("Archive contains invalid page content");
    }
    const normalized: ValidPage = {
      id: page.id,
      parentId: page.parentId as string | null,
      title: page.title.trim(),
      kind: page.kind,
      content,
    };
    byId.set(normalized.id, normalized);
    pages.push(normalized);
  }
  const children = new Map<string, ValidPage[]>();
  const order: ValidPage[] = [];
  const ready = pages.filter((page) => page.parentId === null);
  for (const page of pages) {
    if (!page.parentId) continue;
    if (!byId.has(page.parentId))
      throw invalidArchive("Archive page hierarchy contains an orphan");
    const siblings = children.get(page.parentId) ?? [];
    siblings.push(page);
    children.set(page.parentId, siblings);
  }
  for (let index = 0; index < ready.length; index++) {
    const page = ready[index]!;
    order.push(page);
    for (const child of children.get(page.id) ?? []) ready.push(child);
  }
  if (order.length !== pages.length)
    throw invalidArchive("Archive page hierarchy contains a cycle");
  for (const page of pages)
    if (page.kind === "folder" && page.content.length)
      throw invalidArchive("Folders cannot contain page content");

  const files: ValidFile[] = [];
  const byFileId = new Map<string, ValidFile>();
  const referencePages = new Map<string, Set<string>>();
  for (const page of pages) {
    const refs = new Set(sourceReferences(page, true));
    referencePages.set(page.id, refs);
  }
  for (const item of archive.files) {
    const file = asObject(item);
    if (
      !file ||
      !exactKeys(
        file,
        ["id", "pageId", "name", "mimeType", "size", "data"],
        ["id", "pageId", "name", "mimeType", "size", "data"],
      ) ||
      typeof file.id !== "string" ||
      !file.id ||
      file.id.length > 128 ||
      byFileId.has(file.id) ||
      typeof file.pageId !== "string" ||
      !byId.has(file.pageId) ||
      typeof file.name !== "string" ||
      !file.name.trim() ||
      file.name.length > 200 ||
      typeof file.mimeType !== "string" ||
      !ALLOWED_MIME.test(file.mimeType) ||
      typeof file.size !== "number" ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      file.size > MAX_FILE_BYTES ||
      typeof file.data !== "string"
    )
      throw invalidArchive(
        "Archive contains invalid or duplicate attachment metadata",
      );
    if (file.data.length !== 4 * Math.ceil(file.size / 3))
      throw invalidArchive(
        "Attachment data length does not match its declared size",
      );
    const bytes = base64ToBytes(file.data);
    if (bytes.byteLength !== file.size)
      throw invalidArchive("Attachment size does not match its data");
    if (!referencePages.get(file.pageId)?.has(file.id))
      throw invalidArchive("An attachment is not referenced by its page");
    const normalized: ValidFile = {
      id: file.id,
      pageId: file.pageId,
      name: file.name.trim(),
      mimeType: file.mimeType,
      size: file.size,
      data: file.data,
      bytes,
    };
    byFileId.set(normalized.id, normalized);
    files.push(normalized);
  }
  for (const [pageId, refs] of referencePages) {
    for (const fileId of refs) {
      const file = byFileId.get(fileId);
      if (!file || file.pageId !== pageId)
        throw invalidArchive("A page references a missing attachment");
    }
  }
  return { pages, files, order };
}

function detachCollections(content: PlateNode[]): PlateNode[] {
  const rewrite = (nodes: PlateNode[]): PlateNode[] =>
    nodes.map((node) => {
      if (node.type === "collection") {
        const collection =
          typeof node.collection === "string" ? node.collection : "unknown";
        return {
          type: "p",
          children: [
            {
              text: `Collection block detached during import (source collection: ${collection}).`,
            },
          ],
        };
      }
      return node.children
        ? { ...node, children: rewrite(node.children) }
        : { ...node };
    });
  return rewrite(content);
}
function textContent(nodes: PlateNode[]): string {
  const pieces: string[] = [];
  walkNodes(nodes, (node) => {
    if (typeof node.text === "string") pieces.push(node.text);
  });
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}

export async function importPages(
  db: D1Database,
  actor: AppActor,
  bucket: R2Bucket | undefined,
  input: unknown,
): Promise<{ pages: number; folders: number; files: number }> {
  const validated = validateArchive(input);
  if (validated.files.length && !bucket)
    throw new PagesError(
      503,
      "FILE_STORAGE_UNAVAILABLE",
      "Page file storage is not configured",
    );
  const tenantId = await activeTenant(db, actor);
  const generatedIds = new Map(
    validated.pages.map((page) => [page.id, crypto.randomUUID()]),
  );
  const generatedFileIds = new Map(
    validated.files.map((file) => [file.id, crypto.randomUUID()]),
  );
  const roots = new Map<string, string>();
  const timestamp = new Date().toISOString();
  const insertedBlobKeys: string[] = [];
  try {
    for (const file of validated.files) {
      const newFileId = generatedFileIds.get(file.id)!;
      const storageKey = `pages/${newFileId}`;
      insertedBlobKeys.push(storageKey);
      await bucket!.put(storageKey, file.bytes, {
        httpMetadata: { contentType: file.mimeType },
        customMetadata: { pageId: generatedIds.get(file.pageId)! },
      });
    }
    const statements: D1PreparedStatement[] = [];
    const guardId = crypto.randomUUID();
    const activeScope = activeTenantScope("actor.id", "?");
    statements.push(
      db
        .prepare(
          `INSERT INTO studio_write_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM identity_principal actor WHERE actor.id=? AND actor.is_active=1 AND ${activeScope}) THEN 1 ELSE 0 END`,
        )
        .bind(guardId, actor.principal.id, tenantId, tenantId, tenantId),
    );
    for (const page of validated.order) {
      const newId = generatedIds.get(page.id)!;
      const parentId = page.parentId ? generatedIds.get(page.parentId)! : null;
      const rootId = page.parentId ? roots.get(page.parentId)! : newId;
      roots.set(page.id, rootId);
      const content = detachCollections(page.content);
      walkNodes(content, (node) => {
        if (node.type === "attachment" && typeof node.fileId === "string")
          node.fileId = generatedFileIds.get(node.fileId)!;
      });
      const serialized = JSON.stringify(content);
      statements.push(
        db
          .prepare(
            `INSERT INTO pages(id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,search_text,binding_json,version,share_version,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,NULL,1,1,?,?)`,
          )
          .bind(
            newId,
            tenantId,
            actor.principal.id,
            parentId,
            rootId,
            page.title,
            page.kind,
            serialized,
            textContent(content).slice(0, 10000),
            timestamp,
            timestamp,
          ),
      );
      statements.push(
        db
          .prepare(
            "INSERT INTO page_revisions(page_id,version,title,content_json,created_at) VALUES(?,1,?,?,?)",
          )
          .bind(newId, page.title, serialized, timestamp),
      );
    }
    for (const file of validated.files) {
      statements.push(
        db
          .prepare(
            `INSERT INTO page_files(id,page_id,root_id,tenant_id,storage_key,file_name,mime_type,size,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            generatedFileIds.get(file.id)!,
            generatedIds.get(file.pageId)!,
            roots.get(file.pageId)!,
            tenantId,
            `pages/${generatedFileIds.get(file.id)!}`,
            file.name,
            file.mimeType,
            file.size,
            timestamp,
          ),
      );
    }
    statements.push(
      db.prepare("DELETE FROM studio_write_guards WHERE id=?").bind(guardId),
    );
    if (statements.length) await db.batch(statements);
  } catch (failure) {
    await Promise.allSettled(
      insertedBlobKeys.map((key) => bucket!.delete(key)),
    );
    throw failure;
  }
  return {
    pages: validated.pages.filter((page) => page.kind === "page").length,
    folders: validated.pages.filter((page) => page.kind === "folder").length,
    files: validated.files.length,
  };
}
