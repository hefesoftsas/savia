/** Parse the active locale's separators, never guess a decimal/group separator. */
export function parseLocalizedNumber(
  text: string,
  locale: string,
): number | null {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((part) => part.type === "group")?.value ?? ",";
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const raw = text.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!raw) return null;
  const integer = raw.split(decimal)[0].replace(/^[+-]/, "");
  if (integer.includes(group)) {
    const groups = integer.split(group);
    if (
      !/^\d{1,3}$/.test(groups[0]) ||
      groups.slice(1).some((value) => !/^\d{3}$/.test(value))
    )
      return null;
  }
  if (raw.split(decimal).length > 2 || raw.split(decimal)[1]?.includes(group))
    return null;
  const normalized = raw.split(group).join("").replace(decimal, ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
