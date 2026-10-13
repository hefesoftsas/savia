import { NonRetryableError } from "cloudflare:workflows";

export const MAX_RUNTIME_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_RUNTIME_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MAX_EXECUTION_STATE_BYTES = 4 * 1024 * 1024;

/** Count serialized UTF-8 JSON without allocating a copy or a queue of children. */
export function estimateRuntimeJsonBytes(
  value: unknown,
  maxBytes: number,
): number {
  let bytes = 0;
  const active = new WeakSet<object>();
  const add = (amount: number) => {
    bytes += amount;
    return bytes <= maxBytes;
  };
  const string = (text: string): void => {
    if (!add(2)) return;
    for (let i = 0; i < text.length && bytes <= maxBytes; i++) {
      const code = text.charCodeAt(i);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code))
        add(2);
      else if (code < 32) add(6);
      else if (code < 128) add(1);
      else if (code < 2048) add(2);
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        text.charCodeAt(i + 1) >= 0xdc00 &&
        text.charCodeAt(i + 1) <= 0xdfff
      ) {
        add(4);
        i++;
      } else if (code >= 0xd800 && code <= 0xdfff) add(6);
      else add(3);
    }
  };
  const visit = (item: unknown, depth: number): void => {
    if (bytes > maxBytes) return;
    if (item === null) {
      add(4);
      return;
    }
    if (typeof item === "string") {
      string(item);
      return;
    }
    if (typeof item === "number") {
      add(Number.isFinite(item) ? String(item).length : 4);
      return;
    }
    if (typeof item === "boolean") {
      add(item ? 4 : 5);
      return;
    }
    if (typeof item !== "object") {
      add(8);
      return;
    }
    if (depth >= 100 || active.has(item)) {
      bytes = maxBytes + 1;
      return;
    }
    if (item instanceof Date) {
      visit(item.toJSON(), depth + 1);
      return;
    }
    // Arbitrary toJSON methods can allocate or serialize more than their fields.
    if (typeof (item as { toJSON?: unknown }).toJSON === "function") {
      bytes = maxBytes + 1;
      return;
    }
    active.add(item);
    add(2);
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length && bytes <= maxBytes; i++) {
        if (i) add(1);
        visit(item[i], depth + 1);
      }
    } else {
      let first = true;
      for (const key in item) {
        if (bytes > maxBytes) break;
        if (!Object.hasOwn(item, key)) continue;
        if (!first) add(1);
        first = false;
        string(key);
        add(1);
        visit((item as Record<string, unknown>)[key], depth + 1);
      }
    }
    active.delete(item);
  };
  visit(value, 0);
  return bytes;
}

export function assertRuntimeValueWithinLimit(
  value: unknown,
  maxBytes: number,
  label: string,
): void {
  if (estimateRuntimeJsonBytes(value, maxBytes) > maxBytes) {
    throw new NonRetryableError(`${label} exceeds the ${maxBytes}-byte limit`);
  }
}
