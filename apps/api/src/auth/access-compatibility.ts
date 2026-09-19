import type {
  AccessGrant,
  AccessScope,
} from "@savia/crm-shared/access-control";
import { accessActions } from "@savia/crm-shared/access-control";
import { accessCatalog, crmTenantForScope } from "./access-registry";
export async function compatibilityGrants(
  db: D1Database,
  scope: AccessScope,
  authority: { platform: boolean; manager: boolean; legacyRole: string | null },
): Promise<AccessGrant[]> {
  const catalog = await accessCatalog(db, scope);
  const rows = await db
    .prepare(
      "SELECT object_name FROM crm_collection_bindings WHERE tenant_id=? AND json_extract(config,'$.kind')='crm' AND json_extract(config,'$.provider')='hubspot' AND json_extract(config,'$.accessScope')='tenant'",
    )
    .bind(crmTenantForScope(scope))
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
