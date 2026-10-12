/**
 * Worker Runtime
 *
 * Runtime implementation for Cloudflare Workers (without Workflows).
 * Executes workflows synchronously in a single request without durability.
 *
 * ## Architecture
 *
 * Extends Runtime with direct execution (no durable steps).
 * Factory methods for wiring app-specific dependencies live in the consumer app.
 *
 * ## Usage
 *
 * Use for workflows that:
 * - Complete in under 30 seconds (CPU time limit)
 * - Don't require durable execution or retries
 * - Need lower latency than Workflows
 *
 * @see {@link Runtime} - Base runtime class
 */

import type { WorkflowExecution } from "@savia/flows-types";

import { Runtime, type RuntimeParams } from "./base-runtime";

/**
 * Worker-based runtime with direct execution (no durable steps).
 * Executes workflows synchronously in a single Worker request.
 */
export class WorkerRuntime<Env = unknown> extends Runtime<Env> {
  /**
   * Worker runtime does not support async node execution.
   * Agent nodes detect asyncSupported: false and fall back to blocking mode.
   */
  protected async waitForNodeEvent<T>(): Promise<T> {
    throw new Error("Async node execution is not supported in WorkerRuntime");
  }

  protected async executeSleep(
    _name: string,
    durationMs: number
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  protected async executeSubStep<T>(
    _name: string,
    fn: () => Promise<T>,
    executionId?: string,
  ): Promise<T> {
    await this.consumePolicyStep(executionId);
    return await fn();
  }

  /**
   * Implements step execution by directly calling the function.
   * No durability or retries - execution is synchronous and ephemeral.
   */
  protected async executeStep<T>(
    _name: string,
    fn: () => Promise<T>,
    executionId?: string,
  ): Promise<T> {
    // Direct execution without durability
    await this.consumePolicyStep(executionId);
    return await fn();
  }

  /**
   * Executes a workflow and returns the result.
   * This is the main entry point for Worker-based execution.
   *
   * @param params - Workflow execution parameters
   * @param instanceId - Optional execution ID (generates one if not provided)
   * @returns The workflow execution result
   */
  async execute(
    params: RuntimeParams,
    instanceId?: string
  ): Promise<WorkflowExecution> {
    const executionId = instanceId ?? crypto.randomUUID();
    const policy = this.deps.executionPolicy;
    if (!policy) return await this.run(params, executionId);

    let reserved = false;
    try {
      const admission = await policy.admit({
        executionId,
        organizationId: params.organizationId,
        workflowId: params.workflow.id,
        nodeCount: params.workflow.nodes.length,
      });
      if (!admission.allowed || admission.alreadyActive) {
        return {
          id: executionId,
          workflowId: params.workflow.id,
          status: "error",
          nodeExecutions: [],
          startedAt: new Date(),
          endedAt: new Date(),
          error:
            admission.reason ?? "Workflow execution is already active",
        } as WorkflowExecution;
      }
      reserved = true;
      return await this.run(params, executionId, true);
    } catch (error) {
      if (reserved) {
        try {
          await policy.release(executionId, true);
        } catch {
          // Keep the original execution failure as the returned result.
        }
      }
      return {
        id: executionId,
        workflowId: params.workflow.id,
        status: "error",
        nodeExecutions: [],
        startedAt: new Date(),
        endedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      } as WorkflowExecution;
    }
  }
}
