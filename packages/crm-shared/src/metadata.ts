import {
  recordHistorySettingsSchema,
  isHistoryField,
  type RecordHistorySettings,
} from "./record-history";
import { resourceMetadataSchema, isDatabaseKind } from "./database-sources";
import { collectionOptionsSchema } from "./collection-options";
import { requestPageSchema, type RequestPageConfig } from "./request-page";
import type { IFormConfig, IFieldConfig } from "@form-eng/core";
import { z } from "zod";
import { addressAutocompleteConfigSchema } from "./address-autocomplete";
import { mapPickerConfigSchema } from "./map-location";
import { formHtmlConfigSchema } from "./form-html";
import { displayTextConfigSchema } from "./display-text";
import { availableOptions, type OptionDependency } from "./dependent-options";
import { validateJsonSchema } from "./json-schema";
import { recordValidationMessage } from "./record-validation-messages";
import {
  fieldLabelsSchema,
  normalizeFieldLabels,
  resolveFieldLabel,
  type FieldLabelLocale,
} from "./field-labels";
import {
  evaluateCondition,
  isSectionVisible,
  prepareRecord,
  type Condition,
} from "./rules";
import { parseMapLocation } from "./map-location";
import { isLookupIconId, lookupIconLibrary } from "./lookup-icons";
export type WizardConfig = {
  presentation?: "conversation" | "steps";
  enabled: boolean;
  steps: { id: string; title: string; description?: string }[];
};
export const recordSurfaces = [
  "modal",
  "drawer",
  "drawer-long",
  "page",
] as const;
export type RecordSurface = (typeof recordSurfaces)[number];
export const screenNavigationSections = [
  "operation",
  "productivity",
  "administration",
  "management",
] as const;
export const screenNavigationSectionSchema = z.enum(screenNavigationSections);
export type ScreenNavigationSection = z.infer<
  typeof screenNavigationSectionSchema
>;
export const screenNavigationIconSchema = z
  .string()
  .min(1)
  .max(80)
  .refine(
    (value) => lookupIconLibrary(value) === "lucide" && isLookupIconId(value),
    { message: "El icono del menú debe ser un icono Lucide válido." },
  );
export type ScreenNavigationIcon = z.infer<typeof screenNavigationIconSchema>;
export const collectionCapabilitiesSchema = z.object({
  search: z.boolean().optional(),
  filter: z.boolean().optional(),
  sort: z.boolean().optional(),
  list: z.boolean(),
  read: z.boolean(),
  create: z.boolean(),
  update: z.boolean(),
  delete: z.boolean(),
  schema: z.boolean(),
  customFields: z.boolean(),
});
export type CollectionCapabilities = z.infer<
  typeof collectionCapabilitiesSchema
>;
export const collectionBindingMetadataSchema = z.object({
  sourceId: z.string().min(1).max(120),
  resource: z.string().min(1).max(300),
  kind: z.enum([
    "domain",
    "jsonapi",
    "postgres",
    "mysql",
    "mssql",
    "mongodb",
    "crm",
  ]),
  domain: z.string().optional(),
  collection: z.string().optional(),
  capabilities: collectionCapabilitiesSchema,
  /** Postgres v1: columna identificadora y PK real de la tabla. */
  databaseMetadata: resourceMetadataSchema.optional(),
  sourceOwnerPrincipalId: z.string().optional(),
  writePermissions: z
    .object({ create: z.boolean(), update: z.boolean(), delete: z.boolean() })
    .optional(),
  idType: z.enum(["string", "objectId"]).optional(),
  schemaIssues: z.array(z.string()).optional(),
  idColumn: z.string().min(1).max(63).optional(),
  primaryKey: z.array(z.string().min(1).max(63)).max(10).optional(),
});
export type CollectionBindingMetadata = z.infer<
  typeof collectionBindingMetadataSchema
>;
export type StudioConfig = {
  history?: RecordHistorySettings;
  collection?: CollectionBindingMetadata;
  capabilities?: CollectionCapabilities;
  business?: "customer" | "quotation" | "managed-customer" | "managed-agency";
  screen?: {
    hidden?: boolean;
    order?: number;
    createMode?: RecordSurface;
    editMode?: RecordSurface;
    section?: ScreenNavigationSection;
    icon?: ScreenNavigationIcon;
  };
  wizard?: WizardConfig;
  columns?: 1 | 2 | 3;
  requestPage?: RequestPageConfig;
  sections?: { id: string; label: string; visibleWhen?: Condition }[];
  pipeline?: {
    field: string;
    amountField?: string;
    ownerField?: string;
    wonValues?: string[];
    lostValues?: string[];
  };
};
export type CrmObject = {
  name: string;
  label: string;
  description: string;
  config: IFormConfig & { studio?: StudioConfig };
  count?: number;
  version?: number;
};
export type CrmRecord = {
  id: string;
  created_at: string;
  updated_at: string;
  _version?: number;
  [key: string]: unknown;
};
export {
  fieldLabelLocales,
  fieldLabelsSchema,
  isFieldLabelLocale,
  normalizeFieldLabels,
  resolveFieldLabel,
  type FieldLabelLocale,
  type FieldLabels,
} from "./field-labels";
export const identifier = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}$/, "Usa minúsculas, números y guion bajo.");
export const R2_ATTACHMENT_TYPE = "R2Attachment" as const;
export const FORM_HTML_TYPE = "FormHtml" as const;
export const DISPLAY_TEXT_TYPE = "DisplayText" as const;
export const supportedTypes = [
  "Textbox",
  "Textarea",
  "RichText",
  "Email",
  "Phone",
  "Url",
  "Address",
  "MapLocation",
  FORM_HTML_TYPE,
  DISPLAY_TEXT_TYPE,
  "Number",
  "Currency",
  "Percentage",
  "Rating",
  "Dropdown",
  "MultiSelect",
  "Autocomplete",
  "Toggle",
  "DateControl",
  "DateTime",
  "Time",
  R2_ATTACHMENT_TYPE,
] as const;

const contactFieldFormats = {
  Email: "email",
  Phone: "phone",
  Url: "url",
} as const;

export function fieldTextFormat(field: {
  type: string;
  config?: Record<string, unknown>;
}) {
  if (field.type in contactFieldFormats)
    return contactFieldFormats[field.type as keyof typeof contactFieldFormats];
  const format = field.config?.format;
  return typeof format === "string" ? format : undefined;
}

export function isStaticOptionField(type: string) {
  return type === "Dropdown" || type === "Autocomplete";
}
export type R2AttachmentPolicy = {
  maxFiles: number;
  maxSize: number;
  accept: string[];
};
export function r2AttachmentPolicy(
  config: Record<string, unknown> | undefined,
): R2AttachmentPolicy {
  return {
    maxFiles: typeof config?.maxFiles === "number" ? config.maxFiles : 1,
    maxSize:
      typeof config?.maxSize === "number" ? config.maxSize : 5 * 1024 * 1024,
    accept: Array.isArray(config?.accept)
      ? config.accept.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  };
}
const condition = z.object({
  field: identifier,
  op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "contains", "empty", "in"]),
  value: z.unknown().optional(),
});
const option = z.object({
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  labels: fieldLabelsSchema,
});
export const fieldSchema = z
  .object({
    type: z.enum(supportedTypes),
    label: z.string().min(1).max(100),
    labels: fieldLabelsSchema,
    required: z.boolean().optional(),
    hidden: z.boolean().optional(),
    readOnly: z.boolean().optional(),
    options: z.array(option).max(200).optional(),
    config: z
      .object({
        optionsWhen: z
          .object({
            field: identifier,
            cases: z.record(z.string(), z.array(z.string())),
          })
          .optional(),
        format: z.enum(["email", "url", "currency", "phone"]).optional(),
        unique: z.boolean().optional(),
        minimum: z.number().optional(),
        maximum: z.number().optional(),
        maxFiles: z.number().int().min(1).max(50).optional(),
        maxSize: z
          .number()
          .int()
          .min(1)
          .max(5 * 1024 * 1024)
          .optional(),
        accept: z.array(z.string().trim().min(3).max(127)).max(30).optional(),
        minLength: z.number().int().min(0).max(100000).optional(),
        maxLength: z.number().int().min(1).max(100000).optional(),
        pattern: z.string().max(200).optional(),
        integer: z.boolean().optional(),
        currency: z.string().trim().min(2).max(10).optional(),
        decimals: z.number().int().min(0).max(6).optional(),
        ratingStyle: z.enum(["stars", "number"]).optional(),
        dateTime: z.boolean().optional(),
        collectionOptions: collectionOptionsSchema.optional(),
        relation: identifier.optional(),
        collectionRelation: z.string().min(1).max(120).optional(),
        relationPresentation: z
          .enum(["selector", "subform", "table"])
          .optional(),
        relationFields: z.array(identifier).optional(),
        relationAllowCreate: z.boolean().optional(),
        relationAllowEdit: z.boolean().optional(),
        relationAllowLink: z.boolean().optional(),
        relationAllowUnlink: z.boolean().optional(),
        multiple: z.boolean().optional(),
        onDelete: z.enum(["restrict", "clear"]).optional(),
        section: identifier.optional(),
        step: identifier.optional(),
        width: z.union([z.literal(1), z.literal(2)]).optional(),
        visibleWhen: condition.optional(),
        requiredWhen: condition.optional(),
        formula: z
          .object({
            op: z.enum(["sum", "difference", "product", "ratio"]),
            fields: z.array(identifier).min(2).max(10),
          })
          .optional(),
        addressAutocomplete: addressAutocompleteConfigSchema.optional(),
        mapPicker: mapPickerConfigSchema.optional(),
        formHtml: formHtmlConfigSchema.optional(),
        displayText: displayTextConfigSchema.optional(),
        jsonSchema: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
    validate: z.array(z.unknown()).optional(),
    rules: z.array(z.unknown()).optional(),
    computedValue: z.string().optional(),
    defaultValue: z.unknown().optional(),
    description: z.string().optional(),
  })
  .passthrough();
const studio = z.object({
  history: recordHistorySettingsSchema.optional(),
  collection: collectionBindingMetadataSchema.optional(),
  capabilities: collectionCapabilitiesSchema.optional(),
  business: z
    .enum(["customer", "quotation", "managed-customer", "managed-agency"])
    .optional(),
  screen: z
    .object({
      hidden: z.boolean().optional(),
      order: z.number().int().min(0).max(9999).optional(),
      createMode: z.enum(recordSurfaces).optional(),
      editMode: z.enum(recordSurfaces).optional(),
      section: screenNavigationSectionSchema.optional(),
      icon: screenNavigationIconSchema.optional(),
    })
    .optional(),
  wizard: z
    .object({
      enabled: z.boolean(),
      presentation: z.enum(["conversation", "steps"]).optional(),
      steps: z
        .array(
          z.object({
            id: identifier,
            title: z.string().trim().min(1).max(80),
            description: z.string().max(300).optional(),
          }),
        )
        .min(2)
        .max(12),
    })
    .optional(),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  requestPage: requestPageSchema.optional(),
  sections: z
    .array(
      z.object({
        id: identifier,
        label: z.string().min(1).max(100),
        visibleWhen: condition.optional(),
      }),
    )
    .max(20)
    .optional(),
  pipeline: z
    .object({
      field: identifier,
      amountField: identifier.optional(),
      ownerField: identifier.optional(),
      wonValues: z.array(z.string()).optional(),
      lostValues: z.array(z.string()).optional(),
    })
    .optional(),
});
export const configSchema = z
  .object({
    version: z.literal(2),
    fields: z.record(z.union([identifier, z.literal("_id")]), fieldSchema),
    fieldOrder: z.array(z.union([identifier, z.literal("_id")])),
    studio: studio.optional(),
  })
  .passthrough()
  .superRefine((config, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const names = Object.keys(config.fields);
    if (names.includes("_id") && config.studio?.collection?.kind !== "mongodb")
      issue("The _id field is reserved for MongoDB collections.");
    if (config.studio?.history) {
      if (
        config.studio.collection ||
        ["managed-customer", "managed-agency"].includes(
          config.studio.business ?? "",
        )
      )
        issue("History is supported only for local collections.");
      for (const name of config.studio.history.fields)
        if (!isHistoryField(name, config.fields[name]))
          issue(`Unsupported history field: ${name}`);
    }
    if (!names.length || names.length > 100)
      issue("El objeto necesita entre 1 y 100 campos.");
    if (
      names.some(
        (n) =>
          [
            "id",
            "created_at",
            "updated_at",
            "deleted_at",
            "version",
            "constructor",
            "prototype",
            "_version",
          ].includes(n) &&
          // Postgres externo: la PK suele llamarse `id` y coincide con el
          // identificador del sobre (solo lectura, sin escrituras locales).
          !(isDatabaseKind(config.studio?.collection?.kind) && n === "id"),
      )
    )
      issue("Nombre de campo reservado.");
    if (
      new Set(config.fieldOrder).size !== names.length ||
      config.fieldOrder.length !== names.length ||
      config.fieldOrder.some((n) => !config.fields[n])
    )
      issue("El orden debe incluir cada campo una sola vez.");
    for (const [name, f] of Object.entries(config.fields)) {
      const c = f.config;
      if (c?.relationPresentation && c.relationPresentation !== "selector") {
        if (!c.collectionRelation)
          issue(
            `${f.label}: configura una relación local antes de elegir un subformulario o tabla.`,
          );
        if (c.relationPresentation === "table" && !c.multiple)
          issue(
            `${f.label}: una tabla necesita una relación de varios registros.`,
          );
        if (
          !["Textbox", "Dropdown"].includes(f.type) ||
          c.relation ||
          c.collectionOptions
        )
          issue(
            `${f.label}: esta presentación requiere un campo vinculado a una relación local.`,
          );
      }
      if (
        c?.relationFields &&
        new Set(c.relationFields).size !== c.relationFields.length
      )
        issue(`${f.label}: los campos relacionados no pueden repetirse.`);
      if (
        f.type !== R2_ATTACHMENT_TYPE &&
        f.required &&
        (f.hidden || f.readOnly) &&
        !c?.formula &&
        f.defaultValue === undefined
      )
        issue(
          `${f.label}: un campo obligatorio necesita entrada o valor predeterminado.`,
        );
      if (f.rules?.length || f.computedValue || f.validate?.length)
        issue(
          "Configura condiciones y cálculos desde las opciones de negocio. No se ejecutan reglas JavaScript.",
        );
      if (f.type === R2_ATTACHMENT_TYPE) {
        if (f.required)
          issue(`${f.label}: un archivo R2 no puede ser obligatorio.`);
        if (f.defaultValue !== undefined)
          issue(`${f.label}: un archivo R2 no admite valor predeterminado.`);
        if (
          c?.unique ||
          c?.formula ||
          c?.relation ||
          c?.optionsWhen ||
          c?.multiple ||
          c?.onDelete
        )
          issue(
            `${f.label}: un archivo R2 no admite relaciones, cálculos ni opciones de selección.`,
          );
      }
      if (f.type === FORM_HTML_TYPE) {
        if (f.required)
          issue(`${f.label}: HTML personalizado no puede ser obligatorio.`);
        if (f.defaultValue !== undefined)
          issue(
            `${f.label}: HTML personalizado no admite valor predeterminado.`,
          );
        if (
          c?.unique ||
          c?.formula ||
          c?.relation ||
          c?.optionsWhen ||
          c?.multiple ||
          c?.onDelete ||
          c?.addressAutocomplete ||
          c?.mapPicker
        )
          issue(
            `${f.label}: HTML personalizado no admite relaciones, cálculos ni autocompletado.`,
          );
        const html = c?.formHtml as
          { html?: string; script?: string } | undefined;
        if (!html?.html?.trim() && !html?.script?.trim())
          issue(`${f.label}: agrega HTML o JavaScript personalizado.`);
      }
      if (f.type === DISPLAY_TEXT_TYPE) {
        if (f.required)
          issue(`${f.label}: el texto fijo no puede ser obligatorio.`);
        if (f.defaultValue !== undefined)
          issue(`${f.label}: el texto fijo no admite valor predeterminado.`);
        if (
          c?.unique ||
          c?.formula ||
          c?.relation ||
          c?.optionsWhen ||
          c?.multiple ||
          c?.onDelete ||
          c?.addressAutocomplete ||
          c?.mapPicker ||
          c?.formHtml
        )
          issue(
            `${f.label}: el texto fijo no admite relaciones, cálculos ni HTML personalizado.`,
          );
        const display = c?.displayText as { content?: string } | undefined;
        if (!display?.content?.trim() && !f.label.trim())
          issue(`${f.label}: agrega contenido al texto fijo.`);
      }
      if (f.type !== FORM_HTML_TYPE && c?.formHtml)
        issue(
          `${f.label}: HTML personalizado solo aplica al tipo HTML personalizado.`,
        );
      if (f.type !== DISPLAY_TEXT_TYPE && c?.displayText)
        issue(`${f.label}: texto fijo solo aplica al tipo Texto fijo.`);
      if (
        c?.collectionOptions &&
        (![
          "Textbox",
          "Number",
          "Currency",
          "Dropdown",
          "Autocomplete",
        ].includes(f.type) ||
          c.relation ||
          c.optionsWhen)
      )
        issue(
          `${f.label}: la fuente de opciones requiere un campo de texto, número o selección sin otra relación.`,
        );
      if (c?.relation && f.type !== "Dropdown")
        issue(`${f.label}: una relación debe ser de tipo selección.`);
      if (f.type === "Autocomplete" && c?.relation)
        issue(`${f.label}: autocompletar no admite relaciones.`);
      if (f.type in contactFieldFormats && c?.format)
        issue(`${f.label}: el formato ya viene definido por el tipo de campo.`);
      if (f.type !== "Address" && c?.addressAutocomplete)
        issue(
          `${f.label}: el autocompletado de direcciones solo aplica al tipo Dirección.`,
        );
      if (f.type !== "MapLocation" && c?.mapPicker)
        issue(
          `${f.label}: el selector en mapa solo aplica al tipo Ubicación en mapa.`,
        );
      if (f.type === "MapLocation" && c?.addressAutocomplete)
        issue(
          `${f.label}: la ubicación en mapa no usa autocompletado de texto.`,
        );
      if (c?.optionsWhen) {
        const dependency = c.optionsWhen;
        const parent = config.fields[dependency.field];
        if (
          !isStaticOptionField(f.type) ||
          c.relation ||
          !parent ||
          !isStaticOptionField(parent.type) ||
          parent.config?.relation
        )
          issue(
            `${f.label}: la dependencia requiere dos campos de opciones estáticas.`,
          );
        for (const [parentValue, options] of Object.entries(dependency.cases)) {
          if (
            !parent?.options?.some((o) => o.value === parentValue) ||
            options.some((value) => !f.options?.some((o) => o.value === value))
          )
            issue(`${f.label}: la dependencia contiene opciones inexistentes.`);
        }
        const seen = new Set([name]);
        let next: string | undefined = dependency.field;
        while (next) {
          if (seen.has(next)) {
            issue(`${f.label}: dependencia circular entre selecciones.`);
            break;
          }
          seen.add(next);
          next = config.fields[next]?.config?.optionsWhen?.field;
        }
      }
      if (["Percentage", "Rating"].includes(f.type)) {
        if (
          c?.multiple ||
          c?.relation ||
          c?.collectionRelation ||
          c?.collectionOptions ||
          c?.dateTime ||
          c?.formula ||
          c?.format
        )
          issue(
            `${f.label}: this numeric field cannot use relation or alternate value settings.`,
          );
        if (
          f.type === "Rating" &&
          (!Number.isInteger(c?.maximum ?? 5) ||
            (c?.maximum ?? 5) < 1 ||
            (c?.maximum ?? 5) > 10 ||
            (c?.minimum !== undefined && c.minimum !== 1))
        )
          issue(
            `${f.label}: ratings require a maximum integer from 1 to 10 and a minimum of 1.`,
          );
        if (f.type === "Percentage" && (c?.minimum ?? 0) > (c?.maximum ?? 100))
          issue(`${f.label}: minimum must not exceed maximum.`);
      }
      if (
        f.type === "MultiSelect" &&
        (c?.unique ||
          c?.relation ||
          c?.collectionRelation ||
          c?.collectionOptions ||
          c?.optionsWhen ||
          c?.dateTime ||
          c?.formula)
      )
        issue(
          `${f.label}: multiple choice requires a static option list without scalar or relation settings.`,
        );
      if (
        f.type === "MultiSelect" &&
        (!f.options?.length ||
          new Set(f.options.map((o) => o.value)).size !== f.options.length)
      )
        issue(`${f.label}: provide distinct options for multiple choice.`);
      if (
        c?.multiple &&
        !c.relation &&
        !c.collectionRelation &&
        f.type !== "MultiSelect"
      )
        issue(`${f.label}: selección múltiple requiere una relación.`);
      if (c?.unique && (c.multiple || c.formula))
        issue(
          `${f.label}: unicidad solo admite valores simples no calculados.`,
        );
      if (c?.onDelete === "clear" && f.required)
        issue(
          `${f.label}: una relación obligatoria debe restringir el borrado.`,
        );
      if (
        c?.minimum !== undefined &&
        c?.maximum !== undefined &&
        c.minimum > c.maximum
      )
        issue("El mínimo no puede superar el máximo.");
      if (
        c?.minLength !== undefined &&
        c?.maxLength !== undefined &&
        c.minLength > c.maxLength
      )
        issue("La longitud mínima supera la máxima.");
      if (c?.pattern) {
        try {
          new RegExp(c.pattern, "u");
        } catch {
          issue(`${f.label}: expresión regular inválida.`);
        }
        if (/\([^)]*[+*][^)]*\)[+*{]|\\[1-9]/.test(c.pattern))
          issue(`${f.label}: patrón demasiado complejo.`);
      }
      for (const cond of [c?.visibleWhen, c?.requiredWhen])
        if (cond && !config.fields[cond.field])
          issue(`${f.label}: condición referencia un campo inexistente.`);
      if (c?.formula) {
        if (f.type !== "Number" && f.type !== "Currency")
          issue(`${f.label}: un cálculo debe ser numérico.`);
        if (
          c.formula.fields.some(
            (n) =>
              !config.fields[n] ||
              !["Number", "Currency"].includes(config.fields[n].type),
          )
        )
          issue(`${f.label}: usa campos numéricos existentes.`);
        if (
          ["difference", "ratio"].includes(c.formula.op) &&
          c.formula.fields.length !== 2
        )
          issue("Diferencia y división necesitan dos campos.");
      }
    }
    try {
      prepareRecord(
        {
          name: "validation",
          label: "",
          description: "",
          config: config as unknown as IFormConfig,
        },
        {},
      );
    } catch (e) {
      issue((e as Error).message);
    }
    const sections = config.studio?.sections ?? [];
    if (new Set(sections.map((s) => s.id)).size !== sections.length)
      issue("Las secciones deben tener identificadores distintos.");
    for (const f of Object.values(config.fields))
      if (
        f.config?.section &&
        !sections.some((s) => s.id === f.config?.section)
      )
        issue(`${f.label}: sección inexistente.`);
    for (const section of sections) {
      if (section.visibleWhen && !config.fields[section.visibleWhen.field])
        issue(
          `Sección «${section.label}»: condición referencia un campo inexistente.`,
        );
    }
    const wizard = config.studio?.wizard;
    if (wizard?.enabled) {
      const ordered = [...config.fieldOrder].sort(
        (a, b) =>
          wizard.steps.findIndex(
            (s) => s.id === config.fields[a]?.config?.step,
          ) -
          wizard.steps.findIndex(
            (s) => s.id === config.fields[b]?.config?.step,
          ),
      );
      for (const [name, field] of Object.entries(config.fields)) {
        const parent = field.config?.optionsWhen?.field;
        if (
          parent &&
          !config.fields[parent]?.hidden &&
          !config.fields[parent]?.readOnly &&
          ordered.indexOf(parent) > ordered.indexOf(name)
        )
          issue(
            `${field.label}: coloca el campo del que depende antes en el wizard.`,
          );
      }
    }
    if (wizard) {
      const steps = new Set(wizard.steps.map((s) => s.id));
      if (steps.size !== wizard.steps.length)
        issue("Los pasos del wizard deben tener identificadores distintos.");
      for (const field of Object.values(config.fields)) {
        if (field.config?.step && !steps.has(field.config.step))
          issue(`${field.label}: paso inexistente.`);
        if (wizard.enabled && !field.hidden && !field.config?.step)
          issue(`${field.label}: asigna un paso del wizard.`);
      }
      if (wizard.enabled)
        for (const step of wizard.steps)
          if (
            !Object.values(config.fields).some(
              (f) => !f.hidden && f.config?.step === step.id,
            )
          )
            issue(`${step.title}: el paso necesita al menos un campo visible.`);
    } else if (Object.values(config.fields).some((f) => f.config?.step))
      issue(
        "Los campos asignados a pasos necesitan una configuración de wizard.",
      );
    const pipeline = config.studio?.pipeline;
    if (pipeline) {
      if (
        config.fields[pipeline.field]?.type !== "Dropdown" ||
        config.fields[pipeline.field]?.config?.relation
      )
        issue("El pipeline requiere un campo de selección simple.");
      if (
        pipeline.amountField &&
        !["Number", "Currency"].includes(
          config.fields[pipeline.amountField]?.type,
        )
      )
        issue("El valor del pipeline debe ser un campo numérico.");
      if (pipeline.ownerField && !config.fields[pipeline.ownerField])
        issue("Responsable del pipeline inexistente.");
      const options =
        config.fields[pipeline.field]?.options?.map((o) => o.value) ?? [];
      if (
        [...(pipeline.wonValues ?? []), ...(pipeline.lostValues ?? [])].some(
          (v) => !options.includes(v),
        )
      )
        issue("Las etapas ganadas/perdidas deben existir.");
    }
  });
export const objectSchema = z.object({
  name: identifier,
  label: z.string().min(1).max(80),
  description: z.string().max(500).default(""),
  config: configSchema,
  version: z.number().int().positive().optional(),
});
export const fieldEntries = (object: CrmObject) =>
  (object.config.fieldOrder ?? Object.keys(object.config.fields)).map(
    (name) => [name, object.config.fields[name]] as const,
  );
export function validateRecord(
  object: CrmObject,
  input: Record<string, unknown>,
  locale?: FieldLabelLocale,
) {
  const errors: Record<string, string> = {},
    clean: Record<string, unknown> = {};
  let data: Record<string, unknown>;
  try {
    data = prepareRecord(object, input);
  } catch (e) {
    return { data: input, errors: { _form: (e as Error).message } };
  }
  for (const [name, field] of fieldEntries(object)) {
    const fieldLabel = locale ? resolveFieldLabel(field, locale) : field.label;
    if (field.type === R2_ATTACHMENT_TYPE) continue;
    if (field.type === FORM_HTML_TYPE) continue;
    if (field.type === DISPLAY_TEXT_TYPE) continue;
    const c = field.config ?? {},
      value = data[name],
      section = c.section
        ? object.config.studio?.sections?.find((s) => s.id === c.section)
        : undefined,
      sectionVisible = !c.section || isSectionVisible(section, data),
      visible =
        sectionVisible &&
        !field.hidden &&
        evaluateCondition(c.visibleWhen as Condition | undefined, data),
      required =
        visible &&
        (field.required ||
          (!!c.requiredWhen &&
            evaluateCondition(c.requiredWhen as Condition, data)));
    const empty =
      value === undefined ||
      value === null ||
      value === "" ||
      (field.type === "RichText" &&
        typeof value === "string" &&
        !value.trim()) ||
      (Array.isArray(value) && !value.length);
    if (empty) {
      if (required)
        errors[name] =
          `${fieldLabel}: ${recordValidationMessage("required", locale)}`;
      clean[name] =
        c.multiple || field.type === "MultiSelect"
          ? []
          : value === undefined && field.type === "Toggle"
            ? false
            : null;
      continue;
    }
    if (field.type === "DateTime" || c.dateTime === true) {
      if (
        typeof value !== "string" ||
        !z.iso.datetime({ offset: true }).safeParse(value).success
      )
        errors[name] =
          `${fieldLabel}: ${recordValidationMessage("dateTime", locale)}`;
      else clean[name] = new Date(value).toISOString();
      continue;
    }
    if (field.type === "Time") {
      if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
        errors[name] =
          `${fieldLabel}: ${recordValidationMessage("time", locale)}`;
      else clean[name] = value;
      continue;
    }
    if (field.type === "Percentage" || field.type === "Rating") {
      const rating = field.type === "Rating";
      const min = rating ? 1 : Number(c.minimum ?? 0);
      const max = Number(c.maximum ?? (rating ? 5 : 100));
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max ||
        (rating && !Number.isInteger(value))
      )
        errors[name] =
          `${fieldLabel}: ${recordValidationMessage(rating ? "integerRange" : "numberRange", locale, { min, max })}`;
      else if (!rating) {
        const scaled = value * 10 ** Number(c.decimals ?? 2);
        if (
          !Number.isFinite(scaled) ||
          Math.abs(scaled - Math.round(scaled)) >
            Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8
        )
          errors[name] =
            `${fieldLabel}: ${recordValidationMessage("decimals", locale, { decimals: Number(c.decimals ?? 2) })}`;
      }
      clean[name] = value;
      continue;
    }
    if (field.type === "MultiSelect") {
      const allowed = new Set(
        field.options?.map((option) => option.value) ?? [],
      );
      if (
        !Array.isArray(value) ||
        value.length > 500 ||
        value.some((item) => typeof item !== "string" || !allowed.has(item))
      )
        errors[name] =
          `${fieldLabel}: ${recordValidationMessage("options", locale)}`;
      else clean[name] = [...new Set(value)];
      continue;
    }
    if (c.multiple) {
      if (
        !Array.isArray(value) ||
        value.some((v) => typeof v !== "string") ||
        value.length > 500
      )
        errors[name] =
          `${fieldLabel}: ${recordValidationMessage("records", locale)}`;
      else clean[name] = [...new Set(value)];
      continue;
    }
    if (
      (field.type === "Number" || field.type === "Currency") &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      errors[name] =
        `${fieldLabel}: ${recordValidationMessage("number", locale)}`;
    else if (
      (field.type === "Number" || field.type === "Currency") &&
      c.integer &&
      !Number.isInteger(value)
    )
      errors[name] =
        `${fieldLabel}: ${recordValidationMessage("integer", locale)}`;
    else if (field.type === "Toggle" && typeof value !== "boolean")
      errors[name] =
        `${fieldLabel}: ${recordValidationMessage("boolean", locale)}`;
    else if (field.type === "MapLocation") {
      const location = parseMapLocation(value);
      if (!location)
        errors[name] =
          `${fieldLabel}: ${recordValidationMessage("map", locale)}`;
      else clean[name] = location;
      continue;
    } else if (
      !["Number", "Currency", "Toggle", "MapLocation"].includes(field.type) &&
      typeof value !== "string"
    )
      errors[name] =
        `${fieldLabel}: ${recordValidationMessage("text", locale)}`;
    else if (
      isStaticOptionField(field.type) &&
      !c.relation &&
      !c.collectionRelation &&
      !c.collectionOptions &&
      !availableOptions(
        field.options,
        c.optionsWhen as OptionDependency | undefined,
        data,
      ).some((o) => o.value === value)
    )
      errors[name] =
        `${fieldLabel}: ${recordValidationMessage("option", locale)}`;
    else if (
      field.type === "DateControl" &&
      (typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      errors[name] =
        `${fieldLabel}: ${recordValidationMessage("date", locale)}`;
    else if (
      fieldTextFormat(field) === "email" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))
    )
      errors[name] =
        `${fieldLabel}: ${recordValidationMessage("email", locale)}`;
    else if (
      fieldTextFormat(field) === "phone" &&
      !/^\+?[\d ()-]{5,30}$/.test(String(value))
    )
      errors[name] =
        `${fieldLabel}: ${recordValidationMessage("phone", locale)}`;
    else if (fieldTextFormat(field) === "url") {
      try {
        const u = new URL(String(value));
        if (!["https:", "http:"].includes(u.protocol)) throw 0;
      } catch {
        errors[name] =
          `${fieldLabel}: ${recordValidationMessage("url", locale)}`;
      }
    }
    if (
      typeof value === "number" &&
      ((typeof c.minimum === "number" && value < c.minimum) ||
        (typeof c.maximum === "number" && value > c.maximum))
    )
      errors[name] =
        `${fieldLabel}: ${recordValidationMessage("range", locale)}`;
    if (typeof value === "string") {
      const max =
          typeof c.maxLength === "number"
            ? c.maxLength
            : field.type === "RichText"
              ? 100000
              : 10000,
        min = typeof c.minLength === "number" ? c.minLength : 0;
      if (value.length < min || value.length > max)
        errors[name] =
          `${fieldLabel}: ${recordValidationMessage("length", locale, { min, max })}`;
      if (
        c.pattern &&
        typeof c.pattern === "string" &&
        !new RegExp(c.pattern, "u").test(value)
      )
        errors[name] =
          `${fieldLabel}: ${recordValidationMessage("pattern", locale)}`;
    }
    if (c.jsonSchema && typeof value === "string") {
      try {
        const parsed = JSON.parse(value),
          issues = validateJsonSchema({}, c.jsonSchema as any, parsed);
        if (issues.length) errors[name] = `${fieldLabel}: ${issues.join("; ")}`;
        else {
          clean[name] = JSON.stringify(parsed);
          continue;
        }
      } catch (e) {
        errors[name] =
          `${fieldLabel}: ${recordValidationMessage("json", locale, { detail: (e as Error).message })}`;
      }
    }
    if (c.validationSchema && !c.jsonSchema) {
      try {
        const issues = validateJsonSchema({}, c.validationSchema as any, value);
        if (issues.length) errors[name] = `${fieldLabel}: ${issues.join("; ")}`;
      } catch (e) {
        errors[name] = `${fieldLabel}: ${(e as Error).message}`;
      }
    }
    clean[name] = value;
  }
  for (const name of Object.keys(input))
    if (!object.config.fields[name])
      errors[name] = recordValidationMessage("unknown", locale, { name });
  return { errors, data: clean };
}
export function recordSurface(
  object: Pick<CrmObject, "config"> | undefined,
  action: "create" | "edit",
): RecordSurface {
  const screen = object?.config.studio?.screen;
  const mode = action === "create" ? screen?.createMode : screen?.editMode;
  return mode && recordSurfaces.includes(mode) ? mode : "modal";
}
export function isDrawerSurface(mode: RecordSurface): boolean {
  return mode === "drawer" || mode === "drawer-long";
}
export function makeConfig(fields: Record<string, IFieldConfig>): IFormConfig {
  return { version: 2, fields, fieldOrder: Object.keys(fields) };
}
export const stageOptions = [
  "Prospecto",
  "Calificado",
  "Propuesta",
  "Negociación",
  "Ganada",
  "Perdida",
].map((value) => ({ value, label: value }));
export function getPipeline(object: CrmObject) {
  return (
    object.config.studio?.pipeline ??
    (object.config.fields.stage?.type === "Dropdown"
      ? {
          field: "stage",
          amountField: "amount",
          ownerField: "owner",
          wonValues: ["Ganada"],
          lostValues: ["Perdida"],
        }
      : undefined)
  );
}
