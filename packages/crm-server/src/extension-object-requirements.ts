import type { ExtensionObjectRequirement } from "@savia/crm-shared/extension-package";
import { fail } from "./context";
import { audit, guard } from "./services";

type StoredObject = {
  name: string;
  label: string;
  description: string;
  config: string;
  version: number;
};

type PreparedProvisioning = {
  starts: D1PreparedStatement[];
  writes: D1PreparedStatement[];
  ends: D1PreparedStatement[];
};

function fieldsAreCompatible(
  config: unknown,
  requirement: ExtensionObjectRequirement,
) {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return false;
  const fields = (config as { fields?: unknown }).fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields))
    return false;
  for (const [name, expected] of Object.entries(requirement.requiredFields)) {
    const field = (fields as Record<string, unknown>)[name];
    if (!field || typeof field !== "object" || Array.isArray(field))
      return false;
    const type = (field as { type?: unknown }).type;
    if (typeof type !== "string" || !expected.types.includes(type))
      return false;
    if (
      expected.required &&
      (field as { required?: unknown }).required !== true
    )
      return false;
    if (expected.optionValues) {
      const options = (field as { options?: unknown }).options;
      if (!Array.isArray(options)) return false;
      const values = new Set(
        options.flatMap((option) =>
          option &&
          typeof option === "object" &&
          typeof (option as { value?: unknown }).value === "string"
            ? [(option as { value: string }).value]
            : [],
        ),
      );
      if (expected.optionValues.some((value) => !values.has(value)))
        return false;
    }
  }
  return true;
}

async function storedObject(
  db: D1Database,
  tenant: string,
  name: string,
): Promise<StoredObject | null> {
  return db
    .prepare(
      "SELECT name,label,description,config,version FROM crm_objects WHERE tenant_id=? AND name=?",
    )
    .bind(tenant, name)
    .first<StoredObject>();
}

function compatible(
  object: StoredObject,
  requirement: ExtensionObjectRequirement,
) {
  try {
    return fieldsAreCompatible(JSON.parse(object.config), requirement);
  } catch {
    return false;
  }
}

export async function prepareExtensionObjectProvisioning(
  db: D1Database,
  tenant: string,
  requirements: ReadonlyMap<string, ExtensionObjectRequirement>,
  extensionId: string,
): Promise<PreparedProvisioning> {
  const requirement = requirements.get(extensionId);
  if (!requirement) return { starts: [], writes: [], ends: [] };
  const existing = await storedObject(db, tenant, requirement.object.name);
  if (existing) {
    if (!compatible(existing, requirement))
      return fail(
        `La colección ${requirement.object.name} no cumple el contrato de la extensión.`,
        409,
      );
    const unchanged = guard(
      db,
      "SELECT version=? AND label=? AND description=? AND config=? FROM crm_objects WHERE tenant_id=? AND name=?",
      [
        existing.version,
        existing.label,
        existing.description,
        existing.config,
        tenant,
        requirement.object.name,
      ],
    );
    return { starts: [unchanged.start], writes: [], ends: [unchanged.end] };
  }
  const object = { ...requirement.object, version: 1 };
  const absent = guard(
    db,
    "SELECT count(*)=0 FROM crm_objects WHERE tenant_id=? AND name=?",
    [tenant, object.name],
  );
  return {
    starts: [absent.start],
    writes: [
      db
        .prepare(
          "INSERT INTO crm_objects(tenant_id,name,label,description,config,version) VALUES (?,?,?,?,?,1)",
        )
        .bind(
          tenant,
          object.name,
          object.label,
          object.description,
          JSON.stringify(object.config),
        ),
      db
        .prepare(
          "INSERT INTO crm_schema_versions(tenant_id,object_name,version,definition) VALUES (?,?,1,?)",
        )
        .bind(tenant, object.name, JSON.stringify(object)),
      audit(db, tenant, "extension.collection.provisioned", object.name, null, {
        extensionId,
      }),
    ],
    ends: [absent.end],
  };
}

export async function assertExtensionObjectRequirement(
  db: D1Database,
  tenant: string,
  requirement: ExtensionObjectRequirement,
) {
  const object = await storedObject(db, tenant, requirement.object.name);
  if (!object)
    return fail(
      `Falta la colección ${requirement.object.name} requerida por esta extensión. Reinstálala o revisa su configuración.`,
      404,
    );
  if (!compatible(object, requirement))
    return fail(
      `La colección ${requirement.object.name} requerida por esta extensión no cumple su contrato. Reinstálala o revisa su configuración.`,
      409,
    );
}
