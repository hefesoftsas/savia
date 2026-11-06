import { fail } from "./context";

export type RecordCursorValue =
  | string
  | number
  | null
  | { rank: 0 | 1 | 2; number: string | number; text: string };
export type RecordCursor = { value: RecordCursorValue; id: string };

function validCursorText(value: string): boolean {
  if (value.length > 500) return false;
  for (const point of value) {
    const code = point.codePointAt(0)!;
    if (code === 0 || (code >= 0xd800 && code <= 0xdfff)) return false;
  }
  return true;
}

function validCursorNumber(value: unknown): value is string | number {
  if (typeof value === "number")
    return (
      Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value))
    );
  return (
    typeof value === "string" &&
    value.length <= 3000 &&
    /^-?\d+(?:\.\d+)?$/.test(value)
  );
}

export async function paginationScope(values: unknown[]): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(values)),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function encodeRecordCursor(
  scope: string,
  value: RecordCursorValue,
  id: string,
): string {
  return btoa(
    String.fromCharCode(
      ...new TextEncoder().encode(JSON.stringify({ scope, value, id })),
    ),
  );
}
export function decodeRecordCursor(token: string, scope: string): RecordCursor {
  try {
    if (token.length > 4096) throw new Error();
    const data = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(token), (c) => c.charCodeAt(0)),
      ),
    );
    if (
      data.scope !== scope ||
      !(
        typeof data.value === "string" ||
        (typeof data.value === "number" && Number.isFinite(data.value)) ||
        data.value === null ||
        (data.value !== null &&
          typeof data.value === "object" &&
          !Array.isArray(data.value) &&
          Object.keys(data.value).sort().join(",") === "number,rank,text" &&
          [0, 1, 2].includes(data.value.rank) &&
          validCursorNumber(data.value.number) &&
          typeof data.value.text === "string" &&
          validCursorText(data.value.text))
      ) ||
      typeof data.id !== "string" ||
      data.id.length > 500
    )
      throw new Error();
    if (typeof data.value === "string" && !validCursorText(data.value))
      throw new Error();
    if (data.value && typeof data.value === "object")
      if (
        !validCursorNumber(data.value.number) ||
        !validCursorText(data.value.text)
      )
        throw new Error();
    return { value: data.value, id: data.id };
  } catch {
    return fail(
      "El cursor no corresponde a esta consulta. Recarga la lista.",
      422,
    );
  }
}
