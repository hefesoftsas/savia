import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError } from "@/api/api-client";
import { useAppServices } from "./assistant-context";
import {
  AssistantThreadsClient,
  type RecordingContext,
  type SyncedThread,
} from "./assistant-threads-client";
import {
  createNewThread,
  generateThreadTitle,
  loadStoredThreads,
  loadActiveThreadId,
  saveActiveThreadId,
  type StoredUIMessage,
} from "./assistant-thread-storage";

// The server is authoritative. Browser storage is read only for explicit legacy import.
export function useAssistantThreads(
  enabled: boolean,
  context?: RecordingContext,
) {
  const { apiClient, authProvider } = useAppServices();
  const client = useMemo(
    () => new AssistantThreadsClient(apiClient),
    [apiClient],
  );
  const [threads, setThreads] = useState<SyncedThread[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [epoch, setEpoch] = useState(0);
  const [userId, setUserId] = useState<string>();
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const records = useRef<SyncedThread[]>([]);
  const selectedRef = useRef<string | null>(null);
  const running = useRef(false);
  const pending = useRef<{ id: string; messages: StoredUIMessage[] } | null>(
    null,
  );
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const refreshing = useRef(false);
  const generation = useRef(0);
  const contextRef = useRef(context);
  contextRef.current = context;
  const publish = useCallback((items: SyncedThread[]) => {
    records.current = items;
    if (mounted.current) setThreads(items);
  }, []);
  const select = useCallback(
    (id: string) => {
      selectedRef.current = id;
      setSelected(id);
      if (userId) saveActiveThreadId(id, userId);
    },
    [userId],
  );
  useEffect(() => {
    mounted.current = true;
    generation.current++;
    records.current = [];
    selectedRef.current = null;
    pending.current = null;
    queue.current = Promise.resolve();
    running.current = false;
    setSaving(false);
    setThreads([]);
    setSelected(null);
    setUserId(undefined);
    setLoading(true);
    setError(null);
    let active = true;
    void authProvider
      .getIdentity?.()
      .then((identity) => {
        if (!active) return;
        if (!identity?.id) throw new Error("Sign in to load conversations");
        const id = String(identity.id);
        setUserId(id);
        setLegacyAvailable(
          loadStoredThreads(id).some((t) => t.messages.length > 0),
        );
      })
      .catch((e) => {
        if (active) {
          setError(e);
          setLoading(false);
        }
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [authProvider]);

  const refresh = useCallback(
    async (force = false) => {
      if (
        refreshing.current ||
        (!force && (running.current || pending.current))
      )
        return;
      refreshing.current = true;
      const version = generation.current;
      try {
        const items = await client.list(contextRef.current);
        if (
          !mounted.current ||
          version !== generation.current ||
          (!force && (running.current || pending.current))
        )
          return;
        const ctx = contextRef.current;
        const previouslySelected = records.current.find(
          (t) => t.id === selectedRef.current,
        );
        if (
          previouslySelected &&
          !items.some((t) => t.id === previouslySelected.id)
        ) {
          try {
            items.push(await client.get(previouslySelected.id));
          } catch (e) {
            if (!force)
              throw new ApiClientError(
                409,
                "REVISION_CONFLICT",
                "Conversation removed on another device",
              );
            selectedRef.current = null;
          }
        }
        let target = ctx
          ? items.find(
              (t) => t.context?.kind === ctx.kind && t.context.id === ctx.id,
            )
          : (items.find((t) => t.id === selectedRef.current) ??
            items.find(
              (t) => t.id === (userId && loadActiveThreadId(userId)),
            ) ??
            items[0]);
        if (!target) {
          const fresh: SyncedThread = {
            ...createNewThread(userId, ctx?.title || "Nueva conversación"),
            revision: 0,
            ...(ctx ? { context: ctx } : {}),
          };
          try {
            target = await client.save(fresh);
          } catch (e) {
            if (!(e instanceof ApiClientError) || e.status !== 409 || !ctx)
              throw e;
            target = (await client.list(ctx)).find(
              (t) => t.context?.kind === ctx.kind && t.context.id === ctx.id,
            );
            if (!target) throw e;
          }
          items.unshift(target);
        }
        const old = records.current.find((t) => t.id === target.id);
        if (!force && old && old.revision !== target.revision) {
          throw new ApiClientError(
            409,
            "REVISION_CONFLICT",
            "Conversation changed on another device",
          );
        }
        if (force) setEpoch((e) => e + 1);
        publish(items);
        select(target.id);
        pending.current = null;
        setSaving(false);
        setError(null);
      } catch (e) {
        if (mounted.current) setError(e);
      } finally {
        refreshing.current = false;
        if (mounted.current) setLoading(false);
      }
    },
    [client, publish, select, userId],
  );
  useEffect(() => {
    if (!enabled || !userId) return;
    void refresh();
    const refreshVisible = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    window.addEventListener("focus", refreshVisible);
    const timer = window.setInterval(refreshVisible, 15000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
    };
  }, [enabled, userId, context?.id, context?.kind, refresh]);

  const save = useCallback(
    (id: string, messages: StoredUIMessage[]): Promise<void> => {
      const version = generation.current;
      pending.current = { id, messages };
      setSaving(true);
      const operation = queue.current
        .catch(() => {})
        .then(async () => {
          const current = records.current.find((t) => t.id === id);
          if (!current) throw new Error("Conversation unavailable");
          const next = await client.save({
            ...current,
            messages,
            title:
              current.title === "Nueva conversación"
                ? generateThreadTitle(messages)
                : current.title,
          });
          if (version !== generation.current) return;
          publish([next, ...records.current.filter((t) => t.id !== id)]);
          if (pending.current?.messages === messages) pending.current = null;
          if (mounted.current) setError(null);
        })
        .catch((e) => {
          if (mounted.current && version === generation.current) setError(e);
          throw e;
        })
        .finally(() => {
          if (mounted.current) setSaving(Boolean(pending.current));
        });
      queue.current = operation;
      return operation;
    },
    [client, publish],
  );
  const create = useCallback(async () => {
    try {
      const next = await client.save({
        ...createNewThread(userId),
        revision: 0,
      });
      publish([next, ...records.current]);
      select(next.id);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [client, publish, select, userId]);
  const remove = useCallback(
    async (id: string) => {
      const target = records.current.find((t) => t.id === id);
      if (!target) return;
      try {
        await client.remove(target);
        publish(records.current.filter((t) => t.id !== id));
        if (selectedRef.current === id) {
          selectedRef.current = null;
          setSelected(null);
        }
        await refresh();
      } catch (e) {
        setError(e);
      }
    },
    [client, publish, refresh],
  );
  const importLegacy = useCallback(async () => {
    if (!userId) return;
    setSaving(true);
    try {
      for (const old of loadStoredThreads(userId).filter(
        (t) => t.messages.length,
      )) {
        // Stable mapping also makes import safe to repeat from the same browser.
        const bytes = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(`${userId}:${old.id}`),
          ),
        );
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        const hex = Array.from(bytes.slice(0, 16), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        try {
          await client.save({
            ...old,
            id,
            revision: 0,
            messages: old.messages.filter((m) => m.role !== "system"),
          });
        } catch (e) {
          if (!(e instanceof ApiClientError) || e.status !== 409) throw e;
        }
      }
      setLegacyAvailable(false);
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }, [client, refresh, userId]);
  const retry = () =>
    pending.current
      ? save(pending.current.id, pending.current.messages).catch(() => {})
      : refresh(true);
  const activeThread = threads.find((t) => t.id === selected) ?? null;
  const visibleThread =
    activeThread && pending.current?.id === activeThread.id
      ? { ...activeThread, messages: pending.current.messages }
      : activeThread;
  return {
    threads,
    activeThread: visibleThread,
    loading,
    saving,
    error,
    conflict: error instanceof ApiClientError && error.status === 409,
    epoch,
    legacyAvailable,
    importLegacy,
    save,
    select,
    create,
    remove,
    refresh,
    retry,
    setRunning: useCallback((busy: boolean) => {
      running.current = busy;
    }, []),
  };
}
