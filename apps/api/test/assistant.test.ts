import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const migrationSqls = Object.entries(
  import.meta.glob<string>("../../../packages/db/migrations/*.sql", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, sql]) => sql);

function migrationStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) =>
      statement
        .replace(/^--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

async function applyMigrations() {
  for (const migration of migrationSqls) {
    for (const statement of migrationStatements(migration)) {
      await env.DB.exec(statement);
    }
  }
}

describe("assistant command approvals", () => {
  beforeAll(applyMigrations);

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM assistant_pending_actions");
  });

  it("creates a pending command approval that only its owner can consume once", async () => {
    const { PendingActionRepository } =
      await import("../src/assistant/pending-actions");
    const now = new Date("2026-09-02T12:00:00.000Z");
    const repository = new PendingActionRepository(env.DB, () => now);

    const action = await repository.issue({
      id: "approval-1",
      principalId: "test-platform-admin",
      domain: "agency-network",
      command: "create-agency-profile",
      input: { organization: { displayName: "Savia Norte" } },
    });

    expect(action.status).toBe("pending");
    expect(action.expiresAt).toBe("2026-09-02T12:05:00.000Z");
    expect(
      await repository.consume("approval-1", "other-principal", now),
    ).toBeNull();
    expect(
      await repository.consume("approval-1", "test-platform-admin", now),
    ).toMatchObject({ status: "executing" });
    expect(
      await repository.consume("approval-1", "test-platform-admin", now),
    ).toBeNull();
  });

  it("finishes and cancels approvals without allowing another transition", async () => {
    const { PendingActionRepository } =
      await import("../src/assistant/pending-actions");
    const now = new Date("2026-09-02T12:00:00.000Z");
    const repository = new PendingActionRepository(env.DB, () => now);
    const completed = await repository.issue({
      id: "approval-2",
      principalId: "test-platform-admin",
      domain: "agency-network",
      command: "create-agency-profile",
      input: { organization: { displayName: "Savia Sur" } },
    });

    await repository.consume(completed.id, completed.principalId, now);
    const finished = await repository.complete(
      completed.id,
      { document: { id: "101" } },
      now,
    );

    expect(finished).toMatchObject({
      status: "completed",
      result: { document: { id: "101" } },
    });
    expect(
      await repository.cancel(completed.id, completed.principalId, now),
    ).toBe(false);

    const cancelled = await repository.issue({
      ...completed,
      id: "approval-3",
      input: { organization: { displayName: "Savia Centro" } },
    });
    expect(
      await repository.cancel(cancelled.id, cancelled.principalId, now),
    ).toBe(true);
    expect(
      await repository.consume(cancelled.id, cancelled.principalId, now),
    ).toBeNull();
  });

  it("records an execution failure only after the approval was consumed", async () => {
    const { PendingActionRepository } =
      await import("../src/assistant/pending-actions");
    const now = new Date("2026-09-02T12:00:00.000Z");
    const repository = new PendingActionRepository(env.DB, () => now);
    const action = await repository.issue({
      id: "approval-4",
      principalId: "test-platform-admin",
      domain: "agency-network",
      command: "create-agency-profile",
      input: { organization: { displayName: "Savia Occidente" } },
    });

    expect(
      await repository.fail(action.id, { message: "MCP unavailable" }, now),
    ).toBeNull();
    await repository.consume(action.id, action.principalId, now);
    expect(
      await repository.fail(action.id, { message: "MCP unavailable" }, now),
    ).toMatchObject({
      status: "failed",
      result: { message: "MCP unavailable" },
    });
  });
});
