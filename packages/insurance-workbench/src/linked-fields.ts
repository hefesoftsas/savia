import type { PluginApi } from "@savia/crm-shared/plugin-api";
import type { Field } from "./types";
import { loadRecords, text } from "./data";
export async function linkedFields(
  savia: PluginApi,
  object: string,
  configured: readonly Field[],
  current: Record<string, unknown>,
) {
  const definition = await savia.collections.collection(object).describe();
  if (!definition)
    throw new Error(
      "No se pudo leer la colección. Cierra y actualiza antes de editar vínculos.",
    );
  const fields: Field[] = [];
  for (const [key, field] of Object.entries(definition.config?.fields ?? {})) {
    if (configured.some((f) => f.key === key) || field.hidden || field.readOnly)
      continue;
    const relation = field.config?.relation;
    if (typeof relation === "string" && relation && !field.config?.multiple) {
      const records = await loadRecords(savia, relation);
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
