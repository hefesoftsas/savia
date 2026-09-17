import { beforeEach, describe, expect, it } from "vitest";
import {
  createNewThread,
  deleteStoredThread,
  extractThreadPreview,
  formatRelativeTime,
  generateThreadTitle,
  groupThreadsByTimeline,
  loadActiveThreadId,
  loadStoredThreads,
  saveActiveThreadId,
  saveStoredThread,
  type AssistantThreadRecord,
} from "./assistant-thread-storage";

describe("assistant-thread-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("creates a thread with a unique id and timestamp", () => {
    const thread = createNewThread("user-1");
    expect(thread.id).toBeDefined();
    expect(thread.userId).toBe("user-1");
    expect(thread.title).toBe("Nueva conversación");
    expect(thread.messages).toEqual([]);
  });

  it("generates a title from the first user text message", () => {
    const title = generateThreadTitle([
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "¿Cuántos clientes tenemos en Medellín?" }],
      },
    ]);
    expect(title).toBe("¿Cuántos clientes tenemos en Medellín?");
  });

  it("truncates long titles cleanly with ellipsis", () => {
    const title = generateThreadTitle([
      {
        id: "1",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Quisiera ver un informe detallado con la lista de todas las cotizaciones pendientes de aprobación durante este mes",
          },
        ],
      },
    ]);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(48);
  });

  it("falls back to default title if no text part is present", () => {
    expect(generateThreadTitle([])).toBe("Nueva conversación");
    expect(
      generateThreadTitle([
        {
          id: "1",
          role: "assistant",
          parts: [{ type: "text", text: "Hola" }],
        },
      ]),
    ).toBe("Nueva conversación");
  });

  it("saves, loads, and updates threads in localStorage", () => {
    const thread1 = createNewThread("user-123");
    thread1.messages = [
      {
        id: "msg-1",
        role: "user",
        parts: [{ type: "text", text: "Resumen de ventas" }],
      },
    ];

    saveStoredThread(thread1, "user-123");

    const loaded = loadStoredThreads("user-123");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(thread1.id);
    expect(loaded[0].title).toBe("Resumen de ventas");

    // Updating existing thread
    thread1.messages.push({
      id: "msg-2",
      role: "assistant",
      parts: [{ type: "text", text: "Aquí está el resumen." }],
    });
    saveStoredThread(thread1, "user-123");

    const reloaded = loadStoredThreads("user-123");
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].messages).toHaveLength(2);
  });

  it("deletes a thread and clears active thread if matching", () => {
    const thread = createNewThread("user-1");
    saveStoredThread(thread, "user-1");
    saveActiveThreadId(thread.id, "user-1");

    expect(loadActiveThreadId("user-1")).toBe(thread.id);

    deleteStoredThread(thread.id, "user-1");
    expect(loadStoredThreads("user-1")).toHaveLength(0);
    expect(loadActiveThreadId("user-1")).toBeNull();
  });

  it("formats relative times cleanly in Spanish", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("Ahora");

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinutesAgo)).toBe("Hace 5 min");

    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe("Hace 2 h");

    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    expect(formatRelativeTime(yesterday)).toBe("Ayer");
  });

  it("groups threads into timeline categories", () => {
    const now = new Date();
    const todayThread: AssistantThreadRecord = {
      id: "t1",
      title: "Hoy thread",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      messages: [],
    };

    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    const yesterdayThread: AssistantThreadRecord = {
      id: "t2",
      title: "Ayer thread",
      createdAt: yesterday.toISOString(),
      updatedAt: yesterday.toISOString(),
      messages: [],
    };

    const grouped = groupThreadsByTimeline([todayThread, yesterdayThread]);
    expect(grouped.some((g) => g.group === "Hoy")).toBe(true);
    expect(grouped.some((g) => g.group === "Ayer")).toBe(true);
  });

  it("extracts a thread preview from the last message", () => {
    const emptyThread = createNewThread();
    expect(extractThreadPreview(emptyThread)).toBe("Sin mensajes");

    const activeThread: AssistantThreadRecord = {
      ...emptyThread,
      messages: [
        {
          id: "m1",
          role: "assistant",
          parts: [{ type: "text", text: "Lista de 15 clientes activos" }],
        },
      ],
    };
    expect(extractThreadPreview(activeThread)).toBe("Lista de 15 clientes activos");
  });
});
