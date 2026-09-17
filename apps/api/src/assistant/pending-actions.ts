export type PendingActionStatus =
  "pending" | "executing" | "completed" | "failed" | "cancelled" | "expired";

export type PendingActionInput = {
  id: string;
  principalId: string;
  domain: string;
  command: string;
  input: Record<string, unknown>;
};

export type PendingAction = PendingActionInput & {
  status: PendingActionStatus;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  result: unknown | null;
};

type PendingActionRow = {
  id: string;
  principal_id: string;
  domain: string;
  command: string;
  input_json: string;
  status: PendingActionStatus;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  result_json: string | null;
};

const approvalLifetimeMilliseconds = 5 * 60 * 1_000;

function toPendingAction(row: PendingActionRow): PendingAction {
  return {
    id: row.id,
    principalId: row.principal_id,
    domain: row.domain,
    command: row.command,
    input: JSON.parse(row.input_json) as Record<string, unknown>,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    result: row.result_json === null ? null : JSON.parse(row.result_json),
  };
}

export class PendingActionRepository {
  constructor(
    private readonly database: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(input: PendingActionInput): Promise<PendingAction> {
    const createdAt = this.now();
    const expiresAt = new Date(
      createdAt.getTime() + approvalLifetimeMilliseconds,
    );
    const row = await this.database
      .prepare(
        `INSERT INTO assistant_pending_actions (
          id, principal_id, domain, command, input_json, status, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        RETURNING id, principal_id, domain, command, input_json, status, created_at, expires_at, resolved_at, result_json`,
      )
      .bind(
        input.id,
        input.principalId,
        input.domain,
        input.command,
        JSON.stringify(input.input),
        createdAt.toISOString(),
        expiresAt.toISOString(),
      )
      .first<PendingActionRow>();
    if (!row) throw new Error("Assistant approval could not be created");
    return toPendingAction(row);
  }

  async status(
    id: string,
    principalId: string,
  ): Promise<{ state: string; result: unknown } | null> {
    const row = await this.database
      .prepare(
        "SELECT status,result_json,expires_at FROM assistant_pending_actions WHERE id=? AND principal_id=?",
      )
      .bind(id, principalId)
      .first<{
        status: string;
        result_json: string | null;
        expires_at: string;
      }>();
    if (!row) return null;
    return {
      state:
        row.status === "pending" && row.expires_at <= this.now().toISOString()
          ? "expired"
          : row.status,
      result: row.result_json === null ? null : JSON.parse(row.result_json),
    };
  }

  async consume(
    id: string,
    principalId: string,
    now = this.now(),
  ): Promise<PendingAction | null> {
    const row = await this.database
      .prepare(
        `UPDATE assistant_pending_actions
        SET status = 'executing', resolved_at = ?
        WHERE id = ?
          AND principal_id = ?
          AND status = 'pending'
          AND expires_at > ?
        RETURNING id, principal_id, domain, command, input_json, status, created_at, expires_at, resolved_at, result_json`,
      )
      .bind(now.toISOString(), id, principalId, now.toISOString())
      .first<PendingActionRow>();
    return row ? toPendingAction(row) : null;
  }

  async claimPersonalExecution(
    id: string,
    principalId: string,
    now = this.now(),
  ): Promise<PendingAction | null> {
    const row = await this.database
      .prepare(
        `UPDATE assistant_pending_actions
        SET result_json = ?
        WHERE id = ?
          AND principal_id = ?
          AND domain = 'personal-integrations'
          AND status = 'executing'
          AND result_json IS NULL
          AND expires_at > ?
        RETURNING id, principal_id, domain, command, input_json, status, created_at, expires_at, resolved_at, result_json`,
      )
      .bind(
        JSON.stringify({ state: "dispatching" }),
        id,
        principalId,
        now.toISOString(),
      )
      .first<PendingActionRow>();
    return row ? toPendingAction(row) : null;
  }

  async complete(
    id: string,
    result: unknown,
    now = this.now(),
  ): Promise<PendingAction | null> {
    return this.resolve(id, "completed", result, now);
  }

  async fail(
    id: string,
    result: unknown,
    now = this.now(),
  ): Promise<PendingAction | null> {
    return this.resolve(id, "failed", result, now);
  }

  async cancel(
    id: string,
    principalId: string,
    now = this.now(),
  ): Promise<boolean> {
    const row = await this.database
      .prepare(
        `UPDATE assistant_pending_actions
        SET status = 'cancelled', resolved_at = ?
        WHERE id = ?
          AND principal_id = ?
          AND status = 'pending'
          AND expires_at > ?
        RETURNING id`,
      )
      .bind(now.toISOString(), id, principalId, now.toISOString())
      .first<{ id: string }>();
    return row !== null;
  }

  private async resolve(
    id: string,
    status: "completed" | "failed",
    result: unknown,
    now: Date,
  ): Promise<PendingAction | null> {
    const row = await this.database
      .prepare(
        `UPDATE assistant_pending_actions
        SET status = ?, resolved_at = ?, result_json = ?
        WHERE id = ? AND status = 'executing'
        RETURNING id, principal_id, domain, command, input_json, status, created_at, expires_at, resolved_at, result_json`,
      )
      .bind(status, now.toISOString(), JSON.stringify(result), id)
      .first<PendingActionRow>();
    return row ? toPendingAction(row) : null;
  }
}
