/** Conservative limit for binary values crossing the Flows runtime/R2 boundary. */
export const MAX_OBJECT_BYTES = 8 * 1024 * 1024;

/** Shared bounded traversal; no serialized copies or sibling queues. */
export { estimateRuntimeJsonBytes as estimateJsonBytes } from "@savia/flows-runtime";
import { estimateRuntimeJsonBytes as estimateJsonBytes } from "@savia/flows-runtime";

export function assertJsonWithinLimit(
  value: unknown,
  maxBytes: number,
  label: string,
): void {
  const estimatedBytes = estimateJsonBytes(value, maxBytes);
  if (estimatedBytes > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
  }
}

export function assertObjectWithinLimit(
  byteLength: number,
  label = "Object",
): void {
  if (byteLength > MAX_OBJECT_BYTES) {
    throw new Error(
      `${label} exceeds the ${MAX_OBJECT_BYTES}-byte limit (${byteLength} bytes)`,
    );
  }
}
