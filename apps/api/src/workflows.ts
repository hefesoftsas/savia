import { processWorkflows } from "@savia/crm-server/workflows/runtime";
import { findPrincipal, loadActor } from "./auth/identity-repository";
import { canManageSharedCrm } from "./crm/hubspot-access";
export async function runScheduledWorkflows(db: D1Database) {
  return processWorkflows(db, async ({ workspace, principalId }) => {
    const principal = await findPrincipal(db, principalId);
    if (!principal?.isActive) return false;
    return canManageSharedCrm(await loadActor(db, principal), workspace);
  });
}
