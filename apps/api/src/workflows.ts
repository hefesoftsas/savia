import { processWorkflows } from "@savia/studio-server/workflows/runtime";
import { findPrincipal, loadActor } from "./auth/identity-repository";
import { canManageSharedCrm } from "./external-crm/hubspot-access";
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
export async function runScheduledWorkflows(
  db: D1Database,
  encryptionKey?: string,
  fetcher?: typeof fetch,
  realtime?: RealtimeHubClient,
) {
  return processWorkflows(db, workflowAuthorizer(db), {
    webhooks: { encryptionKey, fetcher },
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
