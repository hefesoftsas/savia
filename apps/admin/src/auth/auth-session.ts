import type { UserIdentity } from "ra-core";

export type AgencyMembershipPermission = {
  agencyId: number;
  tenantId?: number;
  role: string;
};

export type AuthPermissions = {
  canReadDocuments: boolean;
  canExecuteCommands: boolean;
  canManageIdentity: boolean;
  memberships: AgencyMembershipPermission[];
};

export type CallbackResult = {
  returnOrigin?: string;
};

export interface AuthSession {
  login(): Promise<void>;
  logout(): Promise<string>;
  getAuthorizeUrl(): string;
  handleCallback(): Promise<CallbackResult | void>;
  getAccessToken(): Promise<string | null>;
  getIdentity(): Promise<UserIdentity>;
  getPermissions(): Promise<AuthPermissions>;
  checkSession(): Promise<void>;
  clearSession(): Promise<void>;
}
