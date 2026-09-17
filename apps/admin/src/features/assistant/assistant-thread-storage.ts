export interface StoredMessagePart {
  type: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  output?: unknown;
  [key: string]: unknown;
}

export interface StoredUIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: StoredMessagePart[];
  metadata?: unknown;
}

export interface AssistantThreadRecord {
  id: string;
  userId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredUIMessage[];
}

const STORAGE_PREFIX = "savia.assistant.threads";
const ACTIVE_THREAD_PREFIX = "savia.assistant.active_thread";
const MAX_STORED_THREADS = 50;

function resolveStorageKey(prefix: string, userId?: string): string {
  const safeId = userId && userId.trim() ? userId.trim() : "default";
  return `${prefix}:${safeId}`;
}

export function generateThreadTitle(
  messages: StoredUIMessage[],
  fallback = "Nueva conversación",
): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return fallback;
  }

  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser || !Array.isArray(firstUser.parts)) {
    return fallback;
  }

  const textPart = firstUser.parts.find(
    (p) => p.type === "text" && typeof p.text === "string" && p.text.trim().length > 0,
  );

  if (!textPart?.text) {
    return fallback;
  }

  const cleaned = textPart.text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 48) {
    return cleaned;
  }
  return `${cleaned.slice(0, 45)}…`;
}

export function createNewThread(
  userId?: string,
  title = "Nueva conversación",
): AssistantThreadRecord {
  const now = new Date().toISOString();
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    userId,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function loadStoredThreads(userId?: string): AssistantThreadRecord[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }

  try {
    const key = resolveStorageKey(STORAGE_PREFIX, userId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const valid = parsed.filter(
      (item): item is AssistantThreadRecord =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        Array.isArray(item.messages),
    );

    return valid.sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });
  } catch {
    return [];
  }
}

export function saveStoredThread(
  thread: AssistantThreadRecord,
  userId?: string,
): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const key = resolveStorageKey(STORAGE_PREFIX, userId);
    const current = loadStoredThreads(userId);
    const index = current.findIndex((t) => t.id === thread.id);

    const updatedThread: AssistantThreadRecord = {
      ...thread,
      updatedAt: new Date().toISOString(),
      title:
        thread.title === "Nueva conversación" && thread.messages.length > 0
          ? generateThreadTitle(thread.messages)
          : thread.title,
    };

    let nextList: AssistantThreadRecord[];
    if (index >= 0) {
      nextList = [
        updatedThread,
        ...current.slice(0, index),
        ...current.slice(index + 1),
      ];
    } else {
      nextList = [updatedThread, ...current];
    }

    if (nextList.length > MAX_STORED_THREADS) {
      nextList = nextList.slice(0, MAX_STORED_THREADS);
    }

    window.localStorage.setItem(key, JSON.stringify(nextList));
  } catch {
    // Fail silently if quota exceeded or storage blocked
  }
}

export function deleteStoredThread(threadId: string, userId?: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const key = resolveStorageKey(STORAGE_PREFIX, userId);
    const current = loadStoredThreads(userId);
    const filtered = current.filter((t) => t.id !== threadId);
    window.localStorage.setItem(key, JSON.stringify(filtered));

    const activeKey = resolveStorageKey(ACTIVE_THREAD_PREFIX, userId);
    const activeId = window.localStorage.getItem(activeKey);
    if (activeId === threadId) {
      window.localStorage.removeItem(activeKey);
    }
  } catch {
    // Ignore storage errors
  }
}

export function clearStoredThreads(userId?: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const key = resolveStorageKey(STORAGE_PREFIX, userId);
    window.localStorage.removeItem(key);
    const activeKey = resolveStorageKey(ACTIVE_THREAD_PREFIX, userId);
    window.localStorage.removeItem(activeKey);
  } catch {
    // Ignore storage errors
  }
}

export function loadActiveThreadId(userId?: string): string | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const key = resolveStorageKey(ACTIVE_THREAD_PREFIX, userId);
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveActiveThreadId(threadId: string, userId?: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const key = resolveStorageKey(ACTIVE_THREAD_PREFIX, userId);
    window.localStorage.setItem(key, threadId);
  } catch {
    // Ignore storage errors
  }
}

export function formatRelativeTime(dateIso: string): string {
  try {
    const date = new Date(dateIso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (Number.isNaN(diffMs)) return "Reciente";

    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return "Ahora";
    if (diffMinutes < 60) return `Hace ${diffMinutes} min`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `Hace ${diffHours} h`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Ayer";
    if (diffDays < 7) return `Hace ${diffDays} d`;

    return date.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "Reciente";
  }
}

export type TimelineGroup = "Hoy" | "Ayer" | "Esta semana" | "Anteriores";

export function groupThreadsByTimeline(
  threads: AssistantThreadRecord[],
): Array<{ group: TimelineGroup; items: AssistantThreadRecord[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfThisWeek = startOfToday - 6 * 86400000;

  const hoy: AssistantThreadRecord[] = [];
  const ayer: AssistantThreadRecord[] = [];
  const estaSemana: AssistantThreadRecord[] = [];
  const anteriores: AssistantThreadRecord[] = [];

  for (const thread of threads) {
    const time = new Date(thread.updatedAt || thread.createdAt).getTime();
    if (time >= startOfToday) {
      hoy.push(thread);
    } else if (time >= startOfYesterday) {
      ayer.push(thread);
    } else if (time >= startOfThisWeek) {
      estaSemana.push(thread);
    } else {
      anteriores.push(thread);
    }
  }

  const result: Array<{ group: TimelineGroup; items: AssistantThreadRecord[] }> = [];
  if (hoy.length > 0) result.push({ group: "Hoy", items: hoy });
  if (ayer.length > 0) result.push({ group: "Ayer", items: ayer });
  if (estaSemana.length > 0) result.push({ group: "Esta semana", items: estaSemana });
  if (anteriores.length > 0) result.push({ group: "Anteriores", items: anteriores });

  return result;
}

export function extractThreadPreview(thread: AssistantThreadRecord): string {
  if (!thread.messages || thread.messages.length === 0) {
    return "Sin mensajes";
  }

  const lastMessage = thread.messages[thread.messages.length - 1];
  if (!lastMessage || !Array.isArray(lastMessage.parts)) {
    return "Conversación en curso";
  }

  const textPart = lastMessage.parts.find((p) => p.type === "text" && p.text);
  if (textPart?.text) {
    const clean = textPart.text.replace(/\s+/g, " ").trim();
    return clean.length > 70 ? `${clean.slice(0, 67)}…` : clean;
  }

  const toolPart = lastMessage.parts.find((p) => p.type === "tool-call");
  if (toolPart?.toolName) {
    return `Consulta: ${toolPart.toolName.replace(/^savia_/, "")}`;
  }

  return "Conversación en curso";
}
