/**
 * Agent SDK utilities
 *
 * Typed wrapper for `getAgentByName` from the agents SDK.
 * The runtime export exists but its type declaration is not visible to
 * TypeScript due to bundled d.ts transitive dependency resolution issues.
 */

import * as agents from "agents";
import type { Bindings } from "../context";

/**
 * Get an Agent stub by name with proper partyserver initialization.
 *
 * This is the SDK's `getAgentByName` which internally sends a dummy fetch
 * with the x-partykit-room header to initialize the DO name before returning
 * the stub. This ensures `this.name` is available for subsequent RPC calls.
 */
export const getAgentByName = (agents as unknown as Record<string, unknown>)
  .getAgentByName as <T extends Rpc.DurableObjectBranded | undefined>(
  namespace: DurableObjectNamespace<T>,
  name: string
) => Promise<DurableObjectStub<T>>;

/** Register the logical name before creating/initializing a WorkflowAgent. */
export async function getWorkflowAgentByName(
  env: Pick<Bindings, "DB" | "WORKFLOW_AGENT">,
  name: string,
) {
  await env.DB.prepare(
    "INSERT INTO durable_object_registry(kind,name) VALUES('workflow-agent',?) ON CONFLICT(kind,name) DO NOTHING",
  ).bind(name).run();
  return getAgentByName(env.WORKFLOW_AGENT, name);
}
