import { fail } from "./context";

export type RecordCursor = { value: string | number | null; id: string };

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
  value: string | number | null,
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
        data.value === null
      ) ||
      typeof data.id !== "string" ||
      data.id.length > 500
    )
      throw new Error();
    if (typeof data.value === "string" && data.value.length > 500)
      throw new Error();
    return { value: data.value, id: data.id };
  } catch {
    return fail(
      "El cursor no corresponde a esta consulta. Recarga la lista.",
      422,
    );
  }
}
