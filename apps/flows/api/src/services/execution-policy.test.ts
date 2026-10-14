import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createExecutionPolicy,
  policyStatus,
  syncExecutionPolicyPause,
  type ExecutionPolicyEnvironment,
} from "./execution-policy";

const bindings = env as typeof env & ExecutionPolicyEnvironment;
const baseConfig = {
  CLOUDFLARE_ENV: "preview",
  SAVIA_FLOWS_POLICY_GENERATION: "10",
  SAVIA_FLOWS_EXECUTION_ENABLED: "true",
  SAVIA_FLOWS_QUOTAS_ENABLED: "true",
  SAVIA_FLOWS_MAX_DAILY_RUNS: "2",
  SAVIA_FLOWS_MAX_MONTHLY_RUNS: "3",
  SAVIA_FLOWS_MAX_CONCURRENT_RUNS: "1",
  SAVIA_FLOWS_MAX_NODES_PER_RUN: "2",
  SAVIA_FLOWS_MAX_STEPS_PER_RUN: "2",
};

beforeEach(async () => {
  await bindings.DB.prepare(
    "CREATE TABLE IF NOT EXISTS savia_flows_execution_policy (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, workflow_id TEXT NOT NULL, created_at INTEGER NOT NULL, state TEXT NOT NULL, active INTEGER NOT NULL, steps INTEGER NOT NULL, max_steps INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0)",
  ).run();
  await bindings.DB.prepare("DELETE FROM savia_flows_execution_policy").run();
  await bindings.DB.prepare(
    "CREATE TABLE IF NOT EXISTS savia_flows_execution_control (id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), paused INTEGER NOT NULL CHECK (paused IN (0, 1)), updated_at INTEGER NOT NULL, generation INTEGER NOT NULL DEFAULT 0)",
  ).run();
  await bindings.DB.prepare("DELETE FROM savia_flows_execution_control").run();
});

function makePolicy(overrides: Record<string, string | undefined> = {}) {
  return createExecutionPolicy({
    DB: bindings.DB,
    ...baseConfig,
    ...overrides,
  });
}

describe("execution policy", () => {
  it("atomically admits only within daily, monthly, and concurrency limits", async () => {
    const policy = makePolicy();
    const results = await Promise.all(
      ["one", "two", "three"].map((executionId) =>
        policy.admit({
          executionId,
          organizationId: "org",
          workflowId: "wf",
          nodeCount: 1,
        }),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed)).toHaveLength(2);
  });

  it("applies daily run limits across organizations", async () => {
    const policy = makePolicy({
      SAVIA_FLOWS_MAX_DAILY_RUNS: "1",
      SAVIA_FLOWS_MAX_CONCURRENT_RUNS: "2",
    });
    expect(
      (
        await policy.admit({
          executionId: "one",
          organizationId: "org-a",
          workflowId: "wf",
          nodeCount: 1,
        })
      ).allowed,
    ).toBe(true);
    expect(
      (
        await policy.admit({
          executionId: "two",
          organizationId: "org-b",
          workflowId: "wf",
          nodeCount: 1,
        })
      ).allowed,
    ).toBe(false);
  });

  it("deduplicates stable IDs and reacquires a released concurrency slot without recounting a run", async () => {
    const policy = makePolicy();
    const input = {
      executionId: "stable",
      organizationId: "org",
      workflowId: "wf",
      nodeCount: 1,
    };

    expect((await policy.admit(input)).allowed).toBe(true);
    expect(await policy.admit(input)).toMatchObject({
      allowed: true,
      alreadyActive: true,
    });
    expect(
      await policyStatus({ DB: bindings.DB, ...baseConfig }),
    ).toMatchObject({ activeRuns: 1 });
    await policy.release("stable", false);
    expect((await policy.admit(input)).allowed).toBe(true);
    await policy.release("stable", true);
    expect((await policy.admit(input)).allowed).toBe(false);
    expect(
      await policyStatus({ DB: bindings.DB, ...baseConfig }),
    ).toMatchObject({ activeRuns: 0 });
  });

  it("reclaims a crashed reservation after its bounded lease expires", async () => {
    let timestamp = Date.now();
    const policy = createExecutionPolicy(
      { DB: bindings.DB, ...baseConfig },
      { now: () => timestamp },
    );
    const input = {
      executionId: "crashed",
      organizationId: "org",
      workflowId: "wf",
      nodeCount: 1,
    };

    expect((await policy.admit(input)).allowed).toBe(true);
    timestamp += 21 * 60 * 1000;
    const reclaimed = await policy.admit(input);
    expect(reclaimed.allowed).toBe(true);
    expect(reclaimed.alreadyActive).toBeUndefined();
    await policy.consumeStep("crashed");
    await policy.release("crashed", true);
  });

  it("blocks paused executions and rejects invalid quota configuration closed", async () => {
    const paused = makePolicy({ SAVIA_FLOWS_EXECUTION_ENABLED: "false" });
    expect(
      (
        await paused.admit({
          executionId: "paused",
          organizationId: "org",
          workflowId: "wf",
          nodeCount: 1,
        })
      ).allowed,
    ).toBe(false);

    const invalid = makePolicy({ SAVIA_FLOWS_MAX_STEPS_PER_RUN: "0" });
    expect(
      await invalid.admit({
        executionId: "invalid",
        organizationId: "org",
        workflowId: "wf",
        nodeCount: 1,
      }),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/configuration/i),
    });
  });

  it("fails closed when cloud execution or quota flags are missing or malformed", async () => {
    const cloud = { DB: bindings.DB, CLOUDFLARE_ENV: "preview" };
    const missing = createExecutionPolicy(cloud);
    const malformed = createExecutionPolicy({
      ...baseConfig,
      ...cloud,
      SAVIA_FLOWS_EXECUTION_ENABLED: "yes",
    });
    const malformedQuotaFlag = createExecutionPolicy({
      ...baseConfig,
      ...cloud,
      SAVIA_FLOWS_QUOTAS_ENABLED: "on",
    });

    expect(
      await missing.admit({
        executionId: "missing-flags",
        organizationId: "org",
        workflowId: "wf",
        nodeCount: 1,
      }),
    ).toMatchObject({ allowed: false });
    expect(
      await malformed.admit({
        executionId: "malformed-flags",
        organizationId: "org",
        workflowId: "wf",
        nodeCount: 1,
      }),
    ).toMatchObject({ allowed: false });
    expect(
      await malformedQuotaFlag.admit({
        executionId: "malformed-quota-flag",
        organizationId: "org",
        workflowId: "wf",
        nodeCount: 1,
      }),
    ).toMatchObject({ allowed: false });
  });

  it("fails closed when cloud policy generation is missing or malformed", async () => {
    for (const generation of [undefined, "0", "10.5", "9007199254740992"]) {
      const policy = createExecutionPolicy({
        DB: bindings.DB,
        ...baseConfig,
        SAVIA_FLOWS_POLICY_GENERATION: generation,
      });
      expect(
        await policy.admit({
          executionId: crypto.randomUUID(),
          organizationId: "org",
          workflowId: "wf",
          nodeCount: 1,
        }),
      ).toMatchObject({ allowed: false });
    }
  });

  it("preserves the legacy unmetered default only for an explicit local environment", async () => {
    const local = createExecutionPolicy({
      DB: bindings.DB,
      CLOUDFLARE_ENV: "development",
    });
    expect(
      await local.admit({
        executionId: "local-default",
        organizationId: "org",
        workflowId: "wf",
        nodeCount: 1,
      }),
    ).toEqual({ allowed: true });
  });

  it("does not let a cloud preview inherit local-only unmetered settings", async () => {
    for (const config of [
      {
        CLOUDFLARE_ENV: "preview",
        SAVIA_FLOWS_LOCAL_ONLY: "true",
      },
      {
        CLOUDFLARE_ENV: "preview",
        SAVIA_FLOWS_LOCAL_ONLY: "true",
        SAVIA_FLOWS_EXECUTION_ENABLED: "true",
        SAVIA_FLOWS_QUOTAS_ENABLED: "false",
      },
    ]) {
      const policy = createExecutionPolicy({ DB: bindings.DB, ...config });
      expect(
        await policy.admit({
          executionId: crypto.randomUUID(),
          organizationId: "org",
          workflowId: "wf",
          nodeCount: 1,
        }),
      ).toMatchObject({ allowed: false });
    }
  });

  it("enforces per-run node and step bounds before additional work", async () => {
    const policy = makePolicy();
    expect(
      (
        await policy.admit({
          executionId: "too-many-nodes",
          organizationId: "org",
          workflowId: "wf",
          nodeCount: 3,
        })
      ).allowed,
    ).toBe(false);
    expect(
      (
        await policy.admit({
          executionId: "bounded",
          organizationId: "org",
          workflowId: "wf",
          nodeCount: 1,
        })
      ).allowed,
    ).toBe(true);
    await policy.consumeStep("bounded");
    await policy.consumeStep("bounded");
    await expect(policy.consumeStep("bounded")).rejects.toThrow(/step limit/i);
  });

  it("reacquires concurrency after a long durable wait without recounting the run", async () => {
    let timestamp = Date.now();
    const policy = createExecutionPolicy(
      { DB: bindings.DB, ...baseConfig },
      { now: () => timestamp },
    );
    await policy.admit({
      executionId: "long-wait",
      organizationId: "org-a",
      workflowId: "wf",
      nodeCount: 1,
    });
    await policy.release("long-wait", false);
    const blocker = createExecutionPolicy(
      { DB: bindings.DB, ...baseConfig },
      { now: () => timestamp },
    );
    expect(
      (
        await blocker.admit({
          executionId: "blocking-run",
          organizationId: "org-b",
          workflowId: "wf",
          nodeCount: 1,
        })
      ).allowed,
    ).toBe(true);

    timestamp += 21 * 60 * 1000;
    await policy.release("blocking-run", false);
    await policy.consumeStep("long-wait");

    const row = await bindings.DB.prepare(
      "SELECT steps, active, lease_until FROM savia_flows_execution_policy WHERE id='long-wait'",
    ).first<{ steps: number; active: number; lease_until: number }>();
    const count = await bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM savia_flows_execution_policy WHERE created_at >= ?",
    )
      .bind(timestamp - 24 * 60 * 60 * 1000)
      .first<{ count: number }>();
    expect(row).toMatchObject({
      steps: 1,
      active: 1,
      lease_until: timestamp + 20 * 60 * 1000,
    });
    expect(count?.count).toBe(2);
  });

  it("reports concurrency contention separately from an exhausted step budget", async () => {
    let timestamp = Date.now();
    const policy = createExecutionPolicy(
      { DB: bindings.DB, ...baseConfig },
      { now: () => timestamp },
    );
    await policy.admit({
      executionId: "waiting",
      organizationId: "org",
      workflowId: "wf",
      nodeCount: 1,
    });
    timestamp += 21 * 60 * 1000;
    await policy.admit({
      executionId: "occupier",
      organizationId: "org",
      workflowId: "wf",
      nodeCount: 1,
    });

    await expect(policy.consumeStep("waiting")).rejects.toThrow(
      /concurrent execution limit/i,
    );
  });

  it("enforces the newest persisted pause state against an older runtime binding", async () => {
    const oldEnvironment = { DB: bindings.DB, ...baseConfig };
    const oldPolicy = createExecutionPolicy(oldEnvironment);
    await oldPolicy.admit({
      executionId: "old-runtime",
      organizationId: "org",
      workflowId: "wf",
      nodeCount: 1,
    });

    await syncExecutionPolicyPause({
      DB: bindings.DB,
      ...baseConfig,
      SAVIA_FLOWS_POLICY_GENERATION: "11",
      SAVIA_FLOWS_EXECUTION_ENABLED: "false",
    });
    await expect(oldPolicy.consumeStep("old-runtime")).rejects.toThrow(
      /paused/i,
    );

    await syncExecutionPolicyPause(oldEnvironment);
    await expect(oldPolicy.consumeStep("old-runtime")).rejects.toThrow(
      /paused/i,
    );

    await syncExecutionPolicyPause({
      DB: bindings.DB,
      ...baseConfig,
      SAVIA_FLOWS_POLICY_GENERATION: "11",
    });
    await expect(oldPolicy.consumeStep("old-runtime")).rejects.toThrow(
      /paused/i,
    );

    await syncExecutionPolicyPause({
      DB: bindings.DB,
      ...baseConfig,
      SAVIA_FLOWS_POLICY_GENERATION: "12",
    });
    await expect(oldPolicy.consumeStep("old-runtime")).resolves.toBeUndefined();
  });

  it("does not consume a step when pause is committed after the pause read", async () => {
    const ordinary = bindings.DB;
    let injectedPause = false;
    let pauseWritten = false;
    const racingDb = {
      prepare(sql: string) {
        const statement = ordinary.prepare(sql);
        return {
          run: () => statement.run(),
          first: async <T>() => {
            const row = await statement.first<T>();
            if (
              injectedPause &&
              !pauseWritten &&
              sql.includes(
                "SELECT paused FROM savia_flows_execution_control",
              ) &&
              row &&
              (row as unknown as { paused: number }).paused === 0
            ) {
              pauseWritten = true;
              await syncExecutionPolicyPause({
                DB: ordinary,
                ...baseConfig,
                SAVIA_FLOWS_EXECUTION_ENABLED: "false",
              });
            }
            return row;
          },
          all: <T>() => statement.all<T>(),
          bind(...values: unknown[]) {
            const bound = statement.bind(...values);
            return {
              first: async <T>() => {
                const row = await bound.first<T>();
                if (
                  injectedPause &&
                  !pauseWritten &&
                  sql.includes(
                    "SELECT paused FROM savia_flows_execution_control",
                  ) &&
                  row &&
                  (row as unknown as { paused: number }).paused === 0
                ) {
                  pauseWritten = true;
                  await syncExecutionPolicyPause({
                    DB: ordinary,
                    ...baseConfig,
                    SAVIA_FLOWS_EXECUTION_ENABLED: "false",
                  });
                }
                return row;
              },
              run: () => bound.run(),
              all: <T>() => bound.all<T>(),
            };
          },
        };
      },
    } as unknown as D1Database;
    const policy = createExecutionPolicy({ DB: racingDb, ...baseConfig });
    await syncExecutionPolicyPause({ DB: ordinary, ...baseConfig });
    await policy.admit({
      executionId: "paused-between-read-and-write",
      organizationId: "org",
      workflowId: "wf",
      nodeCount: 1,
    });
    injectedPause = true;

    await expect(
      policy.consumeStep("paused-between-read-and-write"),
    ).rejects.toThrow(/paused/i);
    const row = await ordinary
      .prepare("SELECT steps FROM savia_flows_execution_policy WHERE id = ?")
      .bind("paused-between-read-and-write")
      .first<{ steps: number }>();
    expect(injectedPause).toBe(true);
    expect(row?.steps).toBe(0);
  });
});
