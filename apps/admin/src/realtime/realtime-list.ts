import type { QueryClient } from "@tanstack/react-query";
import type { RealtimeChangeEvent } from "./use-realtime";

type ListPage = {
  data: unknown[];
  total?: number;
};

function rowId(row: unknown): string | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const id = (row as { id?: unknown }).id;
  return id === undefined || id === null ? undefined : String(id);
}

/**
 * Applies a realtime hint to cached `getList` queries (`{ data, total }`)
 * with the least work possible:
 * - `deleted` with an id removes the row surgically — no network at all;
 * - anything else (creates, updates, hints without id, unknown shapes)
 *   invalidates the single affected prefix so exactly one refetch happens.
 *
 * Never throws: on any doubt it falls back to invalidating.
 */
export function applyRealtimeListEvent(
  queryClient: QueryClient,
  queryKeyPrefix: string,
  event: RealtimeChangeEvent,
): void {
  const invalidate = () => {
    void queryClient
      .invalidateQueries({ queryKey: [queryKeyPrefix] })
      .catch(() => undefined);
  };
  try {
    if (event.type !== "deleted" || event.id === undefined) {
      invalidate();
      return;
    }
    const targetId = String(event.id);
    let removed = false;
    queryClient.setQueriesData<ListPage>({ queryKey: [queryKeyPrefix] }, (previous) => {
      if (!previous || !Array.isArray(previous.data)) return previous;
      const data = previous.data.filter((row) => rowId(row) !== targetId);
      if (data.length === previous.data.length) return previous;
      removed = true;
      return {
        ...previous,
        data,
        ...(typeof previous.total === "number"
          ? { total: previous.total - (previous.data.length - data.length) }
          : {}),
      };
    });
    if (!removed) invalidate();
  } catch {
    invalidate();
  }
}
