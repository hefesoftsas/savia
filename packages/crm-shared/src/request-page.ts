import { z } from "zod";
import type { CrmObject } from "./metadata";
import { fieldLabelsSchema, resolveFieldLabel } from "./field-labels";
import { materializeSchema } from "./json-schema";
import {
  filterLookupIcons,
  isLookupIconId,
  lookupIconLabel,
  RECOMMENDED_LOOKUP_ICONS,
} from "./lookup-icons";
const fieldId = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
export const lookupPlacementSchema = z.enum([
  "inline-end",
  "below-label",
  "below-field",
]);
export const DEFAULT_LOOKUP_PLACEMENT =
  lookupPlacementSchema.enum["inline-end"];
export type LookupPlacement = z.infer<typeof lookupPlacementSchema>;
export const LOOKUP_PLACEMENT_LABELS: Record<LookupPlacement, string> = {
  "inline-end": "Junto al campo (derecha)",
  "below-label": "Debajo de la etiqueta",
  "below-field": "Debajo del campo",
};
export function lookupPlacementLabel(placement: LookupPlacement): string {
  return LOOKUP_PLACEMENT_LABELS[placement];
}
export const lookupButtonStyleSchema = z.enum(["text", "icon"]);
export const DEFAULT_LOOKUP_BUTTON_STYLE = lookupButtonStyleSchema.enum.text;
export type LookupButtonStyle = z.infer<typeof lookupButtonStyleSchema>;
export const LOOKUP_BUTTON_STYLE_LABELS: Record<LookupButtonStyle, string> = {
  text: "Texto",
  icon: "Solo icono",
};
export const lookupIconSchema = z
  .string()
  .min(1)
  .max(80)
  .refine(isLookupIconId, { message: "Icono no válido." });
export const DEFAULT_LOOKUP_ICON = "search";
export type LookupIcon = z.infer<typeof lookupIconSchema>;
export {
  browseLookupIcons,
  filterLookupIcons,
  formatLookupIconRef,
  listLookupIcons,
  LOOKUP_ICON_IDS,
  LOOKUP_ICON_LIBRARY_LABELS,
  LOOKUP_ICON_SEARCH_MIN_LENGTH,
  lookupIconCatalogSize,
  lookupIconLabel,
  lookupIconLibrary,
  parseLookupIconRef,
  RECOMMENDED_LOOKUP_ICONS,
  RECOMMENDED_THESVG_LOOKUP_ICONS,
  THESVG_ICON_IDS,
  type LookupIconLibrary,
} from "./lookup-icons";
export const LOOKUP_ICON_LABELS = Object.fromEntries(
  RECOMMENDED_LOOKUP_ICONS.map((id) => [id, lookupIconLabel(id)]),
) as Record<(typeof RECOMMENDED_LOOKUP_ICONS)[number], string>;
export const lookupTriggerEventSchema = z.enum([
  "blur",
  "change",
  "input",
  "focus",
  "keydown.enter",
]);
export type LookupTriggerEvent = z.infer<typeof lookupTriggerEventSchema>;
/** Supported DOM events for lookup triggers on the primary field input. */
export const LOOKUP_INPUT_EVENTS = lookupTriggerEventSchema.options;
export const LOOKUP_TRIGGER_EVENTS = LOOKUP_INPUT_EVENTS;
export const DEFAULT_LOOKUP_EVENT_DEBOUNCE_MS = 450;
export const lookupEventDebounceMsSchema = z.number().int().min(0).max(10000);
export const requestActionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,80}$/),
    operationId: z.string().min(1).max(200),
    label: z.string().min(1).max(150),
    labels: fieldLabelsSchema,
    kind: z.enum(["submit", "lookup"]),
    placement: lookupPlacementSchema.optional(),
    buttonStyle: lookupButtonStyleSchema.optional(),
    icon: lookupIconSchema.optional(),
    events: z.array(lookupTriggerEventSchema).max(12).optional(),
    eventDebounce: z.boolean().optional(),
    eventDebounceMs: lookupEventDebounceMsSchema.optional(),
    input: z.record(z.string().max(150), fieldId),
    output: z
      .record(fieldId, z.string().regex(/^\/[a-zA-Z0-9_/]+$/))
      .default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind !== "lookup") {
      if (value.placement !== undefined)
        ctx.addIssue({
          code: "custom",
          message: "La posición del botón solo aplica a consultas.",
          path: ["placement"],
        });
      if (value.buttonStyle !== undefined)
        ctx.addIssue({
          code: "custom",
          message: "El estilo del botón solo aplica a consultas.",
          path: ["buttonStyle"],
        });
      if (value.icon !== undefined)
        ctx.addIssue({
          code: "custom",
          message: "El icono solo aplica a consultas.",
          path: ["icon"],
        });
      if (value.events !== undefined)
        ctx.addIssue({
          code: "custom",
          message: "Los eventos del campo solo aplican a consultas.",
          path: ["events"],
        });
      if (value.eventDebounce !== undefined)
        ctx.addIssue({
          code: "custom",
          message: "El debounce solo aplica a consultas.",
          path: ["eventDebounce"],
        });
      if (value.eventDebounceMs !== undefined)
        ctx.addIssue({
          code: "custom",
          message: "La espera del debounce solo aplica a consultas.",
          path: ["eventDebounceMs"],
        });
      return;
    }
    if (value.events && new Set(value.events).size !== value.events.length)
      ctx.addIssue({
        code: "custom",
        message: "No repitas un evento del campo.",
        path: ["events"],
      });
    if (value.eventDebounceMs !== undefined && value.eventDebounce !== true)
      ctx.addIssue({
        code: "custom",
        message: "Activa debounce antes de definir la espera.",
        path: ["eventDebounceMs"],
      });
    if (value.buttonStyle !== "icon" && value.icon !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "El icono solo aplica cuando el botón es solo icono.",
        path: ["icon"],
      });
  });
export const resultColumnPointerSchema = z.string().regex(/^\/[a-zA-Z0-9_/]+$/);
export const resultColumnFormatSchema = z.enum(["text", "money"]);
export type ResultColumnFormat = z.infer<typeof resultColumnFormatSchema>;
export const RESULT_COLUMN_FORMAT_LABELS: Record<ResultColumnFormat, string> = {
  text: "Texto",
  money: "Moneda",
};
export const resultColumnSchema = z.object({
  label: z.string().min(1).max(80),
  pointer: resultColumnPointerSchema,
  format: resultColumnFormatSchema.default("text"),
});
export type ResultColumn = z.infer<typeof resultColumnSchema>;
export const DEFAULT_RESULT_COLUMNS: ResultColumn[] = [
  { label: "Resultado", pointer: "/result", format: "text" },
];
export const RESULT_COLUMN_PRESETS: ResultColumn[] = [
  ...DEFAULT_RESULT_COLUMNS,
  { label: "Producto", pointer: "/product/name", format: "text" },
  { label: "Prima", pointer: "/premium/total", format: "money" },
  { label: "Referencia", pointer: "/reference", format: "text" },
  { label: "Aseguradora", pointer: "/provider", format: "text" },
  { label: "ID producto", pointer: "/product/id", format: "text" },
  { label: "Prima neta", pointer: "/premium/net", format: "money" },
  { label: "Impuestos", pointer: "/premium/tax", format: "money" },
  { label: "Moneda", pointer: "/premium/currency", format: "text" },
];
export function reorderResultColumns(
  columns: ResultColumn[],
  sourceIndex: number,
  targetIndex: number,
): ResultColumn[] {
  if (
    sourceIndex === targetIndex ||
    sourceIndex < 0 ||
    targetIndex < 0 ||
    sourceIndex >= columns.length ||
    targetIndex >= columns.length
  ) {
    return columns;
  }
  const next = [...columns];
  const [item] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, item);
  return next;
}
export function isValidResultColumnPointer(value: string): boolean {
  return resultColumnPointerSchema.safeParse(value).success;
}
export const requestPageSchema = z
  .object({
    version: z.literal(1),
    source: z.literal("savia-request"),
    resultColumns: z
      .array(resultColumnSchema)
      .max(12)
      .default(DEFAULT_RESULT_COLUMNS),
    resultReact: z.string().max(100000).optional(),
    resultHtml: z.string().max(100000).optional(),
    resultLayout: z
      .enum(["table", "cards", "comparison", "html", "react"])
      .optional(),
    submitLabel: z.string().min(1).max(80).default("Ejecutar"),
    actions: z.array(requestActionSchema).min(1).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.actions.map((a) => a.id)).size !== value.actions.length)
      ctx.addIssue({ code: "custom", message: "No repitas una operación." });
    if (!value.actions.some((a) => a.kind === "submit"))
      ctx.addIssue({
        code: "custom",
        message: "Selecciona una operación principal.",
      });
  });
export type RequestPageConfig = z.infer<typeof requestPageSchema>;
export type RequestAction = z.infer<typeof requestActionSchema>;
export function resolveLookupTriggerEvents(
  action: RequestAction,
): LookupTriggerEvent[] {
  return action.events ?? [];
}
export function lookupActionEventsSummary(
  action: RequestAction,
): string | null {
  const events = resolveLookupTriggerEvents(action);
  if (!events.length) return null;
  const debounce = resolveLookupEventDebounce(action)
    ? ` · debounce ${resolveLookupEventDebounceMs(action)}ms`
    : "";
  return `Eventos: ${events.join(", ")}${debounce}`;
}
export function resolveLookupEventDebounce(action: RequestAction): boolean {
  return action.eventDebounce === true;
}
export function resolveLookupEventDebounceMs(action: RequestAction): number {
  return action.eventDebounceMs ?? DEFAULT_LOOKUP_EVENT_DEBOUNCE_MS;
}
export function resolveLookupPlacement(action: RequestAction): LookupPlacement {
  return action.placement ?? DEFAULT_LOOKUP_PLACEMENT;
}
export function lookupActionPlacementLabel(action: RequestAction): string {
  return lookupPlacementLabel(resolveLookupPlacement(action));
}
export function resolveLookupButtonStyle(
  action: RequestAction,
): LookupButtonStyle {
  return action.buttonStyle ?? DEFAULT_LOOKUP_BUTTON_STYLE;
}
export function resolveLookupIcon(action: RequestAction): LookupIcon {
  return action.icon ?? DEFAULT_LOOKUP_ICON;
}
export function lookupActionButtonSummary(action: RequestAction): string {
  const label =
    resolveLookupButtonStyle(action) === "icon"
      ? lookupIconLabel(resolveLookupIcon(action))
      : action.label;
  return `Botón: ${label} · ${lookupActionPlacementLabel(action)}`;
}
export type RequestOperation = {
  id: string;
  operationId: string;
  label: string;
  kind: string;
  input: Record<string, any>;
};

export const resolveRequestActionLabel = resolveFieldLabel;

export function listRequestOperations(
  operations: RequestOperation[],
  query: string,
  options?: { excludeIds?: Iterable<string> },
): RequestOperation[] {
  const exclude = new Set(options?.excludeIds ?? []);
  const normalized = query.trim().toLowerCase();
  return operations.filter((operation) => {
    if (operation.kind === "auth") return false;
    if (!Object.keys(operation.input).length) return false;
    if (exclude.has(operation.id)) return false;
    if (!normalized) return true;
    return (
      operation.label.toLowerCase().includes(normalized) ||
      operation.id.toLowerCase().includes(normalized) ||
      operation.operationId.toLowerCase().includes(normalized)
    );
  });
}

export function createLookupActionFromOperation(
  operation: RequestOperation,
  fieldId: string,
  fields: CrmObject["config"]["fields"],
): RequestAction {
  const keys = Object.keys(operation.input);
  if (!keys.length) {
    throw new Error(`La operación «${operation.id}» no tiene entradas.`);
  }
  const input = Object.fromEntries(
    keys.map((key, index) => [
      key,
      index === 0
        ? fieldId
        : fields[requestFieldName(key)]
          ? requestFieldName(key)
          : fieldId,
    ]),
  );
  const output: Record<string, string> = {};
  for (const schema of Object.values(operation.input)) {
    const ui = schema["x-savia-field"];
    for (const [field, pointer] of Object.entries(ui?.output ?? {})) {
      const name = requestFieldName(field);
      if (fields[name]) output[name] = String(pointer);
    }
  }
  return {
    id: operation.id,
    operationId: operation.operationId,
    label: operation.label,
    kind: "lookup",
    placement: DEFAULT_LOOKUP_PLACEMENT,
    input,
    output,
  };
}

export function requestOperations(document: any): RequestOperation[] {
  return Object.entries(document.paths ?? {}).flatMap(
    ([path, item]: [string, any]) => {
      const match = /^\/api\/flows\/([a-z0-9-]{1,80})\/runs$/.exec(path);
      const operation = item.post;
      if (!match || !operation?.operationId) return [];
      const body = materializeSchema(
        document,
        operation.requestBody?.content?.["application/json"]?.schema ?? {},
      );
      return [
        {
          id: match[1],
          operationId: operation.operationId,
          label:
            operation["x-savia-action-label"] ?? operation.summary ?? match[1],
          kind: operation["x-savia-kind"] ?? "request",
          input: body.properties?.input?.properties ?? {},
        },
      ];
    },
  );
}
export const requestFieldName = (key: string) =>
  key
    .replace(/^auto_light\./, "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .toLowerCase();

/** Generate real CRM metadata from the operation contracts, never from sample values. */
export function generateRequestPage(
  document: unknown,
  options: {
    name: string;
    label: string;
    operationIds: string[];
    lookupIds?: string[];
  },
): CrmObject {
  const operations = requestOperations(document);
  const fields: CrmObject["config"]["fields"] = {};
  const sections = new Map<string, string>();
  const selected = options.operationIds.map((id) => {
    const operation = operations.find((o) => o.id === id);
    if (!operation) throw new Error(`Operación no disponible: ${id}`);
    return operation;
  });
  const actions: RequestAction[] = selected.map((operation) => {
    const input: Record<string, string> = {};
    for (const [key, schema] of Object.entries(operation.input)) {
      const name = requestFieldName(key);
      fieldId.parse(name);
      if (Object.values(input).includes(name))
        throw new Error("Dos entradas producen el mismo campo: " + name);
      input[key] = name;
      const ui = schema["x-savia-field"] ?? {};
      const type =
        ui.type ??
        (schema.contentSchema
          ? "Textarea"
          : schema.enum
            ? "Dropdown"
            : schema.format === "date"
              ? "DateControl"
              : schema.format === "email"
                ? "Email"
                : schema.format === "uri"
                  ? "Url"
                  : "Textbox");
      const definition = {
        type,
        label: schema.title ?? key,
        required: ui.required ?? true,
        ...(schema.enum
          ? {
              options: schema.enum.map((value: string) => ({
                value,
                label: ui.options?.[value] ?? value,
              })),
            }
          : {}),
        ...(schema.default !== undefined
          ? {
              defaultValue:
                type === "Number" ? Number(schema.default) : schema.default,
            }
          : {}),
        config: {
          requestOrder: ui.order ?? 999,
          requestSectionOrder: ui.sectionOrder ?? 999,
          ...(ui.section ? { section: ui.section } : {}),
          ...(ui.minimum !== undefined ? { minimum: ui.minimum } : {}),
          ...(ui.integer ? { integer: true } : {}),
          ...(type === "Textbox" && schema.format === "email"
            ? { format: "email" }
            : {}),
          ...(schema.contentSchema ? { jsonSchema: schema.contentSchema } : {}),
          ...(ui.transform ? { requestTransform: ui.transform } : {}),
        },
      };
      if (
        fields[name] &&
        JSON.stringify(fields[name]) !== JSON.stringify(definition)
      )
        throw new Error(
          `Contratos incompatibles para ${key}. Genera páginas separadas.`,
        );
      fields[name] = definition;
      if (ui.section) sections.set(ui.section, ui.sectionLabel ?? ui.section);
    }
    return {
      id: operation.id,
      operationId: operation.operationId,
      label: operation.label,
      kind: "submit",
      input,
      output: {},
    };
  });
  for (const id of options.lookupIds ?? []) {
    const op = operations.find((o) => o.id === id);
    if (!op) throw new Error("Consulta no disponible: " + id);
    const input: Record<string, string> = {},
      output: Record<string, string> = {};
    for (const [key, schema] of Object.entries(op.input)) {
      const ui = schema["x-savia-field"];
      const target = ui?.bind
        ? requestFieldName(ui.bind)
        : requestFieldName(key);
      if (!fields[target])
        throw new Error("La consulta necesita un campo existente: " + target);
      input[key] = target;
      for (const [field, pointer] of Object.entries(ui?.output ?? {})) {
        const name = requestFieldName(field);
        if (fields[name]) output[name] = String(pointer);
      }
    }
    actions.push({
      id,
      operationId: op.operationId,
      label: op.label,
      kind: "lookup",
      placement: DEFAULT_LOOKUP_PLACEMENT,
      input,
      output,
    });
  }
  return {
    name: options.name,
    label: options.label,
    description:
      "Completa el formulario y consulta los resultados de las operaciones seleccionadas.",
    config: {
      version: 2,
      fields,
      fieldOrder: Object.keys(fields).sort(
        (a, b) =>
          Number(fields[a].config?.requestOrder) -
          Number(fields[b].config?.requestOrder),
      ),
      studio: {
        columns: 3,
        sections: [...sections]
          .map(([id, label]) => ({ id, label }))
          .sort(
            (a, b) =>
              Number(
                Object.values(fields).find((f) => f.config?.section === a.id)
                  ?.config?.requestSectionOrder,
              ) -
              Number(
                Object.values(fields).find((f) => f.config?.section === b.id)
                  ?.config?.requestSectionOrder,
              ),
          ),
        requestPage: requestPageSchema.parse({
          version: 1,
          source: "savia-request",
          submitLabel: "Cotizar",
          actions,
        }),
      },
    },
  };
}
