import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppearancePreferences,
  SidebarNavigationLayout,
} from "@/api/user-preferences-client";
import { useAppServices } from "@/features/assistant/assistant-context";
import { useOnlineStatus } from "@/offline/use-online-status";
import {
  canQueue,
  discardOutboxOp,
  enqueueOutboxOp,
  flushOutbox,
  listOutboxOps,
  requeueOutboxOp,
  type OutboxOp,
  type OutboxTable,
} from "./outbox";
import { isOfflineError } from "./offline-error";

/**
 * Offline mutation queue for eligible resources (personal preferences).
 * Applies locally first (callers already do), then either sends immediately
 * or queues when offline. Flushes automatically on reconnect; failures
 * never retry alone — the user retries or discards explicitly.
 */
export function useOutbox(table?: OutboxTable) {
  const { userPreferences } = useAppServices();
  const online = useOnlineStatus();
  const [ops, setOps] = useState<OutboxOp[]>([]);
  const [flushing, setFlushing] = useState(false);
  const flushingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setOps(await listOutboxOps(table));
    } catch {
      // IndexedDB unavailable: queue silently disabled.
    }
  }, [table]);

  const execute = useCallback(
    async (op: OutboxOp) => {
      if (
        op.resource === "user-preferences" &&
        op.action === "save-appearance"
      ) {
        await userPreferences.saveAppearance(
          op.payload as AppearancePreferences,
        );
        return;
      }
      if (op.resource === "user-preferences" && op.action === "save-sidebar") {
        await userPreferences.saveSidebarNavigation(
          op.payload as SidebarNavigationLayout,
        );
        return;
      }
      throw new Error(`Unsupported outbox op ${op.resource}:${op.action}`);
    },
    [userPreferences],
  );

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setFlushing(true);
    try {
      await flushOutbox(execute, table);
    } finally {
      flushingRef.current = false;
      setFlushing(false);
      await refresh();
    }
  }, [execute, refresh, table]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  const saveOrQueue = useCallback(
    async (
      resource: string,
      action: string,
      payload: unknown,
      direct: () => Promise<unknown>,
    ): Promise<void> => {
      try {
        await direct();
      } catch (error) {
        if (!isOfflineError(error) || !canQueue(resource, action)) throw error;
        await enqueueOutboxOp({ resource, action, payload }, table);
        await refresh();
      }
    },
    [refresh, table],
  );

  const retry = useCallback(
    async (id: number) => {
      await requeueOutboxOp(id, table);
      await refresh();
      await flush();
    },
    [flush, refresh, table],
  );

  const discard = useCallback(
    async (id: number) => {
      await discardOutboxOp(id, table);
      await refresh();
    },
    [refresh, table],
  );

  return {
    ops,
    pendingCount: ops.length,
    flushing,
    flush,
    refresh,
    retry,
    discard,
    saveOrQueue,
  };
}
