import {
  resolveOptionLabel,
  type FieldLabels,
  type FieldLabelLocale,
} from "@savia/studio-shared/field-labels";
/** Resolve presentation labels without changing the record's stored option values. */
export function recordOptionLabel(
  value: unknown,
  options?: readonly {
    value: unknown;
    label: unknown;
    labels?: FieldLabels | null;
  }[],
  locale: FieldLabelLocale = "es",
): unknown {
  if (!options?.length || value === null || value === undefined) return value;
  if (Array.isArray(value))
    return value.map((item) => recordOptionLabel(item, options, locale));
  const option = options.find(
    (option) => String(option.value) === String(value),
  );
  return option ? resolveOptionLabel(option, locale) : value;
}
