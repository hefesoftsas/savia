import type { Authenticator } from "../src/auth/types";

export function platformAdministratorAuthenticator(): Authenticator {
  return {
    async authenticate() {
      return {
        principal: {
          id: "test-platform-admin",
          issuer: "savia:better-auth",
          subject: "test-platform-admin",
          email: "admin@savia.test",
          displayName: "Savia Test Administrator",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        globalRoles: ["platform_admin"],
        memberships: [],
      };
    },
  };
}

export function agencyMemberAuthenticator(): Authenticator {
  return {
    async authenticate() {
      return {
        principal: {
          id: "test-agency-member",
          issuer: "savia:better-auth",
          subject: "test-agency-member",
          email: "member@savia.test",
          displayName: "Savia Test Member",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        globalRoles: [],
        memberships: [
          {
            id: "test-membership",
            principalId: "test-agency-member",
            agencyId: 101,
            role: "viewer",
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
    },
  };
}

export function agencyAdministratorAuthenticator(): Authenticator {
  return {
    async authenticate() {
      return {
        principal: {
          id: "test-agency-administrator",
          issuer: "savia:better-auth",
          subject: "test-agency-administrator",
          email: "administrator@savia.test",
          displayName: "Savia Test Agency Administrator",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        globalRoles: [],
        memberships: [
          {
            id: "test-agency-administrator-membership",
            principalId: "test-agency-administrator",
            agencyId: 101,
            role: "agency_admin",
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
    },
  };
}

export function agencyOperatorAuthenticator(): Authenticator {
  return {
    async authenticate() {
      return {
        principal: {
          id: "test-agency-operator",
          issuer: "savia:better-auth",
          subject: "test-agency-operator",
          email: "operator@savia.test",
          displayName: "Savia Test Agency Operator",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        globalRoles: [],
        memberships: [
          {
            id: "test-agency-operator-membership",
            principalId: "test-agency-operator",
            agencyId: 101,
            role: "operator",
            isActive: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
    },
  };
}
