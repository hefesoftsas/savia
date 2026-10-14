import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError } from "@/api/api-client";
import { isReadAccessDenied } from "@/queries/read-state";
import { useAppServices } from "./assistant-context";
import {
  AssistantThreadsClient,
  type AssistantThreadSummary,
  type RecordingContext,
  type SyncedThread,
} from "./assistant-threads-client";
import {
  createNewThread,
  extractThreadPreview,
  generateThreadTitle,
  loadStoredThreads,
  loadActiveThreadId,
  saveActiveThreadId,
  type StoredUIMessage,
} from "./assistant-thread-storage";

function summarizeThread(thread: SyncedThread): AssistantThreadSummary {
  return {
    id: thread.id,
    userId: thread.userId,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    revision: thread.revision,
    context: thread.context,
    messageCount: thread.messages.length,
    preview: extractThreadPreview(thread),
  };
}

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
  const [threads, setThreads] = useState<AssistantThreadSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [epoch, setEpoch] = useState(0);
  const [userId, setUserId] = useState<string>();
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const records = useRef<AssistantThreadSummary[]>([]);
  const [activeRecord, setActiveRecordState] = useState<SyncedThread | null>(
    null,
  );
  const activeRecordRef = useRef<SyncedThread | null>(null);
  const selectedRef = useRef<string | null>(null);
  const running = useRef(false);
  const pending = useRef<{ id: string; messages: StoredUIMessage[] } | null>(
    null,
  );
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const refreshRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  const generation = useRef(0);
  const contextRef = useRef(context);
  contextRef.current = context;
  const publish = useCallback((items: AssistantThreadSummary[]) => {
    records.current = items;
    if (mounted.current) setThreads(items);
  }, []);
  const setActiveRecord = useCallback((thread: SyncedThread | null) => {
    activeRecordRef.current = thread;
    if (mounted.current) setActiveRecordState(thread);
  }, []);
  const clearDeniedRead = useCallback(
    (readError: unknown) => {
      if (!isReadAccessDenied(readError)) return false;
      // Invalidate in-flight list/detail reads before clearing every protected
      // view so a late response cannot repopulate state after access is denied.
      generation.current++;
      records.current = [];
      publish([]);
      setActiveRecord(null);
      selectedRef.current = null;
      setSelected(null);
      pending.current = null;
      setLoading(false);
      setSaving(false);
      setError(readError);
      return true;
    },
    [publish, setActiveRecord],
  );
  const select = useCallback(
    (id: string) => {
      selectedRef.current = id;
      setSelected(id);
      if (userId) saveActiveThreadId(id, userId);
      const summary = records.current.find((thread) => thread.id === id);
      const cached = activeRecordRef.current;
      if (
        !summary ||
        (cached?.id === id && cached.revision === summary.revision)
      )
        return;
      if (cached?.id === id && cached.revision !== summary.revision) {
        setError(
          new ApiClientError(
            409,
            "REVISION_CONFLICT",
            "Conversation changed on another device",
          ),
        );
        return;
      }
      setLoading(true);
      const version = generation.current;
      void client
        .get(id)
        .then((thread) => {
          if (
            !mounted.current ||
            version !== generation.current ||
            selectedRef.current !== id
          )
            return;
          setActiveRecord(thread);
          setError(null);
        })
        .catch((e) => {
          if (
            mounted.current &&
            version === generation.current &&
            selectedRef.current === id
          ) {
            if (!clearDeniedRead(e)) setError(e);
          }
        })
        .finally(() => {
          if (
            mounted.current &&
            version === generation.current &&
            selectedRef.current === id
          )
            setLoading(false);
        });
    },
    [clearDeniedRead, client, setActiveRecord, userId],
  );
  useEffect(() => {
    mounted.current = true;
    generation.current++;
    records.current = [];
    activeRecordRef.current = null;
    setActiveRecordState(null);
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
      if (refreshing.current) {
        if (force) refreshAgain.current = true;
        return;
      }
      if (!force && (running.current || pending.current)) return;
      refreshing.current = true;
      if (force) setLoading(true);
      const version = generation.current;
      const read = async <T>(request: Promise<T>): Promise<T> => {
        try {
          return await request;
        } catch (readError) {
          if (mounted.current && version === generation.current)
            clearDeniedRead(readError);
          throw readError;
        }
      };
      try {
        const items = await read(client.list(contextRef.current));
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
          if (ctx) {
            if (!force)
              throw new ApiClientError(
                409,
                "REVISION_CONFLICT",
                "Conversation changed in the active workspace",
              );
            selectedRef.current = null;
            setSelected(null);
            setActiveRecord(null);
          } else {
            try {
              const previousDetail = await read(
                client.get(previouslySelected.id),
              );
              if (
                !mounted.current ||
                version !== generation.current ||
                (!force && (running.current || pending.current))
              )
                return;
              items.push(summarizeThread(previousDetail));
            } catch (e) {
              if (isReadAccessDenied(e)) throw e;
              if (!force)
                throw new ApiClientError(
                  409,
                  "REVISION_CONFLICT",
                  "Conversation removed on another device",
                );
              selectedRef.current = null;
            }
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
            const created = await client.save(fresh);
            if (
              !mounted.current ||
              version !== generation.current ||
              (!force && (running.current || pending.current))
            )
              return;
            target = summarizeThread(created);
            setActiveRecord(created);
          } catch (e) {
            if (!(e instanceof ApiClientError) || e.status !== 409 || !ctx)
              throw e;
            const refreshed = await read(client.list(ctx));
            if (
              !mounted.current ||
              version !== generation.current ||
              (!force && (running.current || pending.current))
            )
              return;
            target = refreshed.find(
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
        let selectedDetail = activeRecordRef.current;
        if (
          selectedDetail?.id !== target.id ||
          selectedDetail.revision !== target.revision
        ) {
          selectedDetail = await read(client.get(target.id));
          if (
            !mounted.current ||
            version !== generation.current ||
            (!force && (running.current || pending.current))
          )
            return;
          const detailSummary = summarizeThread(selectedDetail);
          const targetIndex = items.findIndex((item) => item.id === target.id);
          if (targetIndex >= 0) items[targetIndex] = detailSummary;
        }
        if (
          !mounted.current ||
          version !== generation.current ||
          (!force && (running.current || pending.current))
        )
          return;
        if (force) setEpoch((e) => e + 1);
        publish(items);
        setActiveRecord(selectedDetail);
        select(target.id);
        pending.current = null;
        setSaving(false);
        setError(null);
      } catch (e) {
        if (mounted.current && version === generation.current) setError(e);
      } finally {
        refreshing.current = false;
        if (mounted.current) setLoading(false);
        if (refreshAgain.current) {
          refreshAgain.current = false;
          queueMicrotask(() => void refreshRef.current?.(true));
        }
      }
    },
    [clearDeniedRead, client, publish, select, setActiveRecord, userId],
  );
  refreshRef.current = refresh;
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

  useEffect(() => {
    if (!enabled || !context) return;
    const handleTenantChange = () => {
      generation.current++;
      if (pending.current || running.current) {
        setError(
          new ApiClientError(
            409,
            "REVISION_CONFLICT",
            "Active workspace changed while this conversation had unsaved messages",
          ),
        );
        return;
      }
      selectedRef.current = null;
      setSelected(null);
      setActiveRecord(null);
      if (refreshing.current) {
        refreshAgain.current = true;
        return;
      }
      void refresh(true);
    };
    window.addEventListener("savia:active-tenant-changed", handleTenantChange);
    return () =>
      window.removeEventListener(
        "savia:active-tenant-changed",
        handleTenantChange,
      );
  }, [enabled, context?.id, context?.kind, refresh, setActiveRecord]);

  const save = useCallback(
    (id: string, messages: StoredUIMessage[]): Promise<void> => {
      const version = generation.current;
      pending.current = { id, messages };
      setSaving(true);
      const operation = queue.current
        .catch(() => {})
        .then(async () => {
          const current = activeRecordRef.current;
          if (current?.id !== id) throw new Error("Conversation unavailable");
          const next = await client.save({
            ...current,
            messages,
            title:
              current.title === "Nueva conversación"
                ? generateThreadTitle(messages)
                : current.title,
          });
          if (version !== generation.current) return;
          publish([
            summarizeThread(next),
            ...records.current.filter((t) => t.id !== id),
          ]);
          setActiveRecord(next);
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
    [client, publish, setActiveRecord],
  );
  const create = useCallback(async () => {
    try {
      const next = await client.save({
        ...createNewThread(userId),
        revision: 0,
      });
      publish([summarizeThread(next), ...records.current]);
      setActiveRecord(next);
      select(next.id);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [client, publish, select, setActiveRecord, userId]);
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
          setActiveRecord(null);
        }
        await refresh();
      } catch (e) {
        setError(e);
      }
    },
    [client, publish, refresh, setActiveRecord],
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
  const activeThread = activeRecord?.id === selected ? activeRecord : null;
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
