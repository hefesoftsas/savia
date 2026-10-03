import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { PagesClient, type PageSummary } from "./client";
import { subscribePageChanges } from "./page-events";

export function usePagesIndex(api: ApiClient, enabled = true, query = "") {
  const client = useMemo(() => new PagesClient(api), [api]);
  const initial = useMemo(
    () => (enabled ? client.cachedList(query) : undefined),
    [client, enabled, query],
  );
  const [pages, setPages] = useState<PageSummary[]>(() => initial ?? []);
  const [loading, setLoading] = useState(enabled && initial === undefined);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const loaded = useRef(initial !== undefined);
  const refresh = useCallback(
    async (force = true) => {
      const current = ++request.current;
      setLoading(!loaded.current);
      try {
        const result = await client.list(query, force);
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
    },
    [client, query],
  );
  useEffect(() => {
    const cached = enabled ? client.cachedList(query) : undefined;
    loaded.current = cached !== undefined;
    setPages(cached ?? []);
    setError(false);
    setLoading(enabled && !loaded.current);
    // Browsing has no artificial delay. Only search input is debounced.
    const timer =
      enabled && query ? setTimeout(() => void refresh(false), 200) : undefined;
    if (enabled && !query) void refresh(false);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [enabled, refresh, client, query]);
  useEffect(
    () =>
      subscribePageChanges((change) => {
        if (change.api !== api || !enabled) return;
        if (query || !loaded.current || (!change.page && !change.removedId)) {
          void refresh();
          return;
        }
        request.current++;
        setLoading(false);
        setError(false);
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
    [api, enabled, query, refresh],
  );
  return { client, pages, setPages, loading, error, refresh };
}
