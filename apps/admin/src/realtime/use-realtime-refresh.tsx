import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeTopics, type RealtimeChangeEvent } from "./use-realtime";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { accessMessages } from "@/i18n/locales/access";

/** Coalesce hints and preserve editable state until the user explicitly reloads. */
export function useRealtimeRefresh({
  topics,
  tenantId,
  enabled = true,
  blocked = false,
  refresh,
  accepts,
}: {
  topics: string[];
  tenantId?: number;
  enabled?: boolean;
  blocked?: boolean;
  refresh: () => void | Promise<unknown>;
  accepts?: (event: RealtimeChangeEvent) => boolean;
}) {
  const [changed, setChanged] = useState(false);
  const latest = useRef({ blocked, refresh, accepts });
  latest.current = { blocked, refresh, accepts };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scope = `${enabled}:${tenantId ?? "self"}:${[...topics].sort().join(",")}`;
  const generation = useRef(0);
  const connected = useRef(false);
  useEffect(() => {
    generation.current++;
    connected.current = false;
    setChanged(false);
    return () => {
      generation.current++;
      clearTimeout(timer.current);
    };
  }, [scope]);
  const reload = useCallback(async () => {
    clearTimeout(timer.current);
    const token = generation.current;
    try {
      await latest.current.refresh();
      if (token === generation.current) setChanged(false);
    } catch {
      if (token === generation.current) setChanged(true);
    }
  }, []);
  const wasBlocked = useRef(blocked);
  useEffect(() => {
    const released = wasBlocked.current && !blocked;
    wasBlocked.current = blocked;
    if (released && changed && enabled) void reload();
  }, [blocked, changed, enabled, reload]);
  const schedule = () => {
    if (!enabled) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (latest.current.blocked) setChanged(true);
      else void reload();
    }, 200);
  };
  const { status } = useRealtimeTopics({
    topics,
    tenantId,
    enabled,
    onConnected: () => {
      const reconnect = connected.current;
      connected.current = true;
      // Opening a screen already loads its read model. The first socket
      // acknowledgement is not a change hint; refreshing here fans out into
      // account/identity events and puts visible UI back into loading states.
      // Later acknowledgements catch up after a connection gap.
      if (reconnect) schedule();
    },
    onEvent: (event) => {
      if (!latest.current.accepts || latest.current.accepts(event)) schedule();
    },
  });
  return { changed, reload, status };
}

export function RemoteChangesNotice({
  changed,
  reload,
}: {
  changed: boolean;
  reload: () => void | Promise<unknown>;
}) {
  const t = useMessages(accessMessages);
  if (!changed) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b py-3 text-sm"
    >
      <p>
        {t("Changes arrived from another session. Your edits are preserved.")}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void reload()}
      >
        {t("Reload and discard draft")}
      </Button>
    </div>
  );
}
