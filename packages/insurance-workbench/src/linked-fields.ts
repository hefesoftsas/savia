import type { PluginApi } from "@savia/studio-shared/plugin-api";
import { getPluginLookup } from "@savia/studio-shared/plugin-field-lookups";
import type { Field } from "./types";
import { loadRecords, text } from "./data";
export async function linkedFields(
  savia: PluginApi,
  object: string,
  configured: readonly Field[],
  current: Record<string, unknown>,
) {
  const definition = await (savia.localRecords ?? savia.collections).collection(object).describe();
  if (!definition)
    throw new Error(
      "No se pudo leer la colección. Cierra y actualiza antes de editar vínculos.",
    );
  const entries = Object.entries(definition.config?.fields ?? {});
  const metadataFields = new Map(entries);
  const configuredKeys = new Set(configured.map((field) => field.key));
  const fields: Field[] = [];

  // Lookup mappings come from tenant field metadata. Resolve only metadata here;
  // records are fetched by the picker as the user searches.
  for (const configuredField of configured) {
    if (configuredField.lookup !== true) continue;
    const metadata = metadataFields.get(configuredField.key);
    const lookup = getPluginLookup(metadata);
    if (!lookup) continue;
    const target = await (savia.localRecords ?? savia.collections)
      .collection(lookup.collection)
      .describe();
    if (!target)
      throw new Error(
        `No se pudo leer la colección de búsqueda «${lookup.collection}».`,
      );
    const targetFields = target.config?.fields ?? {};
    const targetCapabilities = target.config?.studio as
      | {
          collection?: { capabilities?: { list?: boolean; read?: boolean } };
          capabilities?: { list?: boolean; read?: boolean };
        }
      | undefined;
    const capabilities =
      targetCapabilities?.collection?.capabilities ??
      targetCapabilities?.capabilities;
    if (capabilities && (capabilities.list !== true || capabilities.read !== true))
      throw new Error(
        `La colección «${lookup.collection}» no permite consultar referencias.`,
      );
    if (
      !targetFields[lookup.labelField] ||
      lookup.searchFields.some((key) => !targetFields[key]) ||
      (lookup.filter && !targetFields[lookup.filter.field])
    )
      throw new Error(
        `La configuración de búsqueda de «${configuredField.label}» está desactualizada.`,
      );
    fields.push({ ...configuredField, lookupConfig: lookup });
    if (
      !configuredKeys.has(lookup.idField) &&
      !fields.some((field) => field.key === lookup.idField)
    ) {
      const companion = metadataFields.get(lookup.idField);
      if (!companion)
        throw new Error(
          `Falta el campo de referencia «${lookup.idField}» para «${configuredField.label}».`,
        );
      fields.push({
        key: lookup.idField,
        label: companion.label ?? lookup.idField,
        type: "text",
        hidden: true,
      });
    }
  }

  const relationLoads = new Map<string, ReturnType<typeof loadRecords>>();
  for (const [key, field] of entries) {
    if (
      configuredKeys.has(key) ||
      fields.some((resolved) => resolved.key === key) ||
      field.hidden ||
      field.readOnly
    )
      continue;
    const relation = field.config?.relation;
    if (
      typeof relation === "string" &&
      relation &&
      !field.config?.multiple &&
      !relationLoads.has(relation)
    ) {
      relationLoads.set(relation, loadRecords(savia, relation));
    }
  }
  await Promise.all(relationLoads.values());

  for (const [key, field] of entries) {
    if (
      configuredKeys.has(key) ||
      fields.some((resolved) => resolved.key === key) ||
      field.hidden ||
      field.readOnly
    )
      continue;
    const relation = field.config?.relation;
    if (typeof relation === "string" && relation && !field.config?.multiple) {
      const records = await relationLoads.get(relation)!;
      const options = records.map((r) => ({
        value: r.id,
        label: text(r.name) || r.id,
      }));
      const selected = text(current[key]);
      if (selected && !options.some((o) => o.value === selected))
        options.unshift({
          value: selected,
          label: "Vínculo actual (sin acceso al nombre)",
        });
      fields.push({
        key,
        label: field.label,
        type: "select",
        required: field.required,
        options,
        help: "Vínculo por ID al registro de origen. No modifica la referencia de texto.",
      });
    } else if (
      field.type === "DateControl" &&
      ["coverage_start", "coverage_end"].includes(key)
    ) {
      fields.push({
        key,
        label: field.label,
        type: "date",
        required: field.required,
      });
    }
  }
  return fields;
}
