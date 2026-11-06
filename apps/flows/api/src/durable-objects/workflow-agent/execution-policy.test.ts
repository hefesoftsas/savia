import { runInDurableObject } from "cloudflare:test";
import type { RuntimeParams } from "@savia/flows-runtime";
import { beforeAll, describe, expect, it } from "vitest";

import type { Bindings } from "../../context";
import { createExecutionPolicy } from "../../services/execution-policy";
import { getAgentByName } from "../agent-utils";
import { applyMigrations, testEnv } from "./test-helpers";
import type { WorkflowAgent } from "./workflow-agent";

const NAMESPACE = testEnv.WORKFLOW_AGENT;

beforeAll(async () => {
  await applyMigrations();
});

function configureAgent(instance: WorkflowAgent, values: Partial<Bindings>) {
  const agent = instance as unknown as {
    env: Bindings;
    runWorkflow: (...args: unknown[]) => Promise<string>;
    terminateWorkflow: (...args: unknown[]) => Promise<void>;
  };
  Object.assign(agent.env, values);
  return agent;
}

function params(nodeCount = 1) {
  return {
    organizationId: "quota-test-org",
    workflow: {
      id: "quota-test-workflow",
      nodes: Array.from({ length: nodeCount }, (_, index) => ({
        id: `n${index}`,
      })),
    },
  } as RuntimeParams;
}

const quotaConfig = {
  SAVIA_FLOWS_POLICY_GENERATION: "10",
  SAVIA_FLOWS_EXECUTION_ENABLED: "true",
  SAVIA_FLOWS_MAINTENANCE: "false",
  SAVIA_FLOWS_QUOTAS_ENABLED: "true",
  SAVIA_FLOWS_MAX_DAILY_RUNS: "10",
  SAVIA_FLOWS_MAX_MONTHLY_RUNS: "20",
  SAVIA_FLOWS_MAX_CONCURRENT_RUNS: "2",
  SAVIA_FLOWS_MAX_NODES_PER_RUN: "1",
  SAVIA_FLOWS_MAX_STEPS_PER_RUN: "10",
};

describe("WorkflowAgent execution policy boundary", () => {
  it("blocks paused and over-node-limit runs before creating a workflow instance", async () => {
    for (const [suffix, values, input] of [
      [
        "paused",
        { ...quotaConfig, SAVIA_FLOWS_EXECUTION_ENABLED: "false" },
        params(),
      ],
      ["nodes", quotaConfig, params(2)],
    ] as const) {
      const id = `quota-boundary-${suffix}-${crypto.randomUUID()}`;
      const stub = await getAgentByName(NAMESPACE, id);
      let creates = 0;
      await runInDurableObject(stub, async (instance: WorkflowAgent) => {
        const agent = configureAgent(instance, values);
        agent.runWorkflow = async () => {
          creates++;
          return id;
        };
        await expect(instance.executeWorkflow(input, id)).rejects.toThrow(
          suffix === "paused" ? /paused/i : /node limit/i,
        );
      });
      expect(creates).toBe(0);
    }
  });

  it("releases an admitted reservation after workflow cancellation succeeds", async () => {
    const id = `quota-cancel-${crypto.randomUUID()}`;
    const stub = await getAgentByName(NAMESPACE, id);
    await runInDurableObject(stub, async (instance: WorkflowAgent) => {
      const agent = configureAgent(instance, quotaConfig);
      await createExecutionPolicy(agent.env).admit({
        executionId: id,
        organizationId: "quota-test-org",
        workflowId: "quota-test-workflow",
        nodeCount: 1,
      });
      agent.terminateWorkflow = async () => {};

      await instance.cancelWorkflow(id);

      const row = await agent.env.DB.prepare(
        "SELECT state, active FROM savia_flows_execution_policy WHERE id = ?",
      )
        .bind(id)
        .first<{ state: string; active: number }>();
      expect(row).toEqual({ state: "completed", active: 0 });
    });
  });

  it("does not create another instance for an active reservation whose instance is pending", async () => {
    const id = `quota-pending-${crypto.randomUUID()}`;
    const stub = await getAgentByName(NAMESPACE, id);
    await runInDurableObject(stub, async (instance: WorkflowAgent) => {
      const agent = configureAgent(instance, quotaConfig);
      agent.env.EXECUTE = {
        get: async () => {
          throw new Error("instance not found");
        },
      } as unknown as Bindings["EXECUTE"];
      await createExecutionPolicy(agent.env).admit({
        executionId: id,
        organizationId: "quota-test-org",
        workflowId: "quota-test-workflow",
        nodeCount: 1,
      });
      let creates = 0;
      agent.runWorkflow = async () => {
        creates++;
        return id;
      };

      await expect(instance.executeWorkflow(params(), id)).rejects.toThrow(
        /already being created/i,
      );
      expect(creates).toBe(0);
    });
  });

  it("acknowledges terminal redelivery only when the Cloudflare instance exists", async () => {
    for (const instanceExists of [true, false]) {
      const id = `quota-terminal-${instanceExists}-${crypto.randomUUID()}`;
      const stub = await getAgentByName(NAMESPACE, id);
      await runInDurableObject(stub, async (instance: WorkflowAgent) => {
        const agent = configureAgent(instance, quotaConfig);
        await createExecutionPolicy(agent.env).admit({
          executionId: id,
          organizationId: "quota-test-org",
          workflowId: "quota-test-workflow",
          nodeCount: 1,
        });
        await createExecutionPolicy(agent.env).release(id, true);
        agent.env.EXECUTE = {
          get: async () => {
            if (!instanceExists) throw new Error("instance not found");
            return {};
          },
        } as unknown as Bindings["EXECUTE"];
        let creates = 0;
        agent.runWorkflow = async () => {
          creates++;
          return id;
        };

        if (instanceExists) {
          await expect(instance.executeWorkflow(params(), id)).resolves.toBe(
            id,
          );
        } else {
          await expect(instance.executeWorkflow(params(), id)).rejects.toThrow(
            /already finished/i,
          );
        }
        expect(creates).toBe(0);
      });
    }
  });
});
