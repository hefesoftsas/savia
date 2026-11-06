import type { AppActor } from "../auth/types";
import { AuthenticationError } from "../auth/types";
import type { AssistantConfigurationRepository } from "./configuration";

/** Resolve employee visibility from the active tenant or an unambiguous membership. */
export async function employeeTenantScope(
  actor: AppActor,
  configuration?: AssistantConfigurationRepository,
): Promise<number | null> {
  const selectedTenantId = await configuration?.activeTenantFor(
    actor.principal.id,
  );
  const isPlatformAdministrator = actor.globalRoles.includes("platform_admin");

  if (selectedTenantId !== undefined) {
    if (
      !isPlatformAdministrator &&
      !actor.memberships.some(
        (membership) =>
          membership.isActive &&
          (membership.tenantId ?? membership.agencyId) === selectedTenantId,
      )
    ) {
      throw new AuthenticationError(
        "AUTHORIZATION_FORBIDDEN",
        "The selected tenant is not in the actor's active memberships",
      );
    }
    return selectedTenantId;
  }

  // Platform administrators explicitly land in the global employee scope when
  // they have not selected a tenant. Global employees are never inherited by a
  // commercial tenant.
  if (isPlatformAdministrator) return null;

  const tenantIds = new Set(
    actor.memberships
      .filter((membership) => membership.isActive)
      .map((membership) => membership.tenantId ?? membership.agencyId),
  );
  if (tenantIds.size === 1) return tenantIds.values().next().value ?? null;

  throw new AuthenticationError(
    "AUTHORIZATION_FORBIDDEN",
    "An unambiguous active tenant is required for employee access",
  );
}
