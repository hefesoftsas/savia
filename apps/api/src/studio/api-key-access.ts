import type { AccessPolicy } from "@savia/studio-shared/access-control";
import type { ApiKeyScope } from "../auth/personal-api-keys";
import { accessCatalog } from "../auth/access-registry";

/** Keep live owner restrictions and narrow them to key actions on native collections. */
export async function apiKeyAccessPolicy(
  db: D1Database,
  policy: AccessPolicy,
  scopes: readonly ApiKeyScope[],
): Promise<AccessPolicy> {
  const native = new Set(
    (await accessCatalog(db, policy.scope))
      .filter(
        (entry) =>
          entry.resource.startsWith("collection:") && !entry.restricted,
      )
      .map((entry) => entry.resource.slice("collection:".length)),
  );
  return {
    ...policy,
    grants: policy.grants.filter((grant) => {
      const [kind, name] = grant.resource.split(":");
      if (!native.has(name)) return false;
      if (kind === "page")
        return grant.action === "read" && scopes.includes("records:read");
      return (
        kind === "collection" &&
        ((grant.action === "read" && scopes.includes("records:read")) ||
          (grant.action === "create" && scopes.includes("records:create")) ||
          (grant.action === "update" && scopes.includes("records:update")))
      );
    }),
  };
}
