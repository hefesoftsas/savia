export type GlobalRole = "platform_admin";
export type AgencyRole = string;

export type IdentityPrincipal = {
  id: string;
  issuer: string;
  subject: string;
  email: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgencyMembership = {
  id: string;
  principalId: string;
  /** Compatibility alias for tenantId. */
  agencyId: number;
  tenantId?: number;
  role: AgencyRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  tenantName?: string;
  tenantSlug?: string;
};

export type TenantMembership = AgencyMembership & { tenantId: number };
export type TenantRole = AgencyRole;

export type AppActor = {
  principal: IdentityPrincipal;
  globalRoles: GlobalRole[];
  memberships: AgencyMembership[];
};

export type ExternalIdentity = {
  issuer: string;
  subject: string;
  email: string;
  displayName: string;
};

export class AuthenticationError extends Error {
  constructor(
    public readonly code:
      | "AUTHENTICATION_REQUIRED"
      | "AUTHENTICATION_UNAVAILABLE"
      | "INSUFFICIENT_SCOPE"
      | "MFA_ENROLLMENT_REQUIRED"
      | "AUTHORIZATION_FORBIDDEN",
    message: string,
  ) {
    super(message);
  }
}

export type Authenticator = {
  authenticate(request: Request, d1: D1Database): Promise<AppActor>;
};
