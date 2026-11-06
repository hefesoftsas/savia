import type {
  ExecutionRow,
  ExecutionStore,
  ListExecutionsOptions,
  SaveExecutionRecord,
} from "@savia/flows-runtime";
import type { WorkflowExecution } from "@savia/flows-types";

type StoredExecution = { data: string; created_at: number; updated_at: number };

/** Local D1 history replaces remote Analytics Engine queries in the first version. */
export class LocalExecutionStore implements ExecutionStore {
  constructor(private readonly db: D1Database) {}

  private hydrate(row: StoredExecution): WorkflowExecution {
    const data = JSON.parse(row.data) as WorkflowExecution;
    if (data.startedAt) data.startedAt = new Date(data.startedAt);
    if (data.endedAt) data.endedAt = new Date(data.endedAt);
    return data;
  }

  private metadata(row: StoredExecution, organizationId: string): ExecutionRow {
    const data = this.hydrate(row);
    return {
      id: data.id,
      workflowId: data.workflowId,
      workflowName:
        data.workflowName ?? data.workflowDefinition?.name ?? "Workflow",
      organizationId,
      status: data.status,
      error: data.error ?? null,
      startedAt: data.startedAt ?? null,
      endedAt: data.endedAt ?? null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      usage: data.nodeExecutions.reduce(
        (sum, node) => sum + (node.usage ?? 0),
        0,
      ),
      definitionHash: data.definitionHash,
      ...(data.rehearsal ? { rehearsal: true } : {}),
    };
  }

  async save(record: SaveExecutionRecord): Promise<WorkflowExecution> {
    const now = Date.now();
    const data: WorkflowExecution = {
      id: record.id,
      workflowId: record.workflowId,
      workflowName: record.workflowName,
      status: record.status,
      nodeExecutions: record.nodeExecutions,
      error: record.error,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      workflowDefinition: record.workflowDefinition,
      definitionHash: record.definitionHash,
      runtimeVersion: record.runtimeVersion,
      ...(record.rehearsal ? { rehearsal: true } : {}),
    };
    await this.db
      .prepare(
        `INSERT INTO savia_local_executions
      (id, organization_id, workflow_id, status, started_at, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (organization_id, id) DO UPDATE SET
      workflow_id=excluded.workflow_id, status=excluded.status,
      updated_at=excluded.updated_at, data=excluded.data`,
      )
      .bind(
        record.id,
        record.organizationId,
        record.workflowId,
        record.status,
        record.startedAt?.getTime() ?? now,
        record.createdAt?.getTime() ?? now,
        record.updatedAt?.getTime() ?? now,
        JSON.stringify(data),
      )
      .run();
    return data;
  }

  private async stored(
    id: string,
    organizationId: string,
  ): Promise<StoredExecution | null> {
    return this.db
      .prepare(
        "SELECT data, created_at, updated_at FROM savia_local_executions WHERE organization_id = ? AND id = ?",
      )
      .bind(organizationId, id)
      .first<StoredExecution>();
  }

  async get(
    id: string,
    organizationId: string,
  ): Promise<ExecutionRow | undefined> {
    const row = await this.stored(id, organizationId);
    return row ? this.metadata(row, organizationId) : undefined;
  }

  async getWithData(
    id: string,
    organizationId: string,
  ): Promise<(ExecutionRow & { data: WorkflowExecution }) | undefined> {
    const row = await this.stored(id, organizationId);
    return row
      ? { ...this.metadata(row, organizationId), data: this.hydrate(row) }
      : undefined;
  }

  async list(
    organizationId: string,
    options: ListExecutionsOptions = {},
  ): Promise<ExecutionRow[]> {
    const conditions = ["organization_id = ?"];
    const values: (string | number)[] = [organizationId];
    if (options.workflowId) {
      conditions.push("workflow_id = ?");
      values.push(options.workflowId);
    }
    if (options.status) {
      conditions.push("status = ?");
      values.push(options.status);
    }
    for (const [field, condition, offset] of [
      ["startDate", "started_at >= ?", 0],
      ["endDate", "started_at < ?", 86400000],
    ] as const) {
      const value = options[field];
      if (!value) continue;
      const date = new Date(value + "T00:00:00Z");
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
      )
        throw new Error(`Invalid ${field}`);
      conditions.push(condition);
      values.push(date.getTime() + offset);
    }
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw new Error("Invalid history pagination");
    const rows = await this.db
      .prepare(
        `SELECT data, created_at, updated_at FROM savia_local_executions
      WHERE ${conditions.join(" AND ")} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...values, limit, offset)
      .all<StoredExecution>();
    return rows.results.map((row) => this.metadata(row, organizationId));
  }
}
