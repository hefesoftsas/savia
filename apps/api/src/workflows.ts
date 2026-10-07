import {
  processWorkflows,
  type EmailDependencies,
} from "@savia/studio-server/workflows/runtime";
import type { WorkflowAction } from "@savia/studio-server/workflows/routes";
import { findPrincipal, loadActor } from "./auth/identity-repository";
import { canAccessSharedCrm, canManageSharedCrm } from "./external-crm/hubspot-access";
import type { RealtimeHubClient } from "./realtime/hub-client";
import { publishRealtime } from "./realtime/hub-client";
import { tenantRoom } from "./realtime/protocol";
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
/**
 * Delegated workflow policy: every active workspace member may view history,
 * start manual runs and resolve their own inbox items (the repository still
 * enforces assignee ownership). Draft design and publication stay with
 * workspace administrators; the runtime keeps checking the pinned owner.
 */
export const workflowMemberActions: WorkflowAction[] = [
  "view",
  "history",
  "execute",
  "resolve",
];
export async function authorizeWorkflowAction(
  db: D1Database,
  principalId: string,
  workspace: string,
  action: WorkflowAction,
): Promise<boolean> {
  const principal = await findPrincipal(db, principalId);
  if (!principal?.isActive) return false;
  const actor = await loadActor(db, principal);
  if (canManageSharedCrm(actor, workspace)) return true;
  if (!workflowMemberActions.includes(action)) return false;
  return canAccessSharedCrm(actor, workspace);
}
export async function runScheduledWorkflows(
  db: D1Database,
  encryptionKey?: string,
  fetcher?: typeof fetch,
  realtime?: RealtimeHubClient,
  email?: EmailDependencies,
) {
  return processWorkflows(db, workflowAuthorizer(db), {
    webhooks: { encryptionKey, fetcher },
    email,
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
