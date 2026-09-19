/** Resolve presentation labels without changing the record's stored option values. */
export function recordOptionLabel(
  value: unknown,
  options?: readonly { value: unknown; label: unknown }[],
): unknown {
  if (!options?.length || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => recordOptionLabel(item, options));
  return options.find((option) => String(option.value) === String(value))?.label ?? value;
}
