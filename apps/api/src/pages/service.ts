import type {
  PageBinding,
  PageDocument,
  PageFile,
  PageKind,
  PageMember,
  PageRevision,
  PageRole,
  PageShare,
  PageShares,
  PlateNode,
} from "@savia/studio-shared/pages";
import { parseIssueLink } from "@savia/studio-shared/issue-links";
import type { AppActor } from "../auth/types";

type PageRow = {
  id: string;
  tenant_id: number;
  owner_id: string;
  parent_id: string | null;
  root_id: string;
  title: string;
  kind: PageKind;
  content_json: string;
  search_text: string;
  binding_json: string | null;
  version: number;
  share_version: number;
  created_at: string;
  updated_at: string;
  is_shared?: number;
};

function isPostgresSerializationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "40001"
  );
}

function versionConflict(message: string): PagesError {
  return new PagesError(409, "VERSION_CONFLICT", message);
}

function activeTenantScope(principal: string, tenant: string): string {
  return `((${tenant}=0 AND
    (NOT EXISTS(SELECT 1 FROM identity_tenant_membership m WHERE m.principal_id=${principal} AND m.is_active=1) OR
     EXISTS(SELECT 1 FROM identity_tenant_membership m JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1 WHERE m.principal_id=${principal} AND m.tenant_id=0 AND m.is_active=1))) OR
    (${tenant}<>0 AND EXISTS(SELECT 1 FROM identity_tenant_membership m JOIN tenants t ON t.id=m.tenant_id WHERE m.principal_id=${principal} AND m.tenant_id=${tenant} AND m.is_active=1 AND t.is_active=1)))`;
}

export class PagesError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const text = (value: string) => value.replace(/\s+/g, " ").trim();

export function parsePageContent(value: unknown): PlateNode[] {
  if (!Array.isArray(value))
    throw new PagesError(
      400,
      "INVALID_CONTENT",
      "Page content must be an array",
    );
  let nodes = 0;
  const allowedTypes = new Set([
    "p",
    "paragraph",
    "h1",
    "h2",
    "h3",
    "heading-one",
    "heading-two",
    "heading-three",
    "ul",
    "ol",
    "li",
    "bullet",
    "bulleted-list",
    "numbered-list",
    "list-item",
    "blockquote",
    "a",
    "link",
    "code",
    "bulletedList",
    "numberedList",
    "listItem",
    "numbered",
    "code_block",
    "todo",
    "divider",
    "callout",
    "toggle",
    "table",
    "table_row",
    "table_cell",
    "issue",
    "collection",
    "attachment",
  ]);
  const allowedKeys = new Set([
    "type",
    "id",
    "text",
    "children",
    "url",
    "href",
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "code",
    "domain",
    "collection",
    "mode",
    "viewId",
    "fileId",
    "name",
    "mimeType",
    "language",
    "checked",
  ]);
  const isInline = (node: PlateNode): boolean =>
    typeof node.text === "string" ||
    (["a", "link"].includes(String(node.type)) &&
      (node.children ?? []).every(isInline));
  const walk = (
    input: unknown,
    depth: number,
    parentType?: string,
  ): PlateNode => {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      depth > 32 ||
      ++nodes > 5000
    ) {
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Page content exceeds supported structure limits",
      );
    }
    const node = input as Record<string, unknown>;
    if (Object.keys(node).some((key) => !allowedKeys.has(key)))
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Page content contains an unsupported property",
      );
    if (
      node.id !== undefined &&
      (typeof node.id !== "string" || node.id.length > 128)
    )
      throw new PagesError(400, "INVALID_CONTENT", "Plate node id is invalid");
    if (
      node.language !== undefined &&
      (node.type !== "code_block" ||
        typeof node.language !== "string" ||
        node.language.length > 32 ||
        !/^[A-Za-z][A-Za-z0-9_+-]{0,31}$/.test(node.language))
    )
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Code block language is invalid",
      );
    if (
      node.checked !== undefined &&
      (node.type !== "todo" || typeof node.checked !== "boolean")
    )
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Todo checked state is invalid",
      );
    for (const mark of ["bold", "italic", "underline", "strikethrough", "code"])
      if (node[mark] !== undefined && typeof node[mark] !== "boolean")
        throw new PagesError(
          400,
          "INVALID_CONTENT",
          "Text marks must be boolean",
        );
    if (node.text !== undefined) {
      if (
        typeof node.text !== "string" ||
        Object.keys(node).some(
          (key) =>
            ![
              "text",
              "id",
              "bold",
              "italic",
              "underline",
              "strikethrough",
              "code",
            ].includes(key),
        )
      ) {
        throw new PagesError(
          400,
          "INVALID_CONTENT",
          "Page text node is invalid",
        );
      }
      return node as PlateNode;
    }
    if (
      typeof node.type !== "string" ||
      !allowedTypes.has(node.type) ||
      !Array.isArray(node.children)
    ) {
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Page block type is unsupported",
      );
    }
    const href = node.url ?? node.href;
    if (
      ["a", "link", "issue"].includes(node.type) &&
      (typeof href !== "string" ||
        (node.type === "issue"
          ? parseIssueLink(href) === null
          : !isSafeLink(href)))
    )
      throw new PagesError(400, "INVALID_CONTENT", "Link URL is invalid");
    if (href !== undefined && !["a", "link", "issue"].includes(node.type))
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Only links and issue cards may include a URL",
      );
    if (
      node.type === "collection" &&
      (typeof node.domain !== "string" ||
        !/^\/v1\/studio\/(0|[1-9][0-9]*)$/.test(node.domain) ||
        typeof node.collection !== "string" ||
        !/^[a-z][a-z0-9_]{0,47}$/.test(node.collection) ||
        !["table", "pipeline"].includes(String(node.mode)))
    )
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Collection reference is invalid",
      );
    if (
      node.type === "attachment" &&
      (typeof node.fileId !== "string" ||
        typeof node.name !== "string" ||
        typeof node.mimeType !== "string")
    )
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Attachment reference is invalid",
      );
    if (
      ["table_row", "table_cell"].includes(node.type) &&
      ((node.type === "table_row" && parentType !== "table") ||
        (node.type === "table_cell" && parentType !== "table_row"))
    )
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Table structure is invalid",
      );
    if (
      node.type === "table" &&
      ["table", "table_row", "table_cell"].includes(String(parentType))
    )
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Nested tables are not supported",
      );
    const nodeType = node.type;
    const children = node.children.map((child) =>
      walk(child, depth + 1, nodeType),
    );
    if (
      node.type === "table" &&
      (children.length < 1 ||
        children.length > 20 ||
        children.some((row) => row.type !== "table_row"))
    )
      throw new PagesError(400, "INVALID_CONTENT", "Table rows are invalid");
    if (
      node.type === "table_row" &&
      (children.length < 1 ||
        children.length > 10 ||
        children.some((cell) => cell.type !== "table_cell"))
    )
      throw new PagesError(400, "INVALID_CONTENT", "Table cells are invalid");
    if (
      node.type === "table" &&
      new Set(children.map((row) => row.children?.length)).size !== 1
    )
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Table rows must have a uniform width",
      );
    if (
      node.type === "table_cell" &&
      (children.length < 1 ||
        children.some(
          (child) =>
            child.type !== "p" || !(child.children ?? []).every(isInline),
        ))
    )
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Table cell content is invalid",
      );
    if (
      node.type === "code_block" &&
      (children.length < 1 ||
        children.some((child) => typeof child.text !== "string"))
    )
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Code blocks must contain source text",
      );
    if (
      node.type === "divider" &&
      (children.length !== 1 || children[0].text !== "")
    )
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Divider content must be empty",
      );
    if (
      ["todo", "numbered", "callout"].includes(node.type) &&
      !children.every(isInline)
    )
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Inline block content is invalid",
      );
    if (
      node.type === "toggle" &&
      (children.length < 2 ||
        children[0].type !== "p" ||
        !(children[0].children ?? []).every(isInline) ||
        children
          .slice(1)
          .some(
            (child) =>
              typeof child.type !== "string" ||
              ["table_row", "table_cell"].includes(child.type),
          ))
    )
      throw new PagesError(
        400,
        "INVALID_CONTENT",
        "Toggle requires a summary paragraph and body blocks",
      );
    return {
      ...node,
      children,
    } as PlateNode;
  };
  const parsed = value.map((node) => walk(node, 0));
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 256 * 1024)
    throw new PagesError(
      400,
      "CONTENT_TOO_LARGE",
      "Page content is limited to 256 KB",
    );
  return parsed;
}

function isSafeLink(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return (
      ["http:", "https:", "mailto:"].includes(url.protocol) &&
      (url.protocol === "mailto:" || !!url.hostname)
    );
  } catch {
    return false;
  }
}

function extractText(nodes: PlateNode[]): string {
  const pieces: string[] = [];
  const visit = (node: PlateNode) => {
    if (typeof node.text === "string") pieces.push(node.text);
    for (const child of node.children ?? []) visit(child);
  };
  nodes.forEach(visit);
  return text(pieces.join(" ")).slice(0, 10000);
}

function bindingFrom(value: unknown): PageBinding | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PagesError(400, "INVALID_BINDING", "Binding is invalid");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["domain", "collection", "recordId"].includes(key),
    ) ||
    typeof input.domain !== "string" ||
    !/^\/v1\/studio\/(0|[1-9][0-9]*)$/.test(input.domain) ||
    typeof input.collection !== "string" ||
    !/^[a-z][a-z0-9_]{0,47}$/.test(input.collection) ||
    typeof input.recordId !== "string" ||
    input.recordId.length < 1 ||
    input.recordId.length > 128
  ) {
    throw new PagesError(400, "INVALID_BINDING", "Binding is invalid");
  }
  return {
    domain: input.domain,
    collection: input.collection,
    recordId: input.recordId,
  };
}

async function activeTenant(db: D1Database, actor: AppActor): Promise<number> {
  const membership = actor.memberships.find((item) => item.isActive);
  const activePrincipal = await db
    .prepare("SELECT 1 FROM identity_principal WHERE id=? AND is_active=1")
    .bind(actor.principal.id)
    .first();
  if (!activePrincipal)
    throw new PagesError(404, "PAGE_NOT_FOUND", "Page not found");
  if (!membership) {
    const staleMembership = await db
      .prepare(
        "SELECT 1 FROM identity_tenant_membership WHERE principal_id=? AND is_active=1 LIMIT 1",
      )
      .bind(actor.principal.id)
      .first();
    if (staleMembership)
      throw new PagesError(404, "PAGE_NOT_FOUND", "Page not found");
    return 0;
  }
  const tenantId = membership.tenantId ?? membership.agencyId;
  const row = await db
    .prepare(
      `SELECT m.tenant_id FROM identity_tenant_membership m
    JOIN identity_principal p ON p.id=m.principal_id AND p.is_active=1
    JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1
    WHERE m.principal_id=? AND m.tenant_id=? AND m.is_active=1 LIMIT 1`,
    )
    .bind(actor.principal.id, tenantId)
    .first<{ tenant_id: number }>();
  if (!row) throw new PagesError(404, "PAGE_NOT_FOUND", "Page not found");
  return Number(row.tenant_id);
}

function roleFor(row: PageRow, principalId: string): PageRole | null {
  return row.owner_id === principalId ? "owner" : null;
}

export class PagesService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: AppActor,
  ) {}

  private async tenant() {
    return activeTenant(this.db, this.actor);
  }

  private async load(
    pageId: string,
    roleRequired: "reader" | "editor" | "owner" = "reader",
  ) {
    const tenantId = await this.tenant();
    const row = await this.db
      .prepare("SELECT * FROM pages WHERE id=? AND tenant_id=?")
      .bind(pageId, tenantId)
      .first<PageRow>();
    if (!row) throw new PagesError(404, "PAGE_NOT_FOUND", "Page not found");
    let role = roleFor(row, this.actor.principal.id);
    if (!role) {
      const share = await this.db
        .prepare(
          `SELECT s.role FROM page_shares s
        JOIN identity_tenant_membership m ON m.principal_id=s.principal_id AND m.tenant_id=s.tenant_id AND m.is_active=1
        JOIN identity_principal p ON p.id=s.principal_id AND p.is_active=1
        JOIN tenants t ON t.id=s.tenant_id AND t.is_active=1
        WHERE s.root_id=? AND s.principal_id=? AND s.tenant_id=?`,
        )
        .bind(row.root_id, this.actor.principal.id, tenantId)
        .first<{ role: "reader" | "editor" }>();
      role = share?.role ?? null;
    }
    if (
      !role ||
      (roleRequired === "owner" && role !== "owner") ||
      (roleRequired === "editor" && role === "reader")
    )
      throw new PagesError(404, "PAGE_NOT_FOUND", "Page not found");
    return { row, role };
  }

  private async document(row: PageRow, role: PageRole): Promise<PageDocument> {
    let content: PlateNode[];
    let binding: PageBinding | null = null;
    try {
      content = JSON.parse(row.content_json) as PlateNode[];
    } catch {
      content = [];
    }
    if (row.binding_json)
      try {
        binding = JSON.parse(row.binding_json) as PageBinding;
      } catch {
        binding = null;
      }
    const shared =
      role !== "owner" ||
      !!(await this.db
        .prepare("SELECT 1 FROM page_shares WHERE root_id=? LIMIT 1")
        .bind(row.root_id)
        .first());
    return {
      id: row.id,
      parentId: row.parent_id,
      rootId: row.root_id,
      title: row.title,
      kind: row.kind,
      version: row.version,
      updatedAt: row.updated_at,
      ownerId: row.owner_id,
      role,
      isShared: shared,
      binding,
      content,
    };
  }

  async list(query: string) {
    const tenantId = await this.tenant();
    const needle = `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
    const rows = await this.db
      .prepare(
        `SELECT p.id,p.parent_id,p.root_id,p.title,p.kind,p.version,p.updated_at,p.owner_id,p.binding_json,
      CASE WHEN p.owner_id=? THEN 'owner' ELSE COALESCE((SELECT s.role FROM page_shares s JOIN identity_tenant_membership m ON m.principal_id=s.principal_id AND m.tenant_id=s.tenant_id AND m.is_active=1 JOIN identity_principal i ON i.id=s.principal_id AND i.is_active=1 WHERE s.root_id=p.root_id AND s.principal_id=? AND s.tenant_id=p.tenant_id),'reader') END AS actor_role, EXISTS(SELECT 1 FROM page_shares shared WHERE shared.root_id=p.root_id) AS is_shared FROM pages p WHERE p.tenant_id=? AND
      (p.owner_id=? OR EXISTS (SELECT 1 FROM page_shares s JOIN identity_tenant_membership m ON m.principal_id=s.principal_id AND m.tenant_id=s.tenant_id AND m.is_active=1 JOIN identity_principal i ON i.id=s.principal_id AND i.is_active=1 JOIN tenants t ON t.id=s.tenant_id AND t.is_active=1 WHERE s.root_id=p.root_id AND s.principal_id=? AND s.tenant_id=p.tenant_id)) AND
      (?='' OR p.title LIKE ? ESCAPE '\\' OR p.search_text LIKE ? ESCAPE '\\') ORDER BY p.updated_at DESC LIMIT 200`,
      )
      .bind(
        this.actor.principal.id,
        this.actor.principal.id,
        tenantId,
        this.actor.principal.id,
        this.actor.principal.id,
        query.trim(),
        needle,
        needle,
      )
      .all<
        Pick<
          PageRow,
          | "id"
          | "parent_id"
          | "root_id"
          | "title"
          | "kind"
          | "version"
          | "updated_at"
          | "owner_id"
          | "binding_json"
        > & { actor_role: PageRole; is_shared: number }
      >();
    return (rows.results ?? []).map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      rootId: row.root_id,
      title: row.title,
      kind: row.kind,
      version: row.version,
      updatedAt: row.updated_at,
      ownerId: row.owner_id,
      role: row.actor_role,
      isShared: Boolean(row.is_shared),
      binding: row.binding_json
        ? (JSON.parse(row.binding_json) as PageBinding)
        : null,
    }));
  }

  async create(input: {
    title: string;
    kind?: PageKind;
    parentId?: string;
    binding?: unknown;
  }) {
    const title = input.title?.trim();
    if (!title || title.length > 200)
      throw new PagesError(
        400,
        "INVALID_TITLE",
        "Title must be 1 to 200 characters",
      );
    const tenantId = await this.tenant();
    const pageId = id();
    let parent: PageRow | undefined;
    if (input.parentId)
      parent = (await this.load(input.parentId, "editor")).row;
    const rootId = parent?.root_id ?? pageId;
    const ownerId = parent?.owner_id ?? this.actor.principal.id;
    const creatorRole: PageRole = parent
      ? (await this.load(parent.id)).role
      : "owner";
    const createdAt = now();
    const content: PlateNode[] = [];
    const kind = input.kind ?? "page";
    if (kind !== "page" && kind !== "folder")
      throw new PagesError(400, "INVALID_KIND", "Kind must be page or folder");
    const binding = bindingFrom(input.binding);
    if (kind === "folder" && binding)
      throw new PagesError(
        400,
        "FOLDER_BINDING_NOT_ALLOWED",
        "Folders cannot be bound to records",
      );
    const writeGuard = id();
    const activeScopeSql = `EXISTS(SELECT 1 FROM identity_principal actor WHERE actor.id=? AND actor.is_active=1 AND ${activeTenantScope("actor.id", "?")})`;
    const parentAccessSql = parent
      ? `AND EXISTS(SELECT 1 FROM pages p WHERE p.id=? AND p.tenant_id=? AND
          (p.owner_id=? OR EXISTS(SELECT 1 FROM page_shares s JOIN identity_tenant_membership m ON m.principal_id=s.principal_id AND m.tenant_id=s.tenant_id AND m.is_active=1 JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1 WHERE s.root_id=p.root_id AND s.principal_id=? AND s.role='editor' AND s.tenant_id=p.tenant_id)))`
      : "";
    const guardBindings = parent
      ? [
          writeGuard,
          this.actor.principal.id,
          tenantId,
          tenantId,
          tenantId,
          parent.id,
          tenantId,
          this.actor.principal.id,
          this.actor.principal.id,
        ]
      : [writeGuard, this.actor.principal.id, tenantId, tenantId, tenantId];
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO studio_write_guards(id,valid) SELECT ?,CASE WHEN ${activeScopeSql} ${parentAccessSql} THEN 1 ELSE 0 END`,
          )
          .bind(...guardBindings),
        this.db
          .prepare(
            `INSERT INTO pages(id,tenant_id,owner_id,parent_id,root_id,title,kind,content_json,search_text,binding_json,version,share_version,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,'',?,1,1,?,?)`,
          )
          .bind(
            pageId,
            tenantId,
            ownerId,
            parent?.id ?? null,
            rootId,
            title,
            kind,
            JSON.stringify(content),
            binding ? JSON.stringify(binding) : null,
            createdAt,
            createdAt,
          ),
        this.db
          .prepare(
            "INSERT INTO page_revisions(page_id,version,title,content_json,created_at) VALUES(?,1,?,?,?)",
          )
          .bind(pageId, title, JSON.stringify(content), createdAt),
        this.db
          .prepare("DELETE FROM studio_write_guards WHERE id=?")
          .bind(writeGuard),
      ]);
    } catch (error) {
      if (parent) await this.load(parent.id, "editor");
      else await this.tenant();
      if (isPostgresSerializationFailure(error))
        throw versionConflict("Page changed while it was being created");
      throw error;
    }
    const row = await this.db
      .prepare("SELECT * FROM pages WHERE id=?")
      .bind(pageId)
      .first<PageRow>();
    return this.document(row!, creatorRole);
  }

  async get(pageId: string) {
    const { row, role } = await this.load(pageId);
    return this.document(row, role);
  }

  async save(
    pageId: string,
    input: { title: string; content: unknown; version: number },
  ) {
    const { row } = await this.load(pageId, "editor");
    if (!Number.isInteger(input.version) || input.version !== row.version)
      throw new PagesError(
        409,
        "VERSION_CONFLICT",
        "Page changed since it was loaded",
      );
    const title = input.title?.trim();
    if (!title || title.length > 200)
      throw new PagesError(
        400,
        "INVALID_TITLE",
        "Title must be 1 to 200 characters",
      );
    const content = parsePageContent(input.content);
    if (row.kind === "folder" && content.length > 0)
      throw new PagesError(
        400,
        "FOLDER_CONTENT_NOT_ALLOWED",
        "Folders cannot contain page content",
      );
    const version = row.version + 1;
    const updatedAt = now();
    const writeGuard = id();
    const authorization = `EXISTS(SELECT 1 FROM pages p JOIN identity_principal actor ON actor.id=? AND actor.is_active=1
      WHERE p.id=? AND p.tenant_id=? AND p.version=? AND ${activeTenantScope("actor.id", "p.tenant_id")} AND
      (p.owner_id=actor.id OR EXISTS(SELECT 1 FROM page_shares s JOIN identity_tenant_membership m ON m.principal_id=s.principal_id AND m.tenant_id=s.tenant_id AND m.is_active=1 JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1 WHERE s.root_id=p.root_id AND s.principal_id=actor.id AND s.role='editor' AND s.tenant_id=p.tenant_id)))`;
    let result: D1Result[];
    try {
      result = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO studio_write_guards(id,valid) SELECT ?,CASE WHEN ${authorization} THEN 1 ELSE 0 END`,
          )
          .bind(
            writeGuard,
            this.actor.principal.id,
            pageId,
            row.tenant_id,
            input.version,
          ),
        this.db
          .prepare(
            `UPDATE pages SET title=?,content_json=?,search_text=?,version=?,updated_at=? WHERE id=? AND version=?`,
          )
          .bind(
            title,
            JSON.stringify(content),
            extractText(content),
            version,
            updatedAt,
            pageId,
            input.version,
          ),
        this.db
          .prepare(
            "INSERT INTO page_revisions(page_id,version,title,content_json,created_at) VALUES(?,?,?,?,?)",
          )
          .bind(pageId, version, title, JSON.stringify(content), updatedAt),
        this.db
          .prepare("DELETE FROM studio_write_guards WHERE id=?")
          .bind(writeGuard),
      ]);
    } catch (error) {
      try {
        const current = await this.load(pageId, "editor");
        if (current.row.version !== input.version)
          throw versionConflict("Page changed since it was loaded");
      } catch (accessError) {
        if (accessError instanceof PagesError) throw accessError;
      }
      if (isPostgresSerializationFailure(error))
        throw versionConflict("Page changed since it was loaded");
      throw error;
    }
    if (!result[0]?.meta.changes)
      throw new PagesError(
        409,
        "VERSION_CONFLICT",
        "Page changed since it was loaded",
      );
    return this.document(
      {
        ...row,
        title,
        content_json: JSON.stringify(content),
        search_text: extractText(content),
        version,
        updated_at: updatedAt,
      },
      row.owner_id === this.actor.principal.id ? "owner" : "editor",
    );
  }

  async remove(pageId: string, version: number | undefined): Promise<string[]> {
    const { row } = await this.load(pageId, "owner");
    if (version !== undefined && version !== row.version)
      throw new PagesError(
        409,
        "VERSION_CONFLICT",
        "Page changed since it was loaded",
      );
    const children = await this.db
      .prepare("SELECT 1 FROM pages WHERE parent_id=? LIMIT 1")
      .bind(pageId)
      .first();
    if (children)
      throw new PagesError(
        409,
        "PAGE_HAS_CHILDREN",
        "Delete child pages before deleting this page",
      );
    const storedFiles = await this.db
      .prepare("SELECT storage_key FROM page_files WHERE page_id=?")
      .bind(pageId)
      .all<{ storage_key: string }>();
    const guard = id();
    const condition = `EXISTS(SELECT 1 FROM pages p JOIN identity_principal actor ON actor.id=? AND actor.is_active=1 WHERE p.id=? AND p.version=? AND p.owner_id=actor.id AND NOT EXISTS(SELECT 1 FROM pages child WHERE child.parent_id=p.id) AND ${activeTenantScope("actor.id", "p.tenant_id")})`;
    let results: D1Result[];
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO studio_write_guards(id,valid) SELECT ?,CASE WHEN ${condition} THEN 1 ELSE 0 END`,
          )
          .bind(guard, this.actor.principal.id, pageId, row.version),
        this.db
          .prepare(
            "DELETE FROM pages WHERE id=? AND version=? AND NOT EXISTS(SELECT 1 FROM pages child WHERE child.parent_id=pages.id)",
          )
          .bind(pageId, row.version),
        this.db
          .prepare("DELETE FROM studio_write_guards WHERE id=?")
          .bind(guard),
      ]);
    } catch (error) {
      const current = await this.load(pageId, "owner");
      const remainingChildren = await this.db
        .prepare("SELECT 1 FROM pages WHERE parent_id=? LIMIT 1")
        .bind(pageId)
        .first();
      if (remainingChildren)
        throw new PagesError(
          409,
          "PAGE_HAS_CHILDREN",
          "Delete child pages before deleting this page",
        );
      if (current.row.version !== row.version)
        throw versionConflict("Page changed since it was loaded");
      if (isPostgresSerializationFailure(error))
        throw versionConflict("Page changed while it was being deleted");
      throw error;
    }
    if (!results[1]?.meta.changes)
      throw new PagesError(
        409,
        "VERSION_CONFLICT",
        "Page changed since it was loaded",
      );
    return (storedFiles.results ?? []).map((file) => file.storage_key);
  }

  async revisions(pageId: string): Promise<PageRevision[]> {
    await this.load(pageId);
    const result = await this.db
      .prepare(
        'SELECT page_id AS id,version,title,created_at AS "createdAt" FROM page_revisions WHERE page_id=? ORDER BY version DESC',
      )
      .bind(pageId)
      .all<PageRevision>();
    return result.results ?? [];
  }

  async clearHistory(pageId: string, version: number) {
    const { row } = await this.load(pageId, "owner");
    if (!Number.isInteger(version) || version !== row.version)
      throw versionConflict("Page changed since it was loaded");

    const guard = id();
    const authorization = `EXISTS(SELECT 1 FROM pages p JOIN identity_principal actor ON actor.id=? AND actor.is_active=1
      WHERE p.id=? AND p.tenant_id=? AND p.version=? AND p.owner_id=actor.id AND ${activeTenantScope("actor.id", "p.tenant_id")})`;
    let result: D1Result[];
    try {
      result = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO studio_write_guards(id,valid) SELECT ?,CASE WHEN ${authorization} THEN 1 ELSE 0 END`,
          )
          .bind(guard, this.actor.principal.id, pageId, row.tenant_id, version),
        this.db
          .prepare(
            `DELETE FROM page_revisions WHERE page_id=? AND version<? AND EXISTS(
              SELECT 1 FROM pages p JOIN identity_principal actor ON actor.id=? AND actor.is_active=1
              WHERE p.id=? AND p.tenant_id=? AND p.version=? AND p.owner_id=actor.id AND ${activeTenantScope("actor.id", "p.tenant_id")} )`,
          )
          .bind(
            pageId,
            version,
            this.actor.principal.id,
            pageId,
            row.tenant_id,
            version,
          ),
        this.db
          .prepare("DELETE FROM studio_write_guards WHERE id=?")
          .bind(guard),
      ]);
    } catch (error) {
      const current = await this.load(pageId, "owner");
      if (current.row.version !== row.version)
        throw versionConflict("Page changed since it was loaded");
      if (isPostgresSerializationFailure(error))
        throw versionConflict("Page changed since it was loaded");
      throw error;
    }
    if (!result[1]?.meta.changes) {
      const current = await this.load(pageId, "owner");
      if (current.row.version !== row.version)
        throw versionConflict("Page changed since it was loaded");
    }
    return { deleted: true };
  }

  async revision(pageId: string, version: number) {
    const { row, role } = await this.load(pageId);
    const snapshot = await this.db
      .prepare(
        "SELECT title,content_json,version,created_at FROM page_revisions WHERE page_id=? AND version=?",
      )
      .bind(pageId, version)
      .first<{
        title: string;
        content_json: string;
        version: number;
        created_at: string;
      }>();
    if (!snapshot)
      throw new PagesError(404, "REVISION_NOT_FOUND", "Revision not found");
    return {
      ...(await this.document(row, role)),
      title: snapshot.title,
      version: snapshot.version,
      updatedAt: snapshot.created_at,
      content: JSON.parse(snapshot.content_json) as PlateNode[],
    };
  }

  async restore(pageId: string, input: { revision: number; version: number }) {
    const { row } = await this.load(pageId, "editor");
    if (row.version !== input.version)
      throw new PagesError(
        409,
        "VERSION_CONFLICT",
        "Page changed since it was loaded",
      );
    const snapshot = await this.db
      .prepare(
        "SELECT title,content_json FROM page_revisions WHERE page_id=? AND version=?",
      )
      .bind(pageId, input.revision)
      .first<{ title: string; content_json: string }>();
    if (!snapshot)
      throw new PagesError(404, "REVISION_NOT_FOUND", "Revision not found");
    return this.save(pageId, {
      title: snapshot.title,
      content: JSON.parse(snapshot.content_json),
      version: input.version,
    });
  }

  async shares(pageId: string): Promise<PageShares> {
    const { row } = await this.load(pageId, "owner");
    const root = await this.db
      .prepare("SELECT id,share_version FROM pages WHERE id=?")
      .bind(row.root_id)
      .first<{ id: string; share_version: number }>();
    const result = await this.db
      .prepare(
        'SELECT principal_id AS "principalId",role FROM page_shares WHERE root_id=? ORDER BY principal_id',
      )
      .bind(row.root_id)
      .all<PageShare>();
    return {
      rootId: row.root_id,
      version: root!.share_version,
      shares: result.results ?? [],
    };
  }

  async setShares(
    pageId: string,
    input: { shares: PageShare[]; version: number },
  ): Promise<PageShares> {
    const { row } = await this.load(pageId, "owner");
    const root = await this.db
      .prepare("SELECT share_version,tenant_id FROM pages WHERE id=?")
      .bind(row.root_id)
      .first<{ share_version: number; tenant_id: number }>();
    if (input.version !== root!.share_version)
      throw new PagesError(
        409,
        "VERSION_CONFLICT",
        "Shares changed since they were loaded",
      );
    if (!Array.isArray(input.shares) || input.shares.length > 200)
      throw new PagesError(400, "INVALID_SHARES", "Share list is invalid");
    const dedup = new Set<string>();
    for (const share of input.shares) {
      if (
        !share ||
        typeof share.principalId !== "string" ||
        !["reader", "editor"].includes(share.role) ||
        dedup.has(share.principalId) ||
        share.principalId === this.actor.principal.id
      )
        throw new PagesError(400, "INVALID_SHARES", "Share list is invalid");
      dedup.add(share.principalId);
      const member = await this.db
        .prepare(
          `SELECT 1 FROM identity_principal p JOIN identity_tenant_membership m ON m.principal_id=p.id AND m.is_active=1 JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1 WHERE p.id=? AND p.is_active=1 AND m.tenant_id=? LIMIT 1`,
        )
        .bind(share.principalId, root!.tenant_id)
        .first();
      if (!member)
        throw new PagesError(
          400,
          "INVALID_SHARE_MEMBER",
          "Shares are limited to active members of this tenant",
        );
    }
    const nextVersion = root!.share_version + 1;
    const guard = id();
    const inviteesStillActive = input.shares
      .map(
        () =>
          "AND EXISTS(SELECT 1 FROM identity_principal invitee JOIN identity_tenant_membership membership ON membership.principal_id=invitee.id AND membership.is_active=1 JOIN tenants active_tenant ON active_tenant.id=membership.tenant_id AND active_tenant.is_active=1 WHERE invitee.id=? AND invitee.is_active=1 AND membership.tenant_id=p.tenant_id)",
      )
      .join(" ");
    const authorization = `EXISTS(SELECT 1 FROM pages p JOIN identity_principal actor ON actor.id=? AND actor.is_active=1 WHERE p.id=? AND p.owner_id=actor.id AND p.share_version=? AND ${activeTenantScope("actor.id", "p.tenant_id")} ${inviteesStillActive})`;
    const guardBindings = [
      this.actor.principal.id,
      row.root_id,
      input.version,
      ...input.shares.map((share) => share.principalId),
    ];
    const statements = [
      this.db
        .prepare(
          `INSERT INTO studio_write_guards(id,valid) SELECT ?,CASE WHEN ${authorization} THEN 1 ELSE 0 END`,
        )
        .bind(guard, ...guardBindings),
      this.db
        .prepare(
          "UPDATE pages SET share_version=? WHERE id=? AND share_version=?",
        )
        .bind(nextVersion, row.root_id, input.version),
      this.db
        .prepare("DELETE FROM page_shares WHERE root_id=?")
        .bind(row.root_id),
      ...input.shares.map((share) =>
        this.db
          .prepare(
            "INSERT INTO page_shares(root_id,tenant_id,principal_id,role,created_at) VALUES(?,?,?,?,?)",
          )
          .bind(
            row.root_id,
            root!.tenant_id,
            share.principalId,
            share.role,
            now(),
          ),
      ),
      this.db.prepare("DELETE FROM studio_write_guards WHERE id=?").bind(guard),
    ];
    try {
      await this.db.batch(statements);
    } catch (error) {
      try {
        const current = await this.shares(pageId);
        if (current.version !== input.version)
          throw versionConflict("Shares changed since they were loaded");
        for (const share of input.shares) {
          const activeMember = await this.db
            .prepare(
              `SELECT 1 FROM identity_principal p JOIN identity_tenant_membership m ON m.principal_id=p.id AND m.is_active=1 JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1 WHERE p.id=? AND p.is_active=1 AND m.tenant_id=? LIMIT 1`,
            )
            .bind(share.principalId, root!.tenant_id)
            .first();
          if (!activeMember)
            throw new PagesError(
              400,
              "INVALID_SHARE_MEMBER",
              "Shares are limited to active members of this tenant",
            );
        }
      } catch (accessError) {
        if (accessError instanceof PagesError) throw accessError;
      }
      if (isPostgresSerializationFailure(error))
        throw versionConflict("Shares changed since they were loaded");
      throw error;
    }
    return this.shares(pageId);
  }

  async members(query: string): Promise<PageMember[]> {
    const tenantId = await this.tenant();
    const pattern = `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
    const result = await this.db
      .prepare(
        `SELECT p.id AS "principalId",p.display_name AS "displayName",p.email FROM identity_principal p
      JOIN identity_tenant_membership m ON m.principal_id=p.id AND m.is_active=1 JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1
      WHERE p.is_active=1 AND p.id<>? AND m.tenant_id=? AND (p.display_name LIKE ? ESCAPE '\\' OR p.email LIKE ? ESCAPE '\\') ORDER BY p.display_name LIMIT 50`,
      )
      .bind(this.actor.principal.id, tenantId, pattern, pattern)
      .all<PageMember>();
    return result.results ?? [];
  }

  async file(pageId: string, fileId: string) {
    const { row } = await this.load(pageId);
    const file = await this.db
      .prepare(
        "SELECT id,page_id,root_id,tenant_id,storage_key,file_name,mime_type,size FROM page_files WHERE id=? AND page_id=? AND root_id=? AND tenant_id=?",
      )
      .bind(fileId, pageId, row.root_id, row.tenant_id)
      .first<{
        id: string;
        page_id: string;
        root_id: string;
        tenant_id: number;
        storage_key: string;
        file_name: string;
        mime_type: string;
        size: number;
      }>();
    if (!file) throw new PagesError(404, "FILE_NOT_FOUND", "File not found");
    return file;
  }

  async saveFile(pageId: string, file: PageFile & { storageKey: string }) {
    const { row } = await this.load(pageId, "editor");
    const guard = id();
    const authorization = `EXISTS(SELECT 1 FROM pages p JOIN identity_principal actor ON actor.id=? AND actor.is_active=1 WHERE p.id=? AND p.tenant_id=? AND ${activeTenantScope("actor.id", "p.tenant_id")} AND
      (p.owner_id=actor.id OR EXISTS(SELECT 1 FROM page_shares s JOIN identity_tenant_membership m ON m.principal_id=s.principal_id AND m.tenant_id=s.tenant_id AND m.is_active=1 JOIN tenants t ON t.id=m.tenant_id AND t.is_active=1 WHERE s.root_id=p.root_id AND s.principal_id=actor.id AND s.role='editor' AND s.tenant_id=p.tenant_id)))`;
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO studio_write_guards(id,valid) SELECT ?,CASE WHEN ${authorization} THEN 1 ELSE 0 END`,
          )
          .bind(guard, this.actor.principal.id, pageId, row.tenant_id),
        this.db
          .prepare(
            "INSERT INTO page_files(id,page_id,root_id,tenant_id,storage_key,file_name,mime_type,size,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            file.id,
            pageId,
            row.root_id,
            row.tenant_id,
            file.storageKey,
            file.name,
            file.mimeType,
            file.size,
            now(),
          ),
        this.db
          .prepare("DELETE FROM studio_write_guards WHERE id=?")
          .bind(guard),
      ]);
    } catch (error) {
      try {
        await this.load(pageId, "editor");
      } catch (accessError) {
        if (accessError instanceof PagesError) throw accessError;
      }
      if (isPostgresSerializationFailure(error))
        throw versionConflict("Page changed while the file was being saved");
      throw error;
    }
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
    };
  }
}
