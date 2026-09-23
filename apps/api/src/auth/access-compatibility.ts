import { dialectFor } from "@savia/db/dialect";
import type {
  AccessGrant,
  AccessScope,
} from "@savia/studio-shared/access-control";
import { accessActions } from "@savia/studio-shared/access-control";
import { accessCatalog, studioTenantForScope } from "./access-registry";
export async function compatibilityGrants(
  db: D1Database,
  scope: AccessScope,
  authority: { platform: boolean; manager: boolean; legacyRole: string | null },
): Promise<AccessGrant[]> {
  const catalog = await accessCatalog(db, scope);
  const rows = await db
    .prepare(
      "SELECT object_name FROM crm_collection_bindings WHERE tenant_id=? AND " +
        dialectFor(db).jsonValue("config", "$.kind") +
        "='crm' AND " +
        dialectFor(db).jsonValue("config", "$.provider") +
        "='hubspot' AND " +
        dialectFor(db).jsonValue("config", "$.accessScope") +
        "='tenant'",
    )
    .bind(studioTenantForScope(scope))
    .all<{ object_name: string }>();
  const shared = new Set(rows.results.map((r) => r.object_name));
  const roleId =
    "builtin:" +
    scope +
    ":" +
    (authority.platform ? "platform_admin" : authority.legacyRole);
  return catalog.flatMap((entry) => {
    const actions = authority.manager
      ? accessActions
      : shared.has(entry.resource.slice(11))
        ? ["read" as const]
        : [];
    return actions.map((action) => ({
      id: roleId + ":" + entry.resource + ":" + action,
      roleId,
      resource: entry.resource,
      action,
      predicate: { all: true as const },
      fields: entry.fields,
    }));
  });
}
