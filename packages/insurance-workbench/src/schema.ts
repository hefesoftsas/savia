import type {
  ExtensionManifest,
  ExtensionObjectRequirement,
} from "@savia/crm-shared/extension-package";
import type { Field } from "./types";
import { cents, day, text } from "./data";
export function objectRequirement(
  manifest: ExtensionManifest,
  object: string,
  fields: readonly Field[],
): ExtensionObjectRequirement {
  const types = {
    text: "Textbox",
    textarea: "Textarea",
    number: "Number",
    date: "DateControl",
    select: "Dropdown",
  } as const;
  return {
    id: manifest.id,
    object: {
      name: object,
      label: manifest.label,
      description: manifest.description,
      config: {
        version: 2,
        fields: Object.fromEntries(
          fields.map((field) => [
            field.key,
            {
              type: types[field.type ?? "text"],
              label: field.label,
              labels: {},
              required: field.required,
              options: field.options ? [...field.options] : undefined,
              config: {
                ...(field.type === "number"
                  ? {
                      minimum: field.min ?? 0,
                      maximum: field.max ?? 90000000000,
                    }
                  : {}),
                ...(!field.type ||
                field.type === "text" ||
                field.type === "textarea"
                  ? {
                      maxLength:
                        field.maxLength ??
                        (field.type === "textarea" ? 10000 : 200),
                    }
                  : {}),
                ...(field.requiredStages
                  ? {
                      requiredWhen: {
                        field: "stage",
                        op: "in",
                        value: [...field.requiredStages],
                      },
                    }
                  : {}),
              },
            },
          ]),
        ),
        fieldOrder: fields.map((field) => field.key),
      },
    },
    requiredFields: Object.fromEntries(
      fields.map((field) => [
        field.key,
        {
          types: [types[field.type ?? "text"]],
          ...(field.required ? { required: true } : {}),
          ...(field.options
            ? { optionValues: field.options.map((option) => option.value) }
            : {}),
        },
      ]),
    ),
  };
}
export function validateFields(
  fields: readonly Field[],
  record: Record<string, unknown>,
): string | null {
  for (const field of fields) {
    const value = record[field.key];
    const empty = value == null || (typeof value === "string" && !value.trim());
    if (empty) {
      if (field.required || field.requiredStages?.includes(text(record.stage)))
        return `Completa ${field.label.toLowerCase()}.`;
      continue;
    }
    if (field.type === "number") {
      if (
        cents(value) === null ||
        Number(value) < (field.min ?? 0) ||
        Number(value) > (field.max ?? 90000000000)
      )
        return `${field.label}: revisa el valor y usa máximo dos decimales.`;
    } else if (field.type === "date") {
      if (day(value) === null)
        return `${field.label}: indica una fecha válida.`;
    } else if (field.options) {
      if (!field.options.some((option) => option.value === value))
        return `${field.label}: selecciona una opción válida.`;
    } else if (
      typeof value !== "string" ||
      value.length >
        (field.maxLength ?? (field.type === "textarea" ? 10000 : 200))
    )
      return `${field.label}: revisa la longitud del texto.`;
  }
  return null;
}
export function duePriority(
  record: Record<string, unknown>,
  dateField: string,
  closedStages: readonly string[],
  asOf: string,
): string {
  if (closedStages.includes(text(record.stage))) return "closed";
  const date = day(record[dateField]),
    now = day(asOf);
  if (date === null || now === null) return "undated";
  const days = date - now;
  return days < 0
    ? "overdue"
    : days === 0
      ? "today"
      : days <= 7
        ? "week"
        : "later";
}
