import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { PagesClient, type PageSummary } from "./client";
import { subscribePageChanges } from "./page-events";

export function usePagesIndex(api: ApiClient, enabled = true) {
  const client = useMemo(() => new PagesClient(api), [api]);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const loaded = useRef(false);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const result = await client.list();
      if (current === request.current) {
        loaded.current = true;
        setPages(result);
        setError(false);
      }
    } catch {
      if (current === request.current) setError(true);
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    if (enabled) void refresh();
    return () => {
      request.current++;
    };
  }, [enabled, refresh]);
  useEffect(
    () =>
      subscribePageChanges((change) => {
        if (change.api !== api) return;
        if (!loaded.current) {
          void refresh();
          return;
        }
        request.current++;
        setLoading(false);
        setPages((current) =>
          change.removedId
            ? current.filter((page) => page.id !== change.removedId)
            : change.page
              ? current.some((page) => page.id === change.page!.id)
                ? current.map((page) =>
                    page.id === change.page!.id ? change.page! : page,
                  )
                : [...current, change.page]
              : current,
        );
      }),
    [api, refresh],
  );
  return { client, pages, loading, error, refresh };
}
