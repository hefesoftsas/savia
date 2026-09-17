import type { DataProvider } from "ra-core";
import type { ApiClient } from "./api-client";
import { createTenantDataProvider } from "./tenant-data-provider";
import {
  createIdentityUserDataProvider,
  type IdentityUserDataProvider,
} from "./identity-user-data-provider";
import { IdentityClient } from "./identity-client";
import {
  resourceLocator,
  toSaviaRecord,
  type PublicDocument,
  type PublicDocumentPage,
  type SaviaRecord,
} from "./domain-types";

function collectionPath(resource: string): string {
  const { domain, collection } = resourceLocator(resource);
  return `/v1/${encodeURIComponent(domain)}/${encodeURIComponent(collection)}`;
}

function unsupported(operation: string): never {
  throw new Error(
    `${operation} is not available. Savia publishes business commands instead of generic CRUD mutations.`,
  );
}

export function createSaviaDataProvider(
  client: ApiClient,
): DataProvider &
  Pick<
    IdentityUserDataProvider,
    | "grantMembership"
    | "removeMembership"
    | "suspend"
    | "reactivate"
    | "revokeSessions"
    | "sendPasswordReset"
  > {
  const tenantDataProvider = createTenantDataProvider(client);
  const identityUserDataProvider = createIdentityUserDataProvider(
    new IdentityClient(client),
  );

  return {
    async getList(resource, params) {
      if (resource === "tenants")
        return tenantDataProvider.getList(resource, params);
      if (resource === "users") {
        return identityUserDataProvider.getList(resource, params);
      }
      const page = params.pagination?.page ?? 1;
      const perPage = params.pagination?.perPage ?? 20;
      const offset = (page - 1) * perPage;
      const query = new URLSearchParams({
        limit: String(perPage),
        offset: String(offset),
      });
      const response = await client.get<PublicDocumentPage>(
        `${collectionPath(resource)}?${query.toString()}`,
        { signal: params.signal },
      );
      return {
        data: response.data.map(toSaviaRecord),
        pageInfo: {
          hasNextPage: response.data.length === perPage,
          hasPreviousPage: offset > 0,
        },
      };
    },

    async getOne(resource, params) {
      if (resource === "tenants")
        return tenantDataProvider.getOne(resource, params);
      if (resource === "users") {
        return identityUserDataProvider.getOne(resource, params);
      }
      const response = await client.get<PublicDocument>(
        `${collectionPath(resource)}/${encodeURIComponent(String(params.id))}`,
        { signal: params.signal },
      );
      return { data: toSaviaRecord(response) };
    },

    async getMany(resource, params) {
      if (resource === "tenants")
        return tenantDataProvider.getMany(resource, params);
      if (resource === "users") {
        return identityUserDataProvider.getMany(resource, params);
      }
      const records = await Promise.all(
        params.ids.map((id) =>
          client
            .get<PublicDocument>(
              `${collectionPath(resource)}/${encodeURIComponent(String(id))}`,
              { signal: params.signal },
            )
            .then(toSaviaRecord),
        ),
      );
      return { data: records };
    },

    async getManyReference(resource, params) {
      return unsupported("getManyReference");
    },

    async create(resource, params) {
      if (resource === "tenants")
        return tenantDataProvider.create(resource, params);
      if (resource === "users") {
        return identityUserDataProvider.create(resource, params);
      }
      return unsupported("create");
    },

    async update(resource, params) {
      if (resource === "tenants")
        return tenantDataProvider.update(resource, params);
      if (resource === "users") {
        return identityUserDataProvider.update(resource, params);
      }
      return unsupported("update");
    },

    async updateMany(resource, params) {
      return unsupported("updateMany");
    },

    async delete(resource, params) {
      if (resource === "tenants")
        return tenantDataProvider.delete(resource, params);
      if (resource === "users") {
        return identityUserDataProvider.delete(resource, params);
      }
      return unsupported("delete");
    },

    async deleteMany(resource, params) {
      return unsupported("deleteMany");
    },
    grantMembership: identityUserDataProvider.grantMembership,
    removeMembership: identityUserDataProvider.removeMembership,
    suspend: identityUserDataProvider.suspend,
    reactivate: identityUserDataProvider.reactivate,
    revokeSessions: identityUserDataProvider.revokeSessions,
    sendPasswordReset: identityUserDataProvider.sendPasswordReset,
  } as DataProvider &
    Pick<
      IdentityUserDataProvider,
      | "grantMembership"
      | "removeMembership"
      | "suspend"
      | "reactivate"
      | "revokeSessions"
      | "sendPasswordReset"
    >;
}

export type { SaviaRecord };
