import type {
  CreateParams,
  DataProvider,
  DeleteParams,
  GetListParams,
  GetManyParams,
  GetOneParams,
  Identifier,
  UpdateParams,
} from "ra-core";
import {
  IdentityClient,
  type AgencyAccessRole,
  type ManagedIdentityUser,
} from "./identity-client";

export type UserMembership = {
  id: string;
  tenantId: number;
  agencyId: number;
  role: AgencyAccessRole;
  isActive: boolean;
};

export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  platformAdmin: boolean;
  isActive: boolean;
  isBanned: boolean;
  twoFactorEnabled: boolean;
  memberships: UserMembership[];
};

export type UserFormData = {
  firstName?: string;
  lastName?: string;
  email?: string;
  temporaryPassword?: string;
  platformAdmin?: boolean;
  tenantId?: number | string;
  agencyId?: number | string;
  agencyRole?: AgencyAccessRole;
};

export type IdentityUserDataProvider = DataProvider & {
  grantMembership(
    principalId: string,
    input: { tenantId?: number; agencyId?: number; role: AgencyAccessRole },
  ): Promise<UserRecord>;
  removeMembership(principalId: string, agencyId: number): Promise<void>;
  suspend(principalId: string): Promise<void>;
  reactivate(principalId: string): Promise<void>;
  revokeSessions(principalId: string): Promise<void>;
  sendPasswordReset(principalId: string): Promise<void>;
};

function splitName(displayName: string): [string, string] {
  const [firstName = "", ...lastName] = displayName.trim().split(/\s+/);
  return [firstName, lastName.join(" ")];
}

export function toUserRecord(user: ManagedIdentityUser): UserRecord {
  const [firstName, lastName] = splitName(user.attributes.displayName);
  return {
    id: user.id,
    email: user.attributes.email,
    displayName: user.attributes.displayName,
    firstName,
    lastName,
    platformAdmin: user.attributes.globalRoles.includes("platform_admin"),
    isActive: user.attributes.isActive,
    isBanned: user.attributes.account.isBanned,
    twoFactorEnabled: user.attributes.account.twoFactorEnabled,
    memberships: user.relationships.memberships.map((membership) => ({
      id: membership.id,
      tenantId: Number(membership.relationships.tenant?.id ?? membership.relationships.agency.id),
      agencyId: Number(membership.relationships.agency.id),
      role: membership.role,
      isActive: membership.attributes.isActive,
    })),
  };
}

function matchesFilter(record: UserRecord, params: GetListParams): boolean {
  const filter = params.filter ?? {};
  const selectedTenantId = Number(filter.tenantId);
  if (
    filter.tenantId !== undefined &&
    (!Number.isSafeInteger(selectedTenantId) ||
      selectedTenantId < 0 ||
      !record.memberships.some(
        (membership) => membership.tenantId === selectedTenantId,
      ))
  ) {
    return false;
  }
  const search =
    typeof filter.q === "string" ? filter.q.trim().toLocaleLowerCase() : "";
  if (
    search &&
    ![record.displayName, record.email].some((entry) =>
      entry.toLocaleLowerCase().includes(search),
    )
  ) {
    return false;
  }
  if (
    typeof filter.isActive === "boolean" &&
    record.isActive !== filter.isActive
  ) {
    return false;
  }
  if (filter.scope === "platform" && !record.platformAdmin) return false;
  if ((filter.scope === "tenant" || filter.scope === "agency") && record.memberships.length === 0)
    return false;
  return true;
}

function compare(
  left: UserRecord,
  right: UserRecord,
  field: string,
  order: "ASC" | "DESC",
): number {
  const direction = order === "ASC" ? 1 : -1;
  const leftValue = String(left[field as keyof UserRecord] ?? "");
  const rightValue = String(right[field as keyof UserRecord] ?? "");
  return direction * leftValue.localeCompare(rightValue, "es");
}

function membershipFrom(data: UserFormData) {
  const agencyId = Number(data.tenantId ?? data.agencyId);
  if (!Number.isSafeInteger(agencyId) || agencyId < 1 || !data.agencyRole) {
    return undefined;
  }
  return { tenantId: agencyId, role: data.agencyRole };
}

export function createIdentityUserDataProvider(
  client: IdentityClient,
): IdentityUserDataProvider {
  const provider = {
    async getList(_resource: string, params: GetListParams) {
      const allRecords = (await client.list()).map(toUserRecord);
      const filtered = allRecords
        .filter((record) => matchesFilter(record, params))
        .sort((left, right) =>
          compare(
            left,
            right,
            params.sort?.field ?? "displayName",
            params.sort?.order ?? "ASC",
          ),
        );
      const page = params.pagination?.page ?? 1;
      const perPage = params.pagination?.perPage ?? 20;
      const start = (page - 1) * perPage;
      return {
        data: filtered.slice(start, start + perPage),
        total: filtered.length,
      };
    },

    async getOne(_resource: string, params: GetOneParams) {
      return { data: toUserRecord(await client.get(String(params.id))) };
    },

    async getMany(_resource: string, params: GetManyParams) {
      return {
        data: await Promise.all(
          params.ids.map(async (id: Identifier) =>
            toUserRecord(await client.get(String(id))),
          ),
        ),
      };
    },

    async create(_resource: string, params: CreateParams) {
      const data = params.data as UserFormData;
      const user = await client.provision({
        email: data.email ?? "",
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
        platformAdmin: Boolean(data.platformAdmin),
        ...(data.temporaryPassword
          ? { temporaryPassword: data.temporaryPassword }
          : {}),
        membership: membershipFrom(data),
      });
      return { data: toUserRecord(user) };
    },

    async update(_resource: string, params: UpdateParams) {
      const data = params.data as UserFormData;
      const user = await client.update(String(params.id), {
        firstName: data.firstName,
        lastName: data.lastName,
        platformAdmin: data.platformAdmin,
        membership: membershipFrom(data),
      });
      return { data: toUserRecord(user) };
    },

    async delete(_resource: string, params: DeleteParams) {
      await client.remove(String(params.id));
      // React Admin may call delete without previousData (e.g. from
      // Show/Edit actions where the record comes from a different context).
      // Always return a record with an id so the mutation cache stays
      // consistent instead of resolving with `data: undefined`.
      return {
        data: (params.previousData ?? { id: params.id }) as UserRecord,
      };
    },

    async grantMembership(
      principalId: string,
      input: { tenantId?: number; agencyId?: number; role: AgencyAccessRole },
    ) {
      return toUserRecord(await client.grantMembership(principalId, input));
    },

    removeMembership: (principalId: string, agencyId: number) =>
      client.removeMembership(principalId, agencyId),
    suspend: (principalId: string) => client.suspend(principalId),
    reactivate: (principalId: string) => client.reactivate(principalId),
    revokeSessions: (principalId: string) => client.revokeSessions(principalId),
    sendPasswordReset: (principalId: string) =>
      client.sendPasswordReset(principalId),
  };

  return provider as IdentityUserDataProvider;
}
