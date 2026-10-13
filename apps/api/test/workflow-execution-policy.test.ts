import { describe, expect, it, vi } from "vitest";
import { processWorkflows } from "@savia/flows-native/runtime";
import { nativeExecutionPolicyFromEnvironment } from "../src/workflows";

const bounds = {
  SAVIA_FLOWS_MAX_DAILY_RUNS: "100",
  SAVIA_FLOWS_MAX_MONTHLY_RUNS: "1000",
  SAVIA_FLOWS_MAX_CONCURRENT_RUNS: "2",
  SAVIA_FLOWS_MAX_NODES_PER_RUN: "50",
  SAVIA_FLOWS_MAX_STEPS_PER_RUN: "200",
};

describe("native workflow execution policy configuration", () => {
  it.each([
    [{ CLOUDFLARE_ENV: "preview" }],
    [
      {
        CLOUDFLARE_ENV: "preview",
        SAVIA_FLOWS_EXECUTION_ENABLED: "true",
      },
    ],
    [
      {
        CLOUDFLARE_ENV: "preview",
        SAVIA_FLOWS_LOCAL_ONLY: "true",
      },
    ],
    [
      {
        CLOUDFLARE_ENV: "preview",
        SAVIA_FLOWS_EXECUTION_ENABLED: "yes",
        SAVIA_FLOWS_QUOTAS_ENABLED: "true",
        ...bounds,
      },
    ],
    [
      {
        CLOUDFLARE_ENV: "preview",
        SAVIA_FLOWS_EXECUTION_ENABLED: "true",
        SAVIA_FLOWS_QUOTAS_ENABLED: "on",
        ...bounds,
      },
    ],
  ])("fails closed for incomplete or malformed cloud flags: %o", (config) => {
    expect(nativeExecutionPolicyFromEnvironment(config)).toMatchObject({
      paused: expect.any(Function),
    });
    expect(nativeExecutionPolicyFromEnvironment(config)?.paused()).toBe(true);
  });

  it("pauses cloud execution when any required quota bound is missing", () => {
    for (const name of Object.keys(bounds) as Array<keyof typeof bounds>) {
      const policy = nativeExecutionPolicyFromEnvironment({
        CLOUDFLARE_ENV: "preview",
        SAVIA_FLOWS_EXECUTION_ENABLED: "true",
        SAVIA_FLOWS_QUOTAS_ENABLED: "true",
        ...bounds,
        [name]: undefined,
      });
      expect(policy?.paused(), name).toBe(true);
    }
  });

  it("pauses when quota enforcement has no internal bridge", () => {
    const policy = nativeExecutionPolicyFromEnvironment({
      CLOUDFLARE_ENV: "preview",
      SAVIA_FLOWS_EXECUTION_ENABLED: "true",
      SAVIA_FLOWS_QUOTAS_ENABLED: "true",
      ...bounds,
    });
    expect(policy?.paused()).toBe(true);
  });

  it("keeps zero-flag legacy behavior only in explicit local environments", () => {
    expect(
      nativeExecutionPolicyFromEnvironment({ CLOUDFLARE_ENV: "development" }),
    ).toBeUndefined();
    expect(
      nativeExecutionPolicyFromEnvironment({ SAVIA_FLOWS_LOCAL_ONLY: "true" }),
    ).toBeUndefined();
  });

  it("does not schedule or claim native jobs while execution is paused", async () => {
    const policy = nativeExecutionPolicyFromEnvironment({
      CLOUDFLARE_ENV: "preview",
      SAVIA_FLOWS_EXECUTION_ENABLED: "false",
      SAVIA_FLOWS_QUOTAS_ENABLED: "false",
    });
    const prepare = vi.fn(() => {
      throw new Error("database must not be touched while paused");
    });

    await expect(
      processWorkflows({ prepare } as unknown as D1Database, async () => true, {
        executionPolicy: policy,
      }),
    ).resolves.toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("requeues a claimed job when pause arrives before policy admission", async () => {
    const definition = JSON.stringify({
      trigger: { type: "manual" },
      nodes: [{ id: "step", type: "transform", values: {} }],
    });
    const run = {
      workspace_id: "org",
      id: "execution",
      workflow_id: "flow",
      version_id: "flow:1",
      owner_id: "owner",
      initiator_id: "owner",
      event_key: "event",
      status: "queued",
      node_id: "step",
      context: JSON.stringify({
        trigger: {},
        before: {},
        steps: {},
        system: { owner: "owner", workspace: "org" },
      }),
      depth: 0,
      wake_at: 0,
      lease_token: null,
      lease_until: 0,
      attempts: 1,
      error: null,
    };
    let claimReturned = false;
    let requeue: unknown[] | undefined;
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              all: async () => ({ results: [] }),
              first: async () => {
                if (
                  sql.includes(
                    "UPDATE workflow_executions SET status='running'",
                  )
                ) {
                  if (claimReturned) return null;
                  claimReturned = true;
                  return run;
                }
                if (sql.includes("SELECT definition FROM workflow_versions")) {
                  return { definition };
                }
                return null;
              },
              run: async () => {
                if (sql.includes("UPDATE workflow_executions SET status=?")) {
                  requeue = values;
                }
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const policy: NativeExecutionPolicy = {
      paused: () => false,
      admit: async () => ({
        allowed: false,
        reason: "Workflow executions are paused",
      }),
      consumeStep: async () => {
        throw new Error("must not consume a step while paused");
      },
      release: async () => {},
    };

    await processWorkflows(db, async () => true, { executionPolicy: policy });

    expect(requeue?.[0]).toBe("queued");
    expect(requeue?.[3]).toBe(0);
    expect(requeue).toContain("org");
    expect(requeue).toContain("execution");
  });

  it("rejects cloud unmetered execution even when local-only is set", async () => {
    const policy = nativeExecutionPolicyFromEnvironment({
      CLOUDFLARE_ENV: "preview",
      SAVIA_FLOWS_LOCAL_ONLY: "true",
      SAVIA_FLOWS_EXECUTION_ENABLED: "true",
      SAVIA_FLOWS_QUOTAS_ENABLED: "false",
    });
    expect(policy?.paused()).toBe(true);
    await expect(
      policy?.admit({
        executionId: "run",
        organizationId: "org",
        workflowId: "flow",
        nodeCount: 1,
      }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("preserves explicit local unmetered execution", async () => {
    const policy = nativeExecutionPolicyFromEnvironment({
      CLOUDFLARE_ENV: "development",
      SAVIA_FLOWS_EXECUTION_ENABLED: "true",
      SAVIA_FLOWS_QUOTAS_ENABLED: "false",
    });
    expect(policy?.paused()).toBe(false);
    await expect(
      policy?.admit({
        executionId: "run",
        organizationId: "org",
        workflowId: "flow",
        nodeCount: 1,
      }),
    ).resolves.toEqual({ allowed: true });
  });

  it("allows cloud execution only with bounded quota enforcement", async () => {
    const policy = nativeExecutionPolicyFromEnvironment({
      CLOUDFLARE_ENV: "preview",
      SAVIA_FLOWS_EXECUTION_ENABLED: "true",
      SAVIA_FLOWS_QUOTAS_ENABLED: "true",
      ...bounds,
      SAVIA_FLOWS: {
        fetch: async () => new Response(JSON.stringify({ allowed: true })),
      },
      SAVIA_FLOWS_BRIDGE_SECRET: "local-test-secret",
    });
    expect(policy?.paused()).toBe(false);
    await expect(
      policy?.admit({
        executionId: "run",
        organizationId: "org",
        workflowId: "flow",
        nodeCount: 1,
      }),
    ).resolves.toEqual({ allowed: true });
  });
});
