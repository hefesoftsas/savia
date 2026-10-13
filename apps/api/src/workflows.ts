import {
  processWorkflows,
  type NativeExecutionPolicy,
} from "@savia/flows-native/runtime";
import { findPrincipal, loadActor } from "./auth/identity-repository";
import { canManageSharedCrm } from "./external-crm/hubspot-access";
import type { RealtimeHubClient } from "./realtime/hub-client";
import { publishRealtime } from "./realtime/hub-client";
import { tenantRoom } from "./realtime/protocol";
import type { SaviaFlowsService } from "./routes/savia-flows";

const EXECUTION_POLICY_URL =
  "https://savia-flows.internal/internal/savia/execution-policy";

export function nativeExecutionPolicyFromEnvironment(environment: {
  SAVIA_FLOWS?: SaviaFlowsService;
  SAVIA_FLOWS_BRIDGE_SECRET?: string;
  CLOUDFLARE_ENV?: string;
  SAVIA_FLOWS_LOCAL_ONLY?: string;
  SAVIA_FLOWS_EXECUTION_ENABLED?: string;
  SAVIA_FLOWS_QUOTAS_ENABLED?: string;
  SAVIA_FLOWS_MAX_DAILY_RUNS?: string;
  SAVIA_FLOWS_MAX_MONTHLY_RUNS?: string;
  SAVIA_FLOWS_MAX_CONCURRENT_RUNS?: string;
  SAVIA_FLOWS_MAX_NODES_PER_RUN?: string;
  SAVIA_FLOWS_MAX_STEPS_PER_RUN?: string;
}): NativeExecutionPolicy | undefined {
  const local =
    environment.CLOUDFLARE_ENV === "development" ||
    (environment.CLOUDFLARE_ENV === undefined &&
      environment.SAVIA_FLOWS_LOCAL_ONLY === "true");
  const executionFlag = environment.SAVIA_FLOWS_EXECUTION_ENABLED;
  const quotaFlag = environment.SAVIA_FLOWS_QUOTAS_ENABLED;
  const noFlags = executionFlag === undefined && quotaFlag === undefined;
  if (local && noFlags) return undefined;

  const flagsValid =
    (executionFlag === "true" || executionFlag === "false") &&
    (quotaFlag === "true" || quotaFlag === "false");
  const executionsEnabled = executionFlag === "true";
  const quotasEnabled = quotaFlag === "true";
  const limits = [
    environment.SAVIA_FLOWS_MAX_DAILY_RUNS,
    environment.SAVIA_FLOWS_MAX_MONTHLY_RUNS,
    environment.SAVIA_FLOWS_MAX_CONCURRENT_RUNS,
    environment.SAVIA_FLOWS_MAX_NODES_PER_RUN,
    environment.SAVIA_FLOWS_MAX_STEPS_PER_RUN,
  ];
  const limitsValid = limits.every(
    (value) =>
      value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)),
  );
  const bridgeAvailable =
    Boolean(environment.SAVIA_FLOWS) &&
    Boolean(environment.SAVIA_FLOWS_BRIDGE_SECRET?.trim());
  const configurationValid =
    flagsValid &&
    (!executionsEnabled ||
      (local && !quotasEnabled) ||
      (quotasEnabled && limitsValid));
  const paused =
    !configurationValid ||
    !executionsEnabled ||
    (quotasEnabled && !bridgeAvailable);

  const request = async (body: Record<string, unknown>) => {
    const secret = environment.SAVIA_FLOWS_BRIDGE_SECRET?.trim();
    if (!environment.SAVIA_FLOWS || !secret) {
      throw new Error("Savia Flows execution policy bridge is unavailable");
    }
    const response = await environment.SAVIA_FLOWS.fetch(
      new Request(EXECUTION_POLICY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-savia-bridge-key": secret,
        },
        body: JSON.stringify(body),
      }),
    );
    const result: unknown = await response.json().catch(() => null);
    if (!result || typeof result !== "object") {
      throw new Error(
        `Execution policy returned an invalid response (${response.status})`,
      );
    }
    return { response, result: result as Record<string, unknown> };
  };

  return {
    paused: () => paused,
    async admit(input) {
      if (paused) {
        return {
          allowed: false,
          reason: configurationValid
            ? "Workflow executions are paused or policy bridge is unavailable"
            : "Execution policy configuration is invalid",
        };
      }
      if (!quotasEnabled) return { allowed: true };
      const { response, result } = await request({ action: "admit", ...input });
      if (typeof result.allowed !== "boolean") {
        throw new Error("Execution policy admission response is malformed");
      }
      if (!response.ok && result.allowed) {
        throw new Error(
          `Execution policy admission failed (${response.status})`,
        );
      }
      return {
        allowed: result.allowed,
        ...(typeof result.reason === "string" ? { reason: result.reason } : {}),
      };
    },
    async consumeStep(executionId) {
      if (paused) throw new Error("Workflow executions are paused");
      if (!quotasEnabled) return;
      const { response, result } = await request({
        action: "step",
        executionId,
      });
      if (!response.ok || result.allowed !== true) {
        throw Object.assign(
          new Error(
            typeof result.error === "string"
              ? result.error
              : `Execution policy step was rejected (${response.status})`,
          ),
          { status: response.status },
        );
      }
    },
    async release(executionId, terminal) {
      if (!quotasEnabled) return;
      const { response } = await request({
        action: "release",
        executionId,
        terminal,
      });
      if (!response.ok) {
        throw new Error(`Execution policy release failed (${response.status})`);
      }
    },
  };
}
export const workflowAuthorizer =
  (db: D1Database) =>
  async ({
    workspace,
    principalId,
  }: {
    workspace: string;
    principalId: string;
  }) => {
    const principal = await findPrincipal(db, principalId);
    if (!principal?.isActive) return false;
    return canManageSharedCrm(await loadActor(db, principal), workspace);
  };
export async function runScheduledWorkflows(
  db: D1Database,
  encryptionKey?: string,
  fetcher?: typeof fetch,
  realtime?: RealtimeHubClient,
  executionPolicy?: NativeExecutionPolicy,
) {
  return processWorkflows(db, workflowAuthorizer(db), {
    webhooks: { encryptionKey, fetcher },
    ...(executionPolicy ? { executionPolicy } : {}),
    onExecutionTransition(workspace, executionId) {
      const match = /^tenant:(0|[1-9]\d*)$/.exec(workspace);
      if (!match) return;
      publishRealtime(realtime, tenantRoom(Number(match[1])), {
        topic: "workflows",
        type: "updated",
        collection: "executions",
        id: executionId,
      });
    },
  });
}
