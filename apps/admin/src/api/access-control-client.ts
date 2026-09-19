import type { ApiClient } from "./api-client";
import type { paths } from "./generated/openapi";
type ResponseOf<T> = T extends {
  responses: { 200: { content: { "application/json": infer R } } };
}
  ? R
  : never;
export type AccessRoles = ResponseOf<paths["/v1/access-control/roles"]["get"]>;
export type AccessRole = AccessRoles["roles"][number];
export type AccessCatalog = ResponseOf<
  paths["/v1/access-control/catalog"]["get"]
>["resources"];
export type RoleInput =
  paths["/v1/access-control/roles"]["post"]["requestBody"]["content"]["application/json"];
export function createAccessControlClient(client: ApiClient) {
  const base = "/v1/access-control";
  const query = (scope: string) => "?scope=" + encodeURIComponent(scope);
  return {
    listRoles: (scope: string) =>
      client.get<AccessRoles>(base + "/roles" + query(scope)),
    getCatalog: async (scope: string) =>
      (
        await client.get<{ resources: AccessCatalog }>(
          base + "/catalog" + query(scope),
        )
      ).resources,
    saveRole: (input: RoleInput, id?: string) =>
      id
        ? client.patch<{ id: string; revision: number }>(
            base + "/roles/" + encodeURIComponent(id),
            input,
          )
        : client.post<{ id: string; revision: number }>(base + "/roles", input),
    deleteRole: (scope: string, id: string, expectedRevision: number) =>
      client.delete(
        base +
          "/roles/" +
          encodeURIComponent(id) +
          query(scope) +
          "&expectedRevision=" +
          expectedRevision,
      ),
    getMembers: async (scope: string) =>
      (
        await client.get<
          ResponseOf<paths["/v1/access-control/members"]["get"]>
        >(base + "/members" + query(scope))
      ).members,
    getAssignments: (scope: string, principalId: string) =>
      client.get<
        ResponseOf<paths["/v1/access-control/assignments/{principalId}"]["get"]>
      >(
        base + "/assignments/" + encodeURIComponent(principalId) + query(scope),
      ),
    replaceAssignments: (input: {
      scope: string;
      principalId: string;
      roleIds: string[];
      expectedRevision: number;
    }) =>
      client.put<{ revision: number }>(
        base + "/assignments/" + encodeURIComponent(input.principalId),
        {
          scope: input.scope,
          roleIds: input.roleIds,
          expectedRevision: input.expectedRevision,
        },
      ),
    getEffective: (scope: string, principalId?: string) =>
      client.get<ResponseOf<paths["/v1/access-control/effective"]["get"]>>(
        base +
          "/effective" +
          query(scope) +
          (principalId
            ? "&principalId=" + encodeURIComponent(principalId)
            : ""),
      ),
  };
}
export type AccessControlClient = ReturnType<typeof createAccessControlClient>;
