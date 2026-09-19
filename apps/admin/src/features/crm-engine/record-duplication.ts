import type { CrmObject, CrmRecord } from "@savia/crm-shared/metadata";
import {
  collectionCapabilities,
  supportsLocalRecordTools,
} from "./collection-capabilities";

const scalarTypes = new Set([
  "Textbox",
  "Textarea",
  "Email",
  "Phone",
  "Url",
  "Address",
  "Number",
  "Currency",
  "Dropdown",
  "Autocomplete",
  "Toggle",
  "DateControl",
]);
const reserved =
  /^(id|_.*|owner|owner_id|ownerId|created_by|createdBy|updated_by|updatedBy|created_at|createdAt|updated_at|updatedAt|deleted_at|deletedAt)$/;
export function canDuplicateRecord(object: CrmObject): boolean {
  const capabilities = collectionCapabilities(object);
  return (
    supportsLocalRecordTools(object) && capabilities.read && capabilities.create
  );
}
/** Only values present in visible metadata and the authorized source are eligible. */
export function duplicateRecordValues(
  object: CrmObject,
  source: CrmRecord,
): Record<string, unknown> {
  if (!canDuplicateRecord(object)) return {};
  return Object.fromEntries(
    Object.entries(object.config.fields).flatMap(([name, field]) => {
      const config = field.config;
      const value = source[name];
      if (
        reserved.test(name) ||
        name === object.config.studio?.pipeline?.ownerField ||
        field.hidden ||
        field.readOnly ||
        !scalarTypes.has(field.type) ||
        config?.unique ||
        config?.formula ||
        config?.relation ||
        config?.collectionRelation ||
        config?.collectionRelationTarget ||
        config?.multiple ||
        config?.sensitive ||
        config?.readable === false ||
        config?.writable === false ||
        !Object.hasOwn(source, name) ||
        !(
          value === null ||
          ["string", "number", "boolean"].includes(typeof value)
        )
      )
        return [];
      return [[name, value]];
    }),
  );
}
