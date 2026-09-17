import type { AppActor } from "./types";

export type Capability =
  "documents:read" | "commands:execute" | "identity:manage";

export type AgencyCapability =
  | "agency:update"
  | "crm:manage"
  | "providers:manage"
  | "customers:create"
  | "customers:update"
  | "customers:delete";

const agencyRoleCapabilities = {
  tenant_admin: [
    "documents:read", "agency:update", "crm:manage", "providers:manage",
    "customers:create", "customers:update", "customers:delete",
  ],
  agency_admin: [
    "documents:read",
    "agency:update",
    "crm:manage",
    "providers:manage",
    "customers:create",
    "customers:update",
    "customers:delete",
  ],
  operator: ["documents:read", "customers:create", "customers:update"],
  viewer: ["documents:read"],
} as const satisfies Record<string, readonly (Capability | AgencyCapability)[]>;

export function isRegisteredAgencyRole(role: string): boolean {
  return Object.hasOwn(agencyRoleCapabilities, role);
}

export function authorizedAgencyIds(actor: AppActor): number[] {
  return [
    ...new Set(
      actor.memberships
        .filter(
          (membership) =>
            membership.isActive && isRegisteredAgencyRole(membership.role),
        )
        .map((membership) => membership.tenantId ?? membership.agencyId),
    ),
  ].sort((left, right) => left - right);
}

export function canReadGlobal(actor: AppActor): boolean {
  return (
    actor.globalRoles.includes("platform_admin") ||
    authorizedAgencyIds(actor).length > 0
  );
}

export function canExecuteCommand(actor: AppActor): boolean {
  return actor.globalRoles.includes("platform_admin");
}

export function canManageIdentity(actor: AppActor): boolean {
  return actor.globalRoles.includes("platform_admin");
}

export function hasAgencyCapability(
  actor: AppActor,
  agencyId: number,
  capability: AgencyCapability,
): boolean {
  return actor.memberships.some(
    (membership) =>
      (membership.tenantId ?? membership.agencyId) === agencyId &&
      membership.isActive &&
      isRegisteredAgencyRole(membership.role) &&
      agencyRoleCapabilities[
        membership.role as keyof typeof agencyRoleCapabilities
      ].includes(capability as never),
  );
}
