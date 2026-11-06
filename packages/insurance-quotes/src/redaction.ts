const sensitiveName =
  /(token|secret|password|api[_-]?key|authorization|cookie)/i;

function redactString(value: string): string {
  return value.replace(
    /((?:token|secret|password|api[_-]?key|authorization|cookie)\s*[:=]\s*)[^,\s"'}]+/gi,
    "$1[REDACTED]",
  );
}

export function redactProviderData(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactProviderData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      sensitiveName.test(key) ? "[REDACTED]" : redactProviderData(nested),
    ]),
  );
}
