import type { ApiClient } from "./api-client";
import type { paths } from "./generated/openapi";

type CurrentIdentityResponse =
  paths["/v1/identity/me"]["get"]["responses"][200]["content"]["application/json"];
type IdentityUsersResponse =
  paths["/v1/identity/users"]["get"]["responses"][200]["content"]["application/json"];
type IdentityUser = IdentityUsersResponse["data"][number];

export type AgencyAccessRole = "tenant_admin" | "agency_admin" | "operator" | "viewer";
export type SaviaIdentity = CurrentIdentityResponse["data"];
export type ManagedIdentityUser = Omit<IdentityUser, "relationships"> & {
  relationships: { memberships: Array<Omit<IdentityUser["relationships"]["memberships"][number], "role"> & {
    role: AgencyAccessRole;
    relationships: { agency: { id: string }; tenant?: { id: string } };
  }> };
};
export type UserProvisionInput = Omit<
  paths["/v1/identity/users"]["post"]["requestBody"]["content"]["application/json"], "membership"
> & { membership?: { tenantId?: number; agencyId?: number; role: AgencyAccessRole } };
export type UserUpdateInput =
  paths["/v1/identity/users/{principalId}"]["patch"]["requestBody"]["content"]["application/json"];

export class IdentityClient {
  private listPromise: Promise<ManagedIdentityUser[]> | null = null;
  private listCache: { data: ManagedIdentityUser[]; timestamp: number } | null =
    null;
  private mePromise: Promise<CurrentIdentityResponse["data"]> | null = null;
  private meCache: {
    data: CurrentIdentityResponse["data"];
    timestamp: number;
  } | null = null;

  constructor(private readonly client: ApiClient) {}

  invalidateList(): void {
    this.listCache = null;
    this.listPromise = null;
  }

  invalidateMe(): void {
    this.meCache = null;
    this.mePromise = null;
  }

  async me(): Promise<CurrentIdentityResponse["data"]> {
    // El HAR muestra /v1/identity/me x2 en el mismo ms (doble montaje en
    // StrictMode): comparte el vuelo y cachea 30s como en list().
    if (this.meCache && Date.now() - this.meCache.timestamp < 30_000) {
      return this.meCache.data;
    }
    if (this.mePromise) {
      return this.mePromise;
    }
    this.mePromise = this.client
      .get<CurrentIdentityResponse>("/v1/identity/me")
      .then((res) => {
        this.meCache = { data: res.data, timestamp: Date.now() };
        this.mePromise = null;
        return res.data;
      })
      .catch((err) => {
        this.mePromise = null;
        throw err;
      });
    return this.mePromise;
  }

  async list(): Promise<ManagedIdentityUser[]> {
    if (this.listCache && Date.now() - this.listCache.timestamp < 30_000) {
      return this.listCache.data;
    }
    if (this.listPromise) {
      return this.listPromise;
    }
    this.listPromise = this.client
      .get<IdentityUsersResponse>("/v1/identity/users")
      .then((res) => {
        this.listCache = { data: res.data, timestamp: Date.now() };
        this.listPromise = null;
        return res.data;
      })
      .catch((err) => {
        this.listPromise = null;
        throw err;
      });
    return this.listPromise;
  }

  async get(principalId: string): Promise<ManagedIdentityUser> {
    return (
      await this.client.get<{ data: ManagedIdentityUser }>(
        `/v1/identity/users/${encodeURIComponent(principalId)}`,
      )
    ).data;
  }

  async provision(input: UserProvisionInput): Promise<ManagedIdentityUser> {
    this.invalidateList();
    return (
      await this.client.post<{ data: ManagedIdentityUser }>(
        "/v1/identity/users",
        input,
      )
    ).data;
  }

  async update(
    principalId: string,
    input: UserUpdateInput,
  ): Promise<ManagedIdentityUser> {
    this.invalidateList();
    return (
      await this.client.patch<{ data: ManagedIdentityUser }>(
        `/v1/identity/users/${encodeURIComponent(principalId)}`,
        input,
      )
    ).data;
  }

  async grantMembership(
    principalId: string,
    input: { tenantId?: number; agencyId?: number; role: AgencyAccessRole },
  ): Promise<ManagedIdentityUser> {
    this.invalidateList();
    return (
      await this.client.post<{ data: ManagedIdentityUser }>(
        `/v1/identity/users/${encodeURIComponent(principalId)}/memberships`,
        input,
      )
    ).data;
  }

  removeMembership(principalId: string, agencyId: number): Promise<void> {
    this.invalidateList();
    return this.client.delete(
      `/v1/identity/users/${encodeURIComponent(principalId)}/memberships/${agencyId}`,
    );
  }

  suspend(principalId: string): Promise<void> {
    this.invalidateList();
    return this.client.post(
      `/v1/identity/users/${encodeURIComponent(principalId)}/suspension`,
    );
  }

  reactivate(principalId: string): Promise<void> {
    this.invalidateList();
    return this.client.delete(
      `/v1/identity/users/${encodeURIComponent(principalId)}/suspension`,
    );
  }

  revokeSessions(principalId: string): Promise<void> {
    return this.client.post(
      `/v1/identity/users/${encodeURIComponent(principalId)}/sessions/revoke`,
    );
  }

  sendPasswordReset(principalId: string): Promise<void> {
    return this.client.post(
      `/v1/identity/users/${encodeURIComponent(principalId)}/password-reset`,
    );
  }

  remove(principalId: string): Promise<void> {
    this.invalidateList();
    return this.client.delete(
      `/v1/identity/users/${encodeURIComponent(principalId)}`,
    );
  }
}
