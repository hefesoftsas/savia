import type { StudioObject } from "@savia/studio-shared/metadata";
import {
  getPluginLookup,
  type PluginLookup,
} from "@savia/studio-shared/plugin-field-lookups";

/** Add a separate, optional ID field; never rewrite existing text or reuse IDs across targets. */
export function withPluginLookup(
  object: StudioObject,
  field: string,
  input: Omit<PluginLookup, "idField"> | undefined,
): StudioObject {
  const next = structuredClone(object);
  const source = next.config.fields[field];
  if (!source || source.type !== "Textbox" || source.readOnly)
    throw new Error("Unsupported lookup field.");
  source.config = { ...source.config };
  if (!input) {
    delete source.config.pluginLookup;
    return next;
  }
  const previous = getPluginLookup(source);
  let idField =
    previous?.collection === input.collection ? previous.idField : "";
  if (!idField) {
    const base = `${field.slice(0, 32)}_record_id`;
    idField = base;
    for (let i = 2; next.config.fields[idField]; i++) idField = `${base}_${i}`;
    next.config.fields[idField] = {
      type: "Textbox",
      label: `${source.label} ID`,
      required: false,
      hidden: true,
    };
    next.config.fieldOrder = [
      ...(next.config.fieldOrder ?? Object.keys(object.config.fields)),
      idField,
    ];
  }
  source.config.pluginLookup = { ...input, idField };
  return next;
}
