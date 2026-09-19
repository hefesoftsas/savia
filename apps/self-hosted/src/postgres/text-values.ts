import { DatabaseInputError } from "@savia/db/errors";
function unsupported(value: string): boolean {
  for (const point of value) {
    const code = point.codePointAt(0)!;
    if (code === 0 || (code >= 0xd800 && code <= 0xdfff)) return true;
  }
  return false;
}
/** PostgreSQL text/jsonb cannot preserve NUL or lone UTF-16 surrogates. */
export function assertPostgresText(value: string): void {
  if (unsupported(value)) throw new DatabaseInputError();
  if (!/\\u(?:0000|d[89a-f])/i.test(value)) return;
  try {
    JSON.parse(value);
  } catch {
    return;
  }
  // Inspect every string token: JSON.parse discards overwritten duplicate keys.
  for (const match of value.matchAll(/"(?:[^"\\]|\\[\s\S])*"/g)) {
    if (unsupported(JSON.parse(match[0]) as string))
      throw new DatabaseInputError();
  }
}
