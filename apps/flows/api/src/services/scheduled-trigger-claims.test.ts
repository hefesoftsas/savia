import { env } from "cloudflare:test";
import type { D1Migration } from "cloudflare:test";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimScheduledTriggerOccurrence,
  completeScheduledTriggerOccurrence,
  listExpiredScheduledTriggerOccurrences,
  markScheduledTriggerOccurrenceDispatched,
  pruneCompletedScheduledTriggerOccurrences,
  renewScheduledTriggerOccurrenceLease,
  releaseScheduledTriggerOccurrence,
  type ScheduledTriggerClaimEnvironment,
} from "./scheduled-trigger-claims";

const testEnv = env as unknown as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
  DB: D1Database;
};
const bindings = testEnv as unknown as ScheduledTriggerClaimEnvironment;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await bindings.DB.prepare(
    "DELETE FROM savia_scheduled_trigger_occurrences",
  ).run();
  await bindings.DB.prepare(
    "INSERT OR IGNORE INTO organizations (id, name) VALUES (?, ?)",
  )
    .bind("organization-123", "Test organization")
    .run();
  await bindings.DB.prepare(
    `INSERT OR IGNORE INTO workflows (id, name, trigger, organization_id)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(
      "workflow-123",
      "Scheduled claim workflow",
      "scheduled",
      "organization-123",
    )
    .run();
  await bindings.DB.prepare(
    `INSERT OR REPLACE INTO scheduled_triggers
       (workflow_id, schedule_expression, active, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`,
  )
    .bind("workflow-123", "* * * * *", Date.now(), Date.now())
    .run();
});

describe("scheduled trigger occurrence claims", () => {
  it("admits only one concurrent cron invocation and gives both the same stable execution id", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };

    const claims = await Promise.all([
      claimScheduledTriggerOccurrence(bindings, input),
      claimScheduledTriggerOccurrence(bindings, input),
    ]);

    expect(claims.map((claim) => claim.status).sort()).toEqual([
      "acquired",
      "leased",
    ]);
    expect(new Set(claims.map((claim) => claim.executionId)).size).toBe(1);
  });

  it("reclaims an expired pre-dispatch lease without changing the occurrence id", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const first = await claimScheduledTriggerOccurrence(bindings, input);
    const retry = await claimScheduledTriggerOccurrence(bindings, {
      ...input,
      now: 160_000,
    });

    expect(first.status).toBe("acquired");
    expect(retry).toMatchObject({
      status: "acquired",
      executionId: first.executionId,
      attempts: 2,
    });
    expect(retry.leaseToken).not.toBe(first.leaseToken);
  });

  it("reclaims an expired durable Workflow dispatch with the original ID", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const first = await claimScheduledTriggerOccurrence(bindings, input);
    await markScheduledTriggerOccurrenceDispatched(bindings, {
      workflowFingerprint: "test-workflow-v1",
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      leaseToken: first.leaseToken,
      runtime: "workflow",
      now: input.now,
      leaseMs: input.leaseMs,
    });

    const retry = await claimScheduledTriggerOccurrence(bindings, {
      ...input,
      now: 160_000,
    });

    expect(retry).toMatchObject({
      status: "acquired",
      executionId: first.executionId,
      attempts: 2,
    });
    expect(
      await markScheduledTriggerOccurrenceDispatched(bindings, {
        workflowFingerprint: "test-workflow-v1",
        workflowId: input.workflowId,
        scheduledTime: input.scheduledTime,
        leaseToken: retry.leaseToken,
        runtime: "workflow",
        now: 160_000,
        leaseMs: input.leaseMs,
      }),
    ).toBe(true);
  });

  it("does not redispatch an expired synchronous Worker claim with an ambiguous outcome", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const first = await claimScheduledTriggerOccurrence(bindings, input);
    await markScheduledTriggerOccurrenceDispatched(bindings, {
      workflowFingerprint: "test-workflow-v1",
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      leaseToken: first.leaseToken,
      runtime: "worker",
      now: input.now,
      leaseMs: input.leaseMs,
    });

    const retry = await claimScheduledTriggerOccurrence(bindings, {
      ...input,
      now: 160_000,
    });

    expect(retry).toMatchObject({
      status: "uncertain",
      executionId: first.executionId,
    });
    expect(
      await claimScheduledTriggerOccurrence(bindings, {
        ...input,
        now: 160_001,
      }),
    ).toMatchObject({ status: "uncertain", executionId: first.executionId });
  });

  it("marks an expired occurrence obsolete after its schedule is edited", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const first = await claimScheduledTriggerOccurrence(bindings, input);
    await markScheduledTriggerOccurrenceDispatched(bindings, {
      workflowFingerprint: "test-workflow-v1",
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      leaseToken: first.leaseToken,
      runtime: "workflow",
      now: input.now,
      leaseMs: input.leaseMs,
    });
    await bindings.DB.prepare(
      "UPDATE scheduled_triggers SET schedule_expression = ?, updated_at = updated_at + 1 WHERE workflow_id = ?",
    )
      .bind("*/5 * * * *", input.workflowId)
      .run();

    expect(
      await listExpiredScheduledTriggerOccurrences(bindings, { now: 160_000 }),
    ).toEqual([]);

    const retry = await claimScheduledTriggerOccurrence(bindings, {
      ...input,
      now: 160_000,
    });

    expect(retry).toMatchObject({
      status: "obsolete",
      executionId: first.executionId,
    });
    expect(
      await listExpiredScheduledTriggerOccurrences(bindings, { now: 160_000 }),
    ).toEqual([]);
  });

  it("marks an expired occurrence obsolete when workflow data changes without a timestamp change", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const first = await claimScheduledTriggerOccurrence(bindings, input);
    await markScheduledTriggerOccurrenceDispatched(bindings, {
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      workflowFingerprint: input.workflowFingerprint,
      leaseToken: first.leaseToken,
      runtime: "workflow",
      now: input.now,
      leaseMs: input.leaseMs,
    });

    const retry = await claimScheduledTriggerOccurrence(bindings, {
      ...input,
      workflowFingerprint: "test-workflow-v2",
      now: 160_000,
    });

    expect(retry).toMatchObject({
      status: "obsolete",
      executionId: first.executionId,
    });
  });

  it("keeps a dispatched Worker claim uncertain when only the R2 fingerprint changes", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const claim = await claimScheduledTriggerOccurrence(bindings, input);
    await markScheduledTriggerOccurrenceDispatched(bindings, {
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      workflowFingerprint: input.workflowFingerprint,
      leaseToken: claim.leaseToken,
      runtime: "worker",
      now: input.now,
      leaseMs: input.leaseMs,
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await claimScheduledTriggerOccurrence(bindings, {
      ...input,
      workflowFingerprint: "test-workflow-v2",
      now: 110_000,
    });

    expect(result).toMatchObject({
      status: "uncertain",
      executionId: claim.executionId,
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        `workflow=${input.workflowId} occurrence=${input.scheduledTime} execution=${claim.executionId}`,
      ),
    );
    log.mockRestore();
  });

  it("marks an expired occurrence obsolete while its trigger is disabled", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const first = await claimScheduledTriggerOccurrence(bindings, input);
    await markScheduledTriggerOccurrenceDispatched(bindings, {
      workflowFingerprint: "test-workflow-v1",
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      leaseToken: first.leaseToken,
      runtime: "workflow",
      now: input.now,
      leaseMs: input.leaseMs,
    });
    await bindings.DB.prepare(
      "UPDATE scheduled_triggers SET active = 0, updated_at = updated_at + 1 WHERE workflow_id = ?",
    )
      .bind(input.workflowId)
      .run();

    expect(
      await listExpiredScheduledTriggerOccurrences(bindings, { now: 160_000 }),
    ).toEqual([]);

    const retry = await claimScheduledTriggerOccurrence(bindings, {
      ...input,
      now: 160_000,
    });

    expect(retry).toMatchObject({
      status: "obsolete",
      executionId: first.executionId,
    });
  });

  it("keeps an expired Worker claim uncertain if its configuration changed", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const first = await claimScheduledTriggerOccurrence(bindings, input);
    await markScheduledTriggerOccurrenceDispatched(bindings, {
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      workflowFingerprint: input.workflowFingerprint,
      leaseToken: first.leaseToken,
      runtime: "worker",
      now: input.now,
      leaseMs: input.leaseMs,
    });
    await bindings.DB.prepare(
      "UPDATE scheduled_triggers SET schedule_expression = ?, updated_at = updated_at + 1 WHERE workflow_id = ?",
    )
      .bind("*/5 * * * *", input.workflowId)
      .run();

    expect(
      await listExpiredScheduledTriggerOccurrences(bindings, { now: 160_000 }),
    ).toEqual([]);
    expect(
      await bindings.DB.prepare(
        "SELECT status FROM savia_scheduled_trigger_occurrences WHERE workflow_id = ? AND scheduled_time = ?",
      )
        .bind(input.workflowId, input.scheduledTime)
        .first<{ status: string }>(),
    ).toMatchObject({ status: "uncertain" });
  });

  it("retains an uncertain claim after the workflow row is deleted", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const claim = await claimScheduledTriggerOccurrence(bindings, input);
    await markScheduledTriggerOccurrenceDispatched(bindings, {
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      workflowFingerprint: input.workflowFingerprint,
      leaseToken: claim.leaseToken,
      runtime: "worker",
      now: input.now,
      leaseMs: input.leaseMs,
    });
    await bindings.DB.prepare("DELETE FROM workflows WHERE id = ?")
      .bind(input.workflowId)
      .run();

    await listExpiredScheduledTriggerOccurrences(bindings, {
      now: 160_000,
    });

    expect(
      await bindings.DB.prepare(
        "SELECT status, execution_id FROM savia_scheduled_trigger_occurrences WHERE workflow_id = ? AND scheduled_time = ?",
      )
        .bind(input.workflowId, input.scheduledTime)
        .first<{ status: string; execution_id: string }>(),
    ).toMatchObject({ status: "uncertain", execution_id: claim.executionId });
  });

  it("bounds the number of stale claims transitioned per repair tick", async () => {
    for (const scheduledTime of [10_000, 20_000, 30_000]) {
      const claim = await claimScheduledTriggerOccurrence(bindings, {
        workflowId: "workflow-123",
        workflowFingerprint: "test-workflow-v1",
        scheduledTime,
        now: 0,
        leaseMs: 1,
      });
      await markScheduledTriggerOccurrenceDispatched(bindings, {
        workflowId: "workflow-123",
        scheduledTime,
        workflowFingerprint: "test-workflow-v1",
        leaseToken: claim.leaseToken,
        runtime: "workflow",
        now: 0,
        leaseMs: 1,
      });
    }
    await bindings.DB.prepare(
      "UPDATE scheduled_triggers SET active = 0 WHERE workflow_id = ?",
    )
      .bind("workflow-123")
      .run();

    await listExpiredScheduledTriggerOccurrences(bindings, {
      now: 10,
      limit: 1,
    });
    expect(
      await bindings.DB.prepare(
        "SELECT status, COUNT(*) AS count FROM savia_scheduled_trigger_occurrences GROUP BY status ORDER BY status",
      ).all<{ status: string; count: number }>(),
    ).toMatchObject({
      results: [
        { status: "dispatched", count: 2 },
        { status: "obsolete", count: 1 },
      ],
    });
  });

  it("renews a live dispatched claim so long Worker runs stay fenced", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const claim = await claimScheduledTriggerOccurrence(bindings, input);
    await markScheduledTriggerOccurrenceDispatched(bindings, {
      workflowFingerprint: "test-workflow-v1",
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      leaseToken: claim.leaseToken,
      runtime: "worker",
      now: input.now,
      leaseMs: input.leaseMs,
    });

    expect(
      await renewScheduledTriggerOccurrenceLease(bindings, {
        workflowId: input.workflowId,
        scheduledTime: input.scheduledTime,
        leaseToken: claim.leaseToken,
        now: 150_000,
        leaseMs: input.leaseMs,
      }),
    ).toBe(true);
    expect(
      await claimScheduledTriggerOccurrence(bindings, {
        ...input,
        now: 160_000,
      }),
    ).toMatchObject({ status: "leased", executionId: claim.executionId });
  });

  it("does not let a stale owner release a lease after it has been reclaimed", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const first = await claimScheduledTriggerOccurrence(bindings, input);
    const retry = await claimScheduledTriggerOccurrence(bindings, {
      ...input,
      now: 160_000,
    });

    await releaseScheduledTriggerOccurrence(bindings, {
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      leaseToken: first.leaseToken,
      now: 160_000,
    });
    const stillLeased = await claimScheduledTriggerOccurrence(bindings, {
      ...input,
      now: 160_001,
    });

    expect(retry.status).toBe("acquired");
    expect(stillLeased.status).toBe("leased");
    expect(stillLeased.leaseToken).toBe(retry.leaseToken);
  });

  it("releases a pre-dispatch failure for immediate retry with the same execution id", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const first = await claimScheduledTriggerOccurrence(bindings, input);
    await releaseScheduledTriggerOccurrence(bindings, {
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      leaseToken: first.leaseToken,
      now: input.now,
    });

    const retry = await claimScheduledTriggerOccurrence(bindings, input);

    expect(retry).toMatchObject({
      status: "acquired",
      executionId: first.executionId,
      attempts: 2,
    });
  });

  it("does not let a stale owner complete an occurrence after lease takeover", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const first = await claimScheduledTriggerOccurrence(bindings, input);
    const retry = await claimScheduledTriggerOccurrence(bindings, {
      ...input,
      now: 160_000,
    });

    const completed = await completeScheduledTriggerOccurrence(bindings, {
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      leaseToken: first.leaseToken,
      now: 160_001,
    });

    expect(completed).toBe(false);
    expect(retry.status).toBe("acquired");
    expect(
      await claimScheduledTriggerOccurrence(bindings, {
        ...input,
        now: 160_001,
      }),
    ).toMatchObject({ status: "leased", leaseToken: retry.leaseToken });
  });

  it("keeps a completed occurrence closed to later cron deliveries", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const claim = await claimScheduledTriggerOccurrence(bindings, input);
    await completeScheduledTriggerOccurrence(bindings, {
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      leaseToken: claim.leaseToken,
      now: 101_000,
    });

    const duplicate = await claimScheduledTriggerOccurrence(bindings, {
      ...input,
      now: 200_000,
    });

    expect(duplicate.status).toBe("completed");
    expect(duplicate.executionId).toBe(claim.executionId);
  });

  it("lists expired claims beyond the current cron minute for recovery", async () => {
    const input = {
      workflowId: "workflow-123",
      workflowFingerprint: "test-workflow-v1",
      scheduledTime: 1_730_000_000_000,
      now: 100_000,
      leaseMs: 60_000,
    };
    const claim = await claimScheduledTriggerOccurrence(bindings, input);
    await markScheduledTriggerOccurrenceDispatched(bindings, {
      workflowFingerprint: "test-workflow-v1",
      workflowId: input.workflowId,
      scheduledTime: input.scheduledTime,
      leaseToken: claim.leaseToken,
      runtime: "workflow",
      now: input.now,
      leaseMs: input.leaseMs,
    });

    const expired = await listExpiredScheduledTriggerOccurrences(bindings, {
      now: 160_000,
    });

    expect(expired).toEqual([
      { workflowId: input.workflowId, scheduledTime: input.scheduledTime },
    ]);
  });

  it("prunes old completed claims in bounded batches and retains uncertain claims", async () => {
    const older = await claimScheduledTriggerOccurrence(bindings, {
      workflowFingerprint: "test-workflow-v1",
      workflowId: "workflow-123",
      scheduledTime: 10_000,
      now: 10,
    });
    const newer = await claimScheduledTriggerOccurrence(bindings, {
      workflowFingerprint: "test-workflow-v1",
      workflowId: "workflow-123",
      scheduledTime: 20_000,
      now: 20,
    });
    const uncertain = await claimScheduledTriggerOccurrence(bindings, {
      workflowFingerprint: "test-workflow-v1",
      workflowId: "workflow-123",
      scheduledTime: 30_000,
      now: 30,
      leaseMs: 1,
    });
    await completeScheduledTriggerOccurrence(bindings, {
      workflowId: "workflow-123",
      scheduledTime: 10_000,
      leaseToken: older.leaseToken,
      now: 10,
    });
    await completeScheduledTriggerOccurrence(bindings, {
      workflowId: "workflow-123",
      scheduledTime: 20_000,
      leaseToken: newer.leaseToken,
      now: 20,
    });
    await markScheduledTriggerOccurrenceDispatched(bindings, {
      workflowFingerprint: "test-workflow-v1",
      workflowId: "workflow-123",
      scheduledTime: 30_000,
      leaseToken: uncertain.leaseToken,
      runtime: "worker",
      now: 30,
      leaseMs: 1,
    });
    await claimScheduledTriggerOccurrence(bindings, {
      workflowFingerprint: "test-workflow-v1",
      workflowId: "workflow-123",
      scheduledTime: 30_000,
      now: 31,
    });

    expect(
      await pruneCompletedScheduledTriggerOccurrences(bindings, {
        now: 100_000,
        retentionMs: 50_000,
        limit: 1,
      }),
    ).toBe(1);
    expect(
      await bindings.DB.prepare(
        "SELECT status FROM savia_scheduled_trigger_occurrences ORDER BY scheduled_time",
      ).all<{ status: string }>(),
    ).toMatchObject({
      results: [{ status: "completed" }, { status: "uncertain" }],
    });
    expect(
      await pruneCompletedScheduledTriggerOccurrences(bindings, {
        now: 100_000,
        retentionMs: 50_000,
        limit: 10,
      }),
    ).toBe(1);
    expect(
      await bindings.DB.prepare(
        "SELECT status FROM savia_scheduled_trigger_occurrences",
      ).all<{ status: string }>(),
    ).toMatchObject({ results: [{ status: "uncertain" }] });
  });
});
