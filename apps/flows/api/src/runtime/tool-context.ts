import type {
  CredentialService,
  NodeContext,
  ObjectStore,
} from "@savia/flows-runtime";

import type { Bindings } from "../context";
import { createCodeModeExecutor } from "./code-mode-executor";
import { createSandboxExecutor } from "./sandbox-executor";

/** Optional services that tool-executed nodes may need */
interface ToolContextServices {
  databaseService?: NodeContext["databaseService"];
  datasetService?: NodeContext["datasetService"];
  durableObjectRegistry?: NodeContext["durableObjectRegistry"];
  queueService?: NodeContext["queueService"];
  schemaService?: NodeContext["schemaService"];
  codeModeExecutor?: NodeContext["codeModeExecutor"];
  sandboxExecutor?: NodeContext["sandboxExecutor"];
}

/**
 * Creates a NodeContext for tool execution.
 * Reads organizationId from the credential service (must be initialized).
 */
export function createToolContext(
  nodeId: string,
  inputs: Record<string, unknown>,
  env: Bindings,
  objectStore: ObjectStore,
  credentialService: CredentialService,
  services?: ToolContextServices
): NodeContext {
  return {
    nodeId,
    workflowId: `tool_execution_${Date.now()}`,
    organizationId: credentialService.getOrganizationId(),
    userId: "",
    inputs,
    objectStore,
    getSecret: (secretName: string) => credentialService.getSecret(secretName),
    getIntegration: (integrationId: string) =>
      credentialService.getIntegration(integrationId),
    databaseService: services?.databaseService,
    datasetService: services?.datasetService,
    durableObjectRegistry: services?.durableObjectRegistry,
    queueService: services?.queueService,
    schemaService: services?.schemaService,
    codeModeExecutor:
      services?.codeModeExecutor ?? createCodeModeExecutor(env) ?? undefined,
    sandboxExecutor:
      services?.sandboxExecutor ??
      createSandboxExecutor(env, `tool-${crypto.randomUUID()}`) ??
      undefined,
    env,
  };
}
