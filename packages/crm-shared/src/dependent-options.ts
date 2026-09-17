export type OptionDependency = {
  field: string;
  cases: Record<string, string[]>;
};
export function availableOptions<T extends { value: unknown }>(
  options: T[] | undefined,
  dependency: OptionDependency | undefined,
  values: Record<string, unknown>,
): T[] {
  if (!dependency) return options ?? [];
  const parent = values[dependency.field];
  if (parent == null || parent === "") return [];
  const allowed = Object.hasOwn(dependency.cases, String(parent))
    ? dependency.cases[String(parent)]
    : [];
  return (options ?? []).filter((option) =>
    allowed.includes(String(option.value)),
  );
}
