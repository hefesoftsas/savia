export type VirtualEmployee = {
  id: string;
  agencyId: number | null;
  name: string;
  handle: string;
  position: string | null;
  avatar: string | null;
  greeting: string | null;
  systemPrompt: string;
  allowedCollections: string[];
  model: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  filesCount?: number;
  files?: VirtualEmployeeFile[];
};

export type VirtualEmployeeFile = {
  id: string;
  employeeId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  r2Key: string;
  ragStatus: "pending" | "indexed" | "failed";
  createdAt: string;
};

export type CreateVirtualEmployeeInput = {
  agencyId?: number | null;
  name: string;
  handle: string;
  position?: string | null;
  avatar?: string | null;
  greeting?: string | null;
  systemPrompt: string;
  allowedCollections?: string[];
  model?: string | null;
  status?: "active" | "inactive";
  createdBy?: string | null;
};

export type UpdateVirtualEmployeeInput = Partial<
  Omit<CreateVirtualEmployeeInput, "agencyId" | "handle">
> & {
  handle?: string;
  status?: "active" | "inactive";
};

type EmployeeRow = {
  id: string;
  agency_id: number | null;
  name: string;
  handle: string;
  position: string | null;
  avatar: string | null;
  greeting: string | null;
  system_prompt: string;
  allowed_collections: string;
  model: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
  created_by: string | null;
  files_count?: number;
};

type FileRow = {
  id: string;
  employee_id: string;
  name: string;
  content_type: string;
  size_bytes: number;
  r2_key: string;
  rag_status: "pending" | "indexed" | "failed";
  created_at: string;
};

function mapRow(row: EmployeeRow): VirtualEmployee {
  let allowedCollections: string[] = ["*"];
  try {
    const parsed = JSON.parse(row.allowed_collections);
    if (Array.isArray(parsed)) allowedCollections = parsed;
  } catch {}

  return {
    id: row.id,
    agencyId: row.agency_id,
    name: row.name,
    handle: row.handle.replace(/^@/, "").toLowerCase().trim(),
    position: row.position,
    avatar: row.avatar,
    greeting: row.greeting,
    systemPrompt: row.system_prompt,
    allowedCollections,
    model: row.model,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    filesCount: row.files_count ?? 0,
  };
}

function mapFileRow(row: FileRow): VirtualEmployeeFile {
  return {
    id: row.id,
    employeeId: row.employee_id,
    name: row.name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    r2Key: row.r2_key,
    ragStatus: row.rag_status,
    createdAt: row.created_at,
  };
}

export class VirtualEmployeesRepository {
  constructor(private readonly db: D1Database) {}

  async list(agencyId?: number | null): Promise<VirtualEmployee[]> {
    const query = `
      SELECT 
        e.*,
        COUNT(f.id) AS files_count
      FROM assistant_virtual_employees e
      LEFT JOIN assistant_virtual_employee_files f ON f.employee_id = e.id
      WHERE (e.agency_id IS NULL ${agencyId ? "OR e.agency_id = ?" : ""})
      GROUP BY e.id
      ORDER BY e.agency_id DESC, e.name ASC
    `;

    const stmt = agencyId
      ? this.db.prepare(query).bind(agencyId)
      : this.db.prepare(query);

    const result = await stmt.all<EmployeeRow>();
    return (result.results ?? []).map(mapRow);
  }

  async getById(
    id: string,
    agencyId?: number | null,
  ): Promise<VirtualEmployee | null> {
    const query = `
      SELECT e.*, COUNT(f.id) AS files_count
      FROM assistant_virtual_employees e
      LEFT JOIN assistant_virtual_employee_files f ON f.employee_id = e.id
      WHERE e.id = ? ${agencyId ? "AND (e.agency_id IS NULL OR e.agency_id = ?)" : ""}
      GROUP BY e.id
    `;

    const stmt = agencyId
      ? this.db.prepare(query).bind(id, agencyId)
      : this.db.prepare(query).bind(id);

    const row = await stmt.first<EmployeeRow>();
    if (!row) return null;

    const employee = mapRow(row);
    employee.files = await this.listFiles(id);
    return employee;
  }

  async getByHandle(
    handle: string,
    agencyId?: number | null,
  ): Promise<VirtualEmployee | null> {
    const cleanHandle = handle.replace(/^@/, "").toLowerCase().trim();

    // Prioritize agency-specific employee, fallback to global
    const query = `
      SELECT e.*, COUNT(f.id) AS files_count
      FROM assistant_virtual_employees e
      LEFT JOIN assistant_virtual_employee_files f ON f.employee_id = e.id
      WHERE LOWER(e.handle) = ? AND e.status = 'active'
        ${agencyId ? "AND (e.agency_id = ? OR e.agency_id IS NULL)" : "AND e.agency_id IS NULL"}
      GROUP BY e.id
      ORDER BY e.agency_id DESC
      LIMIT 1
    `;

    const stmt = agencyId
      ? this.db.prepare(query).bind(cleanHandle, agencyId)
      : this.db.prepare(query).bind(cleanHandle);

    const row = await stmt.first<EmployeeRow>();
    if (!row) return null;

    const employee = mapRow(row);
    employee.files = await this.listFiles(employee.id);
    return employee;
  }

  async create(input: CreateVirtualEmployeeInput): Promise<VirtualEmployee> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const handle = input.handle.replace(/^@/, "").toLowerCase().trim();
    const allowed = JSON.stringify(input.allowedCollections ?? ["*"]);

    await this.db
      .prepare(
        `INSERT INTO assistant_virtual_employees (
          id, agency_id, name, handle, position, avatar, greeting,
          system_prompt, allowed_collections, model, status,
          created_at, updated_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.agencyId ?? null,
        input.name.trim(),
        handle,
        input.position?.trim() ?? null,
        input.avatar?.trim() ?? "briefcase",
        input.greeting?.trim() ?? null,
        input.systemPrompt.trim(),
        allowed,
        input.model?.trim() ?? null,
        input.status ?? "active",
        now,
        now,
        input.createdBy ?? null,
      )
      .run();

    const created = await this.getById(id);
    if (!created) throw new Error("Failed to create virtual employee");
    return created;
  }

  async update(
    id: string,
    input: UpdateVirtualEmployeeInput,
    agencyId?: number | null,
  ): Promise<VirtualEmployee | null> {
    const existing = await this.getById(id, agencyId);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      updates.push("name = ?");
      values.push(input.name.trim());
    }
    if (input.handle !== undefined) {
      updates.push("handle = ?");
      values.push(input.handle.replace(/^@/, "").toLowerCase().trim());
    }
    if (input.position !== undefined) {
      updates.push("position = ?");
      values.push(input.position?.trim() ?? null);
    }
    if (input.avatar !== undefined) {
      updates.push("avatar = ?");
      values.push(input.avatar?.trim() ?? null);
    }
    if (input.greeting !== undefined) {
      updates.push("greeting = ?");
      values.push(input.greeting?.trim() ?? null);
    }
    if (input.systemPrompt !== undefined) {
      updates.push("system_prompt = ?");
      values.push(input.systemPrompt.trim());
    }
    if (input.allowedCollections !== undefined) {
      updates.push("allowed_collections = ?");
      values.push(JSON.stringify(input.allowedCollections));
    }
    if (input.model !== undefined) {
      updates.push("model = ?");
      values.push(input.model?.trim() ?? null);
    }
    if (input.status !== undefined) {
      updates.push("status = ?");
      values.push(input.status);
    }

    if (updates.length === 0) return existing;

    const now = new Date().toISOString();
    updates.push("updated_at = ?");
    values.push(now);

    values.push(id);
    const query = `UPDATE assistant_virtual_employees SET ${updates.join(", ")} WHERE id = ?`;
    await this.db.prepare(query).bind(...values).run();

    return this.getById(id, agencyId);
  }

  async delete(id: string, agencyId?: number | null): Promise<boolean> {
    const existing = await this.getById(id, agencyId);
    if (!existing) return false;

    // Do not allow deleting system global seeds unless explicitly targeted
    await this.db
      .prepare(`DELETE FROM assistant_virtual_employees WHERE id = ?`)
      .bind(id)
      .run();

    return true;
  }

  async listFiles(employeeId: string): Promise<VirtualEmployeeFile[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM assistant_virtual_employee_files WHERE employee_id = ? ORDER BY created_at DESC`,
      )
      .bind(employeeId)
      .all<FileRow>();

    return (result.results ?? []).map(mapFileRow);
  }

  async getFile(fileId: string): Promise<VirtualEmployeeFile | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM assistant_virtual_employee_files WHERE id = ?`,
      )
      .bind(fileId)
      .first<FileRow>();

    return row ? mapFileRow(row) : null;
  }

  async addFile(file: Omit<VirtualEmployeeFile, "createdAt">): Promise<VirtualEmployeeFile> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO assistant_virtual_employee_files (
          id, employee_id, name, content_type, size_bytes, r2_key, rag_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        file.id,
        file.employeeId,
        file.name,
        file.contentType,
        file.sizeBytes,
        file.r2Key,
        file.ragStatus,
        now,
      )
      .run();

    return {
      ...file,
      createdAt: now,
    };
  }

  async updateFileStatus(
    fileId: string,
    ragStatus: "pending" | "indexed" | "failed",
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE assistant_virtual_employee_files SET rag_status = ? WHERE id = ?`,
      )
      .bind(ragStatus, fileId)
      .run();
  }

  async removeFile(fileId: string): Promise<VirtualEmployeeFile | null> {
    const file = await this.getFile(fileId);
    if (!file) return null;

    await this.db
      .prepare(`DELETE FROM assistant_virtual_employee_files WHERE id = ?`)
      .bind(fileId)
      .run();

    return file;
  }
}
