import { useCallback, useEffect, useRef, useState } from "react";
import type { PagesClient } from "@/features/pages/client";
import { subscribePageChanges } from "@/features/pages/page-events";
import {
  PageSearchResults,
  type PageSearchResult,
} from "@/features/pages/page-search-results";
import { pagesMessages } from "@/features/pages/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n/core";
import { tenantPagesSearchMessages } from "./messages";

type Status = {
  enabled: boolean;
  available: boolean;
  total: number;
  indexed: number;
  needed: string[];
};
type Result = PageSearchResult & { score: number };

export function PagesCloudflareSearch({ client }: { client: PagesClient }) {
  const t = useMessages(tenantPagesSearchMessages);
  const pagesT = useMessages(pagesMessages);
  const [status, setStatus] = useState<Status>();
  const [statusError, setStatusError] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [searchComplete, setSearchComplete] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ done: 0, total: 0 });
  const [indexError, setIndexError] = useState(false);
  const refreshRef = useRef(0);
  const searchRef = useRef(0);
  const indexRef = useRef(0);
  const statusAbortRef = useRef<AbortController | undefined>(undefined);
  const searchAbortRef = useRef<AbortController | undefined>(undefined);
  const indexAbortRef = useRef<AbortController | undefined>(undefined);

  const refreshStatus = useCallback(async () => {
    const request = ++refreshRef.current;
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    try {
      const { data } = await client.api.get<{ data: Status }>(
        "/v1/pages/search/status",
        { signal: controller.signal },
      );
      if (request !== refreshRef.current) return;
      setStatus(data);
      setStatusError(false);
    } catch {
      if (controller.signal.aborted || request !== refreshRef.current) return;
      setStatusError(true);
    }
  }, [client]);

  useEffect(() => {
    void refreshStatus();
    const invalidate = () => {
      indexRef.current += 1;
      indexAbortRef.current?.abort();
      setIndexing(false);
      searchRef.current += 1;
      searchAbortRef.current?.abort();
      setSearching(false);
      setResults([]);
      void refreshStatus();
    };
    const unsubscribe = subscribePageChanges((change) => {
      if (change.api === client.api) invalidate();
    });
    window.addEventListener("focus", invalidate);
    return () => {
      refreshRef.current += 1;
      searchRef.current += 1;
      indexRef.current += 1;
      unsubscribe();
      window.removeEventListener("focus", invalidate);
      statusAbortRef.current?.abort();
      searchAbortRef.current?.abort();
      indexAbortRef.current?.abort();
    };
  }, [client, refreshStatus]);

  useEffect(() => {
    const request = ++searchRef.current;
    searchAbortRef.current?.abort();
    setResults([]);
    setSearchComplete(false);
    setSearchError(false);
    setSearching(false);
    if (!status?.enabled || !status.available || !query.trim()) return;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      setSearching(true);
      const parameters = new URLSearchParams({ q: query.trim() });
      void client.api
        .get<{ data: Result[] }>(`/v1/pages/search?${parameters}`, {
          signal: controller.signal,
        })
        .then(({ data }) => {
          if (request === searchRef.current) {
            setResults(data);
            setSearchComplete(true);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted && request === searchRef.current)
            setSearchError(true);
        })
        .finally(() => {
          if (request === searchRef.current) setSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [client, query, status?.available, status?.enabled]);

  async function updateIndex() {
    if (!status?.enabled || !status.available || indexing) return;
    const request = ++indexRef.current;
    const controller = new AbortController();
    indexAbortRef.current = controller;
    const needed = status.needed;
    setIndexing(true);
    setIndexError(false);
    setIndexProgress({ done: 0, total: needed.length });
    try {
      for (const [index, id] of needed.entries()) {
        if (controller.signal.aborted || request !== indexRef.current) return;
        await client.api.post(
          `/v1/pages/search/index/${encodeURIComponent(id)}`,
          {},
          { signal: controller.signal },
        );
        if (controller.signal.aborted || request !== indexRef.current) return;
        setIndexProgress({ done: index + 1, total: needed.length });
      }
      if (!controller.signal.aborted && request === indexRef.current)
        await refreshStatus();
    } catch {
      if (!controller.signal.aborted && request === indexRef.current)
        setIndexError(true);
    } finally {
      if (request === indexRef.current) setIndexing(false);
    }
  }

  function cancelIndexing() {
    indexRef.current += 1;
    indexAbortRef.current?.abort();
    setIndexing(false);
  }

  if (!status && !statusError) return null;
  if (status && !status.enabled) return null;

  return (
    <section
      className="mb-4 grid gap-3 rounded-md border p-3"
      aria-label={t("Page search")}
    >
      {statusError && !status ? (
        <p role="alert" className="text-sm text-destructive">
          {t("Page search settings load failed")}
        </p>
      ) : null}
      {status?.enabled && !status.available ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("Cloudflare search unavailable")}
        </p>
      ) : null}
      {status?.enabled && status.available ? (
        <>
          <label className="grid gap-1 text-sm font-medium">
            {t("Search pages by meaning")}
            <Input
              aria-label={t("Search pages by meaning")}
              placeholder={t("Semantic page search query")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" role="status">
              {t("Pages sent for indexing", {
                indexed: status.indexed,
                total: status.total,
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={indexing || status.needed.length === 0}
                onClick={() => void updateIndex()}
              >
                {t("Update page search index")}
              </Button>
              {indexing ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelIndexing}
                >
                  {t("Cancel indexing")}
                </Button>
              ) : null}
            </div>
          </div>
          {indexing ? (
            <p role="status" aria-live="polite">
              {t("Indexing pages", indexProgress)}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {t("Index updates can take a few seconds")}
          </p>
          {indexError ? <p role="alert">{t("Page indexing failed")}</p> : null}
          {searching ? <p role="status">{t("Searching pages")}</p> : null}
          {searchError ? (
            <p role="alert">{t("Semantic page search failed")}</p>
          ) : null}
          {searchComplete && !searchError && query.trim() ? (
            <PageSearchResults
              pages={results}
              query={query}
              empty={pagesT("No results")}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
