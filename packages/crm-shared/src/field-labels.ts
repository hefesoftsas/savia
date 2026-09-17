import { z } from "zod";

export const fieldLabelLocales = ["es", "en", "pt"] as const;

export type FieldLabelLocale = (typeof fieldLabelLocales)[number];

export const fieldLabelsSchema = z
  .object({
    es: z.string().trim().min(1).max(100).optional(),
    en: z.string().trim().min(1).max(100).optional(),
    pt: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .optional();

export type FieldLabels = NonNullable<z.infer<typeof fieldLabelsSchema>>;

export type FieldLabelSource = {
  label: string;
  labels?: FieldLabels | null;
};

export function isFieldLabelLocale(value: string): value is FieldLabelLocale {
  return (fieldLabelLocales as readonly string[]).includes(value);
}

export function normalizeFieldLabels(
  labels: FieldLabels | undefined,
): FieldLabels | undefined {
  if (!labels) return undefined;
  const next: FieldLabels = {};
  for (const locale of fieldLabelLocales) {
    const value = labels[locale]?.trim();
    if (value) next[locale] = value;
  }
  return Object.keys(next).length ? next : undefined;
}

export function resolveFieldLabel(
  field: FieldLabelSource,
  locale: FieldLabelLocale = "es",
): string {
  if (locale === "es") {
    return field.labels?.es?.trim() || field.label;
  }
  const localized = field.labels?.[locale]?.trim();
  return localized || field.label;
}
