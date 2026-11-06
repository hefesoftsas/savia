import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useRealtimeTopics } from "./use-realtime";
import { scheduleReadInvalidation } from "./read-invalidation";

/** Preserve editable drafts while hints refresh precise shared query keys. */
export function useRealtimeQuery({
  topics,
  tenantId,
  enabled = true,
  queryKeys,
  blocked = false,
  refreshOnInitialConnect = false,
}: {
  topics: string[];
  tenantId?: number;
  enabled?: boolean;
  queryKeys: readonly QueryKey[];
  blocked?: boolean;
  refreshOnInitialConnect?: boolean;
}) {
  const client = useQueryClient();
  const [changed, setChanged] = useState(false);
  const generation = useRef(0);
  const latest = useRef({ queryKeys, blocked, enabled });
  latest.current = { queryKeys, blocked, enabled };
  const scope = JSON.stringify([
    enabled,
    tenantId,
    [...topics].sort(),
    queryKeys,
  ]);
  useEffect(() => {
    generation.current += 1;
    setChanged(false);
    return () => {
      generation.current += 1;
    };
  }, [scope]);
  const refresh = async (immediate = false) => {
    const token = generation.current;
    try {
      await scheduleReadInvalidation(client, latest.current.queryKeys, {
        immediate,
      });
      if (token === generation.current) setChanged(false);
    } catch {
      if (token === generation.current) setChanged(true);
    }
  };
  const schedule = () => {
    if (!latest.current.enabled) return;
    if (latest.current.blocked) setChanged(true);
    else void refresh();
  };
  const wasBlocked = useRef(blocked);
  useEffect(() => {
    const released = wasBlocked.current && !blocked;
    wasBlocked.current = blocked;
    if (released && changed && enabled) void refresh();
  }, [blocked, changed, enabled]);
  const { status } = useRealtimeTopics({
    topics,
    tenantId,
    enabled,
    onEvent: schedule,
    onConnected: (reason) => {
      if (reason === "recovered") schedule();
      else if (
        reason === "initial" &&
        refreshOnInitialConnect &&
        !latest.current.blocked
      )
        schedule();
    },
  });
  return { changed, reload: () => refresh(true), status };
}
