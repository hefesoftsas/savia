import {
  translatePluginMessage,
  type PluginLocale,
  type PluginMessages,
} from "./plugin-localization";
import { z } from "zod";
import type { CrmObject } from "./metadata";

export const FORM_HTML_TYPE = "FormHtml" as const;

export const formHtmlConfigSchema = z
  .object({
    html: z.string().max(100_000).default(""),
    translations: z
      .object({
        es: z.string().max(100_000).optional(),
        en: z.string().max(100_000).optional(),
        pt: z.string().max(100_000).optional(),
      })
      .strict()
      .optional(),
    script: z.string().max(100_000).optional(),
  })
  .strict();

export type FormHtmlConfig = z.infer<typeof formHtmlConfigSchema>;

export type FormHtmlTemplateScope = {
  values: Record<string, unknown>;
  recordId?: string;
  object?: Pick<CrmObject, "name" | "label">;
};

export type FormHtmlRuntimeContext = {
  locale: PluginLocale;
  t: (
    catalog: PluginMessages,
    key: string,
    params?: Record<string, string | number>,
  ) => string;
  values: Readonly<Record<string, unknown>>;
  getValue: (name: string) => unknown;
  setValue: (name: string, value: unknown) => void;
  fields: Readonly<Record<string, { label: string; type: string }>>;
  object: { name: string; label: string };
  recordId?: string;
  container: HTMLElement;
};

export function resolveFormHtml(
  config: Record<string, unknown> | undefined,
): FormHtmlConfig | null {
  if (!config?.formHtml) return null;
  const parsed = formHtmlConfigSchema.safeParse(config.formHtml);
  return parsed.success ? parsed.data : null;
}

export function formatFormHtmlValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return value.map(formatFormHtmlValue).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function escapeFormHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveTemplateExpression(
  expression: string,
  scope: FormHtmlTemplateScope,
): string {
  const path = expression.trim();
  if (!path) return "";
  if (path.startsWith("values.")) {
    return formatFormHtmlValue(scope.values[path.slice("values.".length)]);
  }
  if (path === "record.id") return scope.recordId ?? "";
  if (path === "object.name") return scope.object?.name ?? "";
  if (path === "object.label") return scope.object?.label ?? "";
  if (Object.hasOwn(scope.values, path)) {
    return formatFormHtmlValue(scope.values[path]);
  }
  return "";
}

export function renderFormHtmlTemplate(
  template: string,
  scope: FormHtmlTemplateScope,
): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expression: string) =>
    escapeFormHtmlText(resolveTemplateExpression(expression, scope)),
  );
}

export function sanitizeFormHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/data:text\/html/gi, "");
}

const blockedScriptPatterns = [
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bimport\s*\(/,
  /\brequire\s*\(/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\bwindow\b/,
  /\bdocument\b/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
];

export function validateFormHtmlScript(script: string): string | null {
  const trimmed = script.trim();
  if (!trimmed) return null;
  for (const pattern of blockedScriptPatterns) {
    if (pattern.test(trimmed)) {
      return "El script usa APIs no permitidas. Usa ctx (values, getValue, setValue, container).";
    }
  }
  return null;
}

export function buildFormHtmlRuntimeContext({
  values,
  setValue,
  object,
  recordId,
  container,
  locale = "es",
}: {
  values: Record<string, unknown>;
  setValue: (name: string, value: unknown) => void;
  object?: CrmObject;
  recordId?: string;
  container: HTMLElement;
  locale?: PluginLocale;
}): FormHtmlRuntimeContext {
  const fieldMeta = Object.fromEntries(
    Object.entries(object?.config.fields ?? {}).map(([name, field]) => [
      name,
      { label: field.label, type: field.type },
    ]),
  );
  return {
    locale,
    t: (catalog, key, params) =>
      translatePluginMessage(catalog, key, locale, params),
    values,
    getValue: (name) => values[name],
    setValue: (name, value) => {
      if (!Object.hasOwn(fieldMeta, name)) {
        throw new Error(`Campo desconocido: ${name}`);
      }
      setValue(name, value);
    },
    fields: fieldMeta,
    object: {
      name: object?.name ?? "",
      label: object?.label ?? "",
    },
    recordId,
    container,
  };
}

export function runFormHtmlScript(
  script: string,
  ctx: FormHtmlRuntimeContext,
): void {
  const blocked = validateFormHtmlScript(script);
  if (blocked) throw new Error(blocked);
  const runner = new Function(
    "ctx",
    `"use strict";
const values = ctx.values;
const getValue = ctx.getValue.bind(ctx);
const setValue = ctx.setValue.bind(ctx);
const fields = ctx.fields;
const object = ctx.object;
const recordId = ctx.recordId;
const container = ctx.container;
${script}`,
  );
  runner(ctx);
}

export function resolveSavinaSetValueAction(
  target: EventTarget | null,
  values: Record<string, unknown>,
): { field: string; value: unknown } | null {
  if (!(target instanceof Element)) return null;
  const node = target.closest("[data-savia-set-value]");
  if (!(node instanceof HTMLElement)) return null;
  const field = node.getAttribute("data-savia-set-value")?.trim();
  if (!field) return null;
  const raw = node.getAttribute("data-savia-value");
  if (raw === null) return { field, value: "" };
  if (raw.startsWith("field:")) {
    return { field, value: values[raw.slice(6)] ?? "" };
  }
  return { field, value: raw };
}
