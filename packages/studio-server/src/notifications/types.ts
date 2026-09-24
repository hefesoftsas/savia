import type {
  InboxPage,
  InboxQuery,
  NoticeActionState,
  NoticeEventInput,
  NoticeScope,
  NoticeSource,
  NoticeView,
} from "@savia/studio-shared/notifications";

export type { InboxPage, InboxQuery, NoticeActionState, NoticeEventInput, NoticeScope, NoticeSource, NoticeView };

export interface DeliveryRow {
  id: string;
  event_id: string;
  scope_kind: string;
  scope_id: string;
  recipient_id: string;
  created_at: number;
  read_at: number | null;
  archived_at: number | null;
}

export function stableEventId(input: NoticeEventInput): string {
  const seed = `${input.scope.kind}|${input.scope.id}|${input.key}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `ntf_${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortValue(v)]),
    );
  }
  return value;
}

export function canonicalPayload(input: NoticeEventInput): string {
  return JSON.stringify(sortValue(input));
}

export function encodeCursor(createdAt: number, id: string): string {
  return btoa(JSON.stringify([createdAt, id]))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeCursor(cursor: string): [number, string] | null {
  try {
    const padded = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const [createdAt, id] = JSON.parse(
      atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)),
    );
    if (typeof createdAt === "number" && typeof id === "string") return [createdAt, id];
    return null;
  } catch {
    return null;
  }
}
