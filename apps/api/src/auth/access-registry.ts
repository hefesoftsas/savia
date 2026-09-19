import type {
  AccessScope,
  AccessGrant,
  AccessPredicate,
  AccessAction,
} from "@savia/crm-shared/access-control";
import {
  accessActions,
  accessFieldSchema,
  protectedAccessFields,
} from "@savia/crm-shared/access-control";
export class AccessControlError extends Error {
  constructor(
    public status: 403 | 404 | 409 | 422,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const denyAccess = () => {
  throw new AccessControlError(
    403,
    "ACCESS_FORBIDDEN",
    "You do not have access to this scope or operation.",
  );
};
export const crmTenantForScope = (scope: AccessScope) =>
  scope === "platform"
    ? "domain:platform"
    : scope.startsWith("tenant:")
      ? "agency:" + scope.slice(7)
      : scope;
export type AccessCatalogEntry = {
  resource: AccessGrant["resource"];
  label: string;
  fields: string[];
  actions: AccessAction[];
  creatorSupported: boolean;
  fieldTypes: Record<string, string>;
  restricted: boolean;
};
export async function accessCatalog(
  db: D1Database,
  scope: AccessScope,
): Promise<AccessCatalogEntry[]> {
  const tenant = crmTenantForScope(scope);
  const rows = await db
    .prepare("SELECT name,label,config FROM crm_objects WHERE tenant_id=?")
    .bind(tenant)
    .all<{ name: string; label: string; config: string }>();
  const bindings = await db
    .prepare(
      "SELECT object_name FROM crm_collection_bindings WHERE tenant_id=?",
    )
    .bind(tenant)
    .all<{ object_name: string }>();
  const bound = new Set(bindings.results.map((r) => r.object_name));
  const columns = await db
    .prepare("PRAGMA table_info(crm_records)")
    .all<{ name: string }>();
  const collections: AccessCatalogEntry[] = rows.results.map((row) => {
    const config = JSON.parse(row.config),
      fields = Object.keys(config.fields ?? {}).filter(
        (f) => accessFieldSchema.safeParse(f).success,
      );
    const restricted = Boolean(
      bound.has(row.name) ||
      config.studio?.business ||
      config.studio?.collection ||
      config.studio?.requestPage,
    );
    return {
      resource: `collection:${row.name}` as const,
      label: row.label,
      fields,
      actions: restricted
        ? []
        : accessActions.filter((a) =>
            [
              "read",
              "create",
              "update",
              "delete",
              "restore",
              "import",
              "export",
            ].includes(a),
          ),
      creatorSupported:
        !restricted && columns.results.some((c) => c.name === "created_by"),
      fieldTypes: Object.fromEntries(
        fields.map((f) => [f, String(config.fields[f]?.type ?? "")]),
      ),
      restricted,
    };
  });
  return [
    ...collections,
    ...collections
      .filter((e) => !e.restricted)
      .map((e) => ({
        ...e,
        resource: `page:${e.resource.slice(11)}` as const,
        fields: [],
        fieldTypes: {},
        actions: ["read" as const],
        creatorSupported: false,
      })),
  ];
}
function validatePredicate(
  predicate: AccessPredicate,
  entry: AccessCatalogEntry,
) {
  if ("all" in predicate) return;
  if ("and" in predicate) {
    predicate.and.forEach((p) => validatePredicate(p, entry));
    return;
  }
  if ("or" in predicate) {
    predicate.or.forEach((p) => validatePredicate(p, entry));
    return;
  }
  if (
    predicate.field === "$createdBy"
      ? !entry.creatorSupported
      : !entry.fields.includes(predicate.field)
  )
    throw new AccessControlError(
      422,
      "INVALID_ACCESS_FIELD",
      "Unknown or unsupported predicate field.",
    );
  const fieldType = entry.fieldTypes[predicate.field];
  const operands = predicate.op === "in" ? predicate.values : [predicate.value];
  for (const operand of operands) {
    const valueType =
      "literal" in operand
        ? operand.literal === null
          ? null
          : typeof operand.literal
        : operand.variable === "tenantId"
          ? "number"
          : "string";
    const expected = ["Number", "Currency"].includes(fieldType)
      ? "number"
      : ["Checkbox", "Switch"].includes(fieldType)
        ? "boolean"
        : null;
    if (expected && valueType && valueType !== expected)
      throw new AccessControlError(
        422,
        "INVALID_ACCESS_PREDICATE",
        "The condition value must match the field type.",
      );
  }
  if (
    predicate.op !== "eq" &&
    predicate.op !== "in" &&
    operands.some(
      (v) =>
        "literal" in v &&
        (v.literal === null || typeof v.literal === "boolean"),
    )
  )
    throw new AccessControlError(
      422,
      "INVALID_ACCESS_PREDICATE",
      "Ordered comparison requires a string or number.",
    );
}
export async function validateAccessGrants(
  db: D1Database,
  scope: AccessScope,
  grants: Array<Omit<AccessGrant, "id" | "roleId">>,
) {
  const catalog = await accessCatalog(db, scope);
  for (const grant of grants) {
    const entry = catalog.find((e) => e.resource === grant.resource);
    if (!entry || !entry.actions.includes(grant.action))
      throw new AccessControlError(
        422,
        "UNSUPPORTED_ACCESS_RESOURCE",
        "This resource or action cannot be delegated.",
      );
    if (
      grant.fields.some(
        (f) =>
          !entry.fields.includes(f) ||
          (["create", "update", "import"].includes(grant.action) &&
            protectedAccessFields.has(f)),
      )
    )
      throw new AccessControlError(
        422,
        "INVALID_ACCESS_FIELD",
        "Unknown or protected field.",
      );
    validatePredicate(grant.predicate, entry);
  }
}
