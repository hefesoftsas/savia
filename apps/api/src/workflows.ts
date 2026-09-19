import { processWorkflows } from "@savia/crm-server/workflows/runtime";
import { findPrincipal, loadActor } from "./auth/identity-repository";
import { canManageSharedCrm } from "./crm/hubspot-access";
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
) {
  return processWorkflows(db, workflowAuthorizer(db), {
    webhooks: { encryptionKey, fetcher },
  });
}
