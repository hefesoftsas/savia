import { z } from "@hono/zod-openapi";

export const assistantThreadContextSchema = z
  .object({
    kind: z.enum(["recording", "session"]),
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(255),
  })
  .strict();

// UIMessage parts intentionally remain extensible as the AI SDK adds part types.
// The role and size bounds are enforced here because these messages are persisted.
export const assistantThreadMessagesSchema = z
  .array(
    z
      .object({
        id: z.string().max(200).optional(),
        role: z.enum(["user", "assistant"]),
        parts: z.array(z.record(z.string(), z.unknown())).max(100),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  )
  .max(100);

export const assistantThreadWriteSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    messages: assistantThreadMessagesSchema,
    context: assistantThreadContextSchema.optional(),
    expectedRevision: z.number().int().min(0),
  })
  .strict();

export type AssistantThreadContextInput = z.infer<
  typeof assistantThreadContextSchema
>;
export type AssistantThreadContext = AssistantThreadContextInput & {
  tenantId: number | null;
};
export type AssistantThreadMessage = z.infer<
  typeof assistantThreadMessagesSchema
>[number];
export type AssistantThread = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantThreadMessage[];
  revision: number;
  context?: AssistantThreadContext;
};
export type AssistantThreadSummary = Omit<AssistantThread, "messages"> & {
  messageCount: null;
  preview: string;
};
export type AssistantThreadWrite = z.infer<typeof assistantThreadWriteSchema>;

const threadIdSchema = z.string().uuid();
// D1 limits individual stored values to roughly 2 MiB. Leave headroom for SQL
// and metadata while keeping common text and small file parts recoverable.
const MAX_MESSAGE_BYTES = 1536 * 1024;
const MAX_PART_BYTES = 1536 * 1024;

export class AssistantThreadConflictError extends Error {
  constructor() {
    super("The conversation changed on another device. Reload before saving.");
    this.name = "AssistantThreadConflictError";
  }
}

export class AssistantThreadRepository {
  constructor(private readonly db: D1Database) {}

  async list(userId: string): Promise<AssistantThread[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, user_id, title, created_at, updated_at, messages, revision,
                context_kind, context_id, context_title, context_tenant_id
         FROM assistant_threads WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC LIMIT 50`,
      )
      .bind(userId)
      .all<ThreadRow>();
    return results.map(decodeThread);
  }

  async listSummaries(userId: string): Promise<AssistantThreadSummary[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, user_id, title, created_at, updated_at, revision,
                context_kind, context_id, context_title, context_tenant_id
         FROM assistant_threads WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC LIMIT 50`,
      )
      .bind(userId)
      .all<ThreadSummaryRow>();
    return results.map(decodeThreadSummary);
  }

  async findByContext(
    userId: string,
    kind: AssistantThreadContextInput["kind"],
    id: string,
    tenantId: number | null,
  ): Promise<AssistantThread | null> {
    const row = await this.db
      .prepare(
        `SELECT id, user_id, title, created_at, updated_at, messages, revision,
                context_kind, context_id, context_title, context_tenant_id
         FROM assistant_threads
         WHERE user_id = ? AND context_kind = ? AND context_id = ?
           AND COALESCE(context_tenant_id, -1) = ?
         LIMIT 1`,
      )
      .bind(userId, kind, id, tenantId ?? -1)
      .first<ThreadRow>();
    return row ? decodeThread(row) : null;
  }

  async findSummaryByContext(
    userId: string,
    kind: AssistantThreadContextInput["kind"],
    id: string,
    tenantId: number | null,
  ): Promise<AssistantThreadSummary | null> {
    const row = await this.db
      .prepare(
        `SELECT id, user_id, title, created_at, updated_at, revision,
                context_kind, context_id, context_title, context_tenant_id
         FROM assistant_threads
         WHERE user_id = ? AND context_kind = ? AND context_id = ?
           AND COALESCE(context_tenant_id, -1) = ?
         LIMIT 1`,
      )
      .bind(userId, kind, id, tenantId ?? -1)
      .first<ThreadSummaryRow>();
    return row ? decodeThreadSummary(row) : null;
  }

  async get(userId: string, id: string): Promise<AssistantThread | null> {
    if (!threadIdSchema.safeParse(id).success) return null;
    const row = await this.db
      .prepare(
        `SELECT id, user_id, title, created_at, updated_at, messages, revision,
                context_kind, context_id, context_title, context_tenant_id
         FROM assistant_threads WHERE user_id = ? AND id = ?`,
      )
      .bind(userId, id)
      .first<ThreadRow>();
    return row ? decodeThread(row) : null;
  }

  async save(
    userId: string,
    id: string,
    input: AssistantThreadWrite,
    contextTenantId: number | null = null,
  ): Promise<AssistantThread> {
    if (!threadIdSchema.safeParse(id).success)
      throw new TypeError("Invalid conversation identifier.");
    const parsed = assistantThreadWriteSchema.parse(input);
    const encodedMessages = JSON.stringify(parsed.messages);
    if (
      new TextEncoder().encode(encodedMessages).byteLength > MAX_MESSAGE_BYTES
    )
      throw new RangeError("Conversation exceeds the storage limit.");
    for (const message of parsed.messages) {
      for (const part of message.parts) {
        if (
          new TextEncoder().encode(JSON.stringify(part)).byteLength >
          MAX_PART_BYTES
        )
          throw new RangeError("Conversation part exceeds the storage limit.");
      }
    }

    const now = new Date().toISOString();
    let context = parsed.context;
    if (parsed.expectedRevision === 0) {
      try {
        await this.db
          .prepare(
            `INSERT INTO assistant_threads
             (id, user_id, title, created_at, updated_at, messages, revision,
              context_kind, context_id, context_title, context_tenant_id)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            userId,
            parsed.title,
            now,
            now,
            encodedMessages,
            context?.kind ?? null,
            context?.id ?? null,
            context?.title ?? null,
            context ? contextTenantId : null,
          )
          .run();
      } catch (error) {
        if (isConstraintError(error)) throw new AssistantThreadConflictError();
        throw error;
      }
    } else {
      const existing = await this.get(userId, id);
      if (!existing || existing.revision !== parsed.expectedRevision)
        throw new AssistantThreadConflictError();
      if (existing.context) {
        if (
          context &&
          (context.kind !== existing.context.kind ||
            context.id !== existing.context.id ||
            contextTenantId !== existing.context.tenantId)
        )
          throw new AssistantThreadConflictError();
        context = existing.context;
        contextTenantId = existing.context.tenantId;
      }
      let result: D1Result;
      try {
        result = await this.db
          .prepare(
            `UPDATE assistant_threads
             SET title = ?, updated_at = ?, messages = ?, revision = revision + 1,
                 context_kind = ?, context_id = ?, context_title = ?,
                 context_tenant_id = ?
             WHERE id = ? AND user_id = ? AND revision = ?`,
          )
          .bind(
            parsed.title,
            now,
            encodedMessages,
            context?.kind ?? null,
            context?.id ?? null,
            context?.title ?? null,
            context ? contextTenantId : null,
            id,
            userId,
            parsed.expectedRevision,
          )
          .run();
      } catch (error) {
        if (isConstraintError(error)) throw new AssistantThreadConflictError();
        throw error;
      }
      if (!result.success || result.meta.changes !== 1)
        throw new AssistantThreadConflictError();
    }

    const saved = await this.get(userId, id);
    if (!saved) throw new Error("Saved conversation could not be reloaded.");
    return saved;
  }

  async delete(userId: string, id: string, expectedRevision: number) {
    if (!threadIdSchema.safeParse(id).success)
      throw new AssistantThreadConflictError();
    const result = await this.db
      .prepare(
        `DELETE FROM assistant_threads WHERE id = ? AND user_id = ? AND revision = ?`,
      )
      .bind(id, userId, expectedRevision)
      .run();
    if (!result.success || result.meta.changes !== 1)
      throw new AssistantThreadConflictError();
  }
}

type ThreadRow = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: string;
  revision: number;
  context_kind: "recording" | "session" | null;
  context_id: string | null;
  context_title: string | null;
  context_tenant_id: number | null;
};

type ThreadSummaryRow = Omit<ThreadRow, "messages">;

function decodeThreadSummary(row: ThreadSummaryRow): AssistantThreadSummary {
  const context =
    row.context_kind && row.context_id && row.context_title
      ? {
          kind: row.context_kind,
          id: row.context_id,
          title: row.context_title,
          tenantId: row.context_tenant_id,
        }
      : undefined;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    messageCount: null,
    preview: "",
    ...(context ? { context } : {}),
  };
}

function decodeThread(row: ThreadRow): AssistantThread {
  let messages: unknown;
  try {
    messages = JSON.parse(row.messages);
  } catch {
    throw new Error("Stored conversation is invalid.");
  }
  const context =
    row.context_kind && row.context_id && row.context_title
      ? {
          kind: row.context_kind,
          id: row.context_id,
          title: row.context_title,
          tenantId: row.context_tenant_id,
        }
      : undefined;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: assistantThreadMessagesSchema.parse(messages),
    revision: row.revision,
    ...(context ? { context } : {}),
  };
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}
