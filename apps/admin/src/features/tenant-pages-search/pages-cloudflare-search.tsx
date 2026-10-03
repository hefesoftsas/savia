import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, FileText, Folder, Info, Search } from "lucide-react";
import { ApiClientError } from "@/api/api-client";
import type { PagesClient, PageSummary } from "@/features/pages/client";
import { subscribePageChanges } from "@/features/pages/page-events";
import {
  PageSearchResultContent,
  type PageSearchResult,
} from "@/features/pages/page-search-results";
import { pagesMessages } from "@/features/pages/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMessages } from "@/i18n/core";
import { tenantPagesSearchMessages } from "./messages";

type Status = {
  enabled: boolean;
  available: boolean;
  total: number;
  indexed: number;
  needed: string[];
};
type Result = PageSearchResult & { score?: number };
const MAX_BUSY_DEFERRALS = 20;

function mergeResults(lexical: PageSummary[], semantic: Result[]) {
  const seen = new Set<string>();
  const merged: Result[] = [];
  for (const result of [...lexical, ...semantic]) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    merged.push(result);
    if (merged.length === 9) break;
  }
  return merged;
}

function batchKey(needed: string[]) {
  return [...needed].sort().join("\u0000");
}

export function PagesCloudflareSearch({ client }: { client: PagesClient }) {
  const t = useMessages(tenantPagesSearchMessages);
  const pagesT = useMessages(pagesMessages);
  const navigate = useNavigate();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>();
  const [statusError, setStatusError] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [indexInfoOpen, setIndexInfoOpen] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchComplete, setSearchComplete] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [semanticError, setSemanticError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searchRevision, setSearchRevision] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ done: 0, total: 0 });
  const [indexError, setIndexError] = useState(false);
  const [indexPaused, setIndexPaused] = useState(false);
  const [indexWaiting, setIndexWaiting] = useState(false);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const refreshRef = useRef(0);
  const searchRef = useRef(0);
  const indexRef = useRef(0);
  const statusAbortRef = useRef<AbortController | undefined>(undefined);
  const searchAbortRef = useRef<AbortController | undefined>(undefined);
  const indexAbortRef = useRef<AbortController | undefined>(undefined);
  const indexingRef = useRef(false);
  const completedBatchRef = useRef("");
  const failedBatchRef = useRef("");
  const busyDeferredKeyRef = useRef("");
  const busyDeferralsRef = useRef(0);
  const pageChangeTimerRef = useRef<number | undefined>(undefined);
  const delayedStatusTimerRef = useRef<number | undefined>(undefined);
  const busyTimerRef = useRef<number | undefined>(undefined);

  const refreshStatus = useCallback(async () => {
    const request = ++refreshRef.current;
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    setStatusRefreshing(true);
    try {
      const { data } = await client.api.get<{ data: Status }>(
        "/v1/pages/search/status",
        { signal: controller.signal },
      );
      if (request !== refreshRef.current) return;
      setStatus(data);
      setStatusError(false);
      if (!data.enabled || !data.available) setIndexInfoOpen(false);
    } catch {
      if (controller.signal.aborted || request !== refreshRef.current) return;
      setStatusError(true);
      setIndexInfoOpen(false);
    } finally {
      if (request === refreshRef.current) setStatusRefreshing(false);
    }
  }, [client]);

  const indexBatch = useCallback(
    async (needed: string[]) => {
      if (!needed.length || indexingRef.current) return;
      if (delayedStatusTimerRef.current) {
        window.clearTimeout(delayedStatusTimerRef.current);
        delayedStatusTimerRef.current = undefined;
      }
      const request = ++indexRef.current;
      const controller = new AbortController();
      const key = batchKey(needed);
      indexAbortRef.current = controller;
      indexingRef.current = true;
      setIndexing(true);
      setIndexError(false);
      setIndexWaiting(false);
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
        if (!controller.signal.aborted && request === indexRef.current) {
          completedBatchRef.current = key;
          failedBatchRef.current = "";
          busyDeferralsRef.current = 0;
          busyDeferredKeyRef.current = "";
          await refreshStatus();
          if (delayedStatusTimerRef.current)
            window.clearTimeout(delayedStatusTimerRef.current);
          delayedStatusTimerRef.current = window.setTimeout(async () => {
            delayedStatusTimerRef.current = undefined;
            await refreshStatus();
            if (!controller.signal.aborted && request === indexRef.current)
              setSearchRevision((revision) => revision + 1);
          }, 1800);
        }
      } catch (failure) {
        if (!controller.signal.aborted && request === indexRef.current) {
          if (
            failure instanceof ApiClientError &&
            failure.status === 409 &&
            failure.code === "INDEX_IN_PROGRESS"
          ) {
            busyDeferralsRef.current += 1;
            if (busyDeferralsRef.current <= MAX_BUSY_DEFERRALS) {
              busyDeferredKeyRef.current = key;
              setIndexWaiting(true);
              busyTimerRef.current = window.setTimeout(async () => {
                busyTimerRef.current = undefined;
                busyDeferredKeyRef.current = "";
                setIndexWaiting(false);
                await refreshStatus();
              }, 5000);
            } else {
              busyDeferredKeyRef.current = "";
              failedBatchRef.current = key;
              setIndexError(true);
            }
          } else {
            failedBatchRef.current = key;
            setIndexError(true);
          }
        }
      } finally {
        if (request === indexRef.current) {
          indexingRef.current = false;
          setIndexing(false);
        }
      }
    },
    [client, refreshStatus],
  );

  useEffect(() => {
    void refreshStatus();
    const invalidate = () => {
      if (pageChangeTimerRef.current) return;
      pageChangeTimerRef.current = window.setTimeout(() => {
        pageChangeTimerRef.current = undefined;
        if (delayedStatusTimerRef.current) {
          window.clearTimeout(delayedStatusTimerRef.current);
          delayedStatusTimerRef.current = undefined;
        }
        if (busyTimerRef.current) {
          window.clearTimeout(busyTimerRef.current);
          busyTimerRef.current = undefined;
        }
        busyDeferredKeyRef.current = "";
        busyDeferralsRef.current = 0;
        setIndexWaiting(false);
        completedBatchRef.current = "";
        indexRef.current += 1;
        indexAbortRef.current?.abort();
        indexingRef.current = false;
        setIndexing(false);
        searchRef.current += 1;
        searchAbortRef.current?.abort();
        setSearching(false);
        setResults([]);
        setSearchComplete(false);
        setSearchRevision((revision) => revision + 1);
        void refreshStatus();
      }, 120);
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
      if (pageChangeTimerRef.current)
        window.clearTimeout(pageChangeTimerRef.current);
      if (delayedStatusTimerRef.current)
        window.clearTimeout(delayedStatusTimerRef.current);
      if (busyTimerRef.current) window.clearTimeout(busyTimerRef.current);
    };
  }, [client, refreshStatus]);

  useEffect(() => {
    if (
      !status?.enabled ||
      !status.available ||
      statusRefreshing ||
      indexPaused
    )
      return;
    const needed = status.needed;
    const key = batchKey(needed);
    if (!needed.length) {
      busyDeferralsRef.current = 0;
      busyDeferredKeyRef.current = "";
      if (busyTimerRef.current) {
        window.clearTimeout(busyTimerRef.current);
        busyTimerRef.current = undefined;
      }
      setIndexWaiting(false);
      return;
    }
    if (busyDeferredKeyRef.current && busyDeferredKeyRef.current !== key) {
      busyDeferredKeyRef.current = "";
      busyDeferralsRef.current = 0;
      if (busyTimerRef.current) {
        window.clearTimeout(busyTimerRef.current);
        busyTimerRef.current = undefined;
      }
      setIndexWaiting(false);
    }
    if (
      indexingRef.current ||
      key === completedBatchRef.current ||
      key === failedBatchRef.current ||
      key === busyDeferredKeyRef.current
    )
      return;
    void indexBatch(needed);
  }, [indexBatch, indexPaused, status, statusRefreshing]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    const term = query.trim();
    const request = ++searchRef.current;
    searchAbortRef.current?.abort();
    setResults([]);
    setSearchComplete(false);
    setSearchError(false);
    setSemanticError(false);
    setSearching(false);
    setActiveIndex(-1);
    if (!term) return;

    const controller = new AbortController();
    searchAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      setSearching(true);
      const parameters = new URLSearchParams({ q: term });
      const lexical = client.api.get<{ data: PageSummary[] }>(
        `/v1/pages?${parameters}`,
        { signal: controller.signal },
      );
      const semanticEnabled = status?.enabled && status.available;
      const semantic = semanticEnabled
        ? client.api.get<{ data: Result[] }>(`/v1/pages/search?${parameters}`, {
            signal: controller.signal,
          })
        : undefined;
      let lexicalResults: PageSummary[] = [];
      let semanticResults: Result[] = [];
      let lexicalFailed = false;
      let semanticFailed = false;
      const updatePartialResults = () => {
        if (request !== searchRef.current || controller.signal.aborted) return;
        setActiveIndex(-1);
        setResults(mergeResults(lexicalResults, semanticResults));
      };
      const tasks = [
        lexical.then(
          ({ data }) => {
            lexicalResults = data;
            updatePartialResults();
          },
          () => {
            lexicalFailed = true;
          },
        ),
      ];
      if (semantic)
        tasks.push(
          semantic.then(
            ({ data }) => {
              semanticResults = data;
              updatePartialResults();
            },
            () => {
              semanticFailed = true;
            },
          ),
        );
      void Promise.all(tasks)
        .then(() => {
          if (request !== searchRef.current || controller.signal.aborted)
            return;
          setResults(mergeResults(lexicalResults, semanticResults));
          setSearchError(lexicalFailed && !semanticResults.length);
          setSemanticError(semanticFailed);
          setSearchComplete(true);
        })
        .finally(() => {
          if (request === searchRef.current) setSearching(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [client, query, searchRevision, status?.available, status?.enabled]);

  function pauseIndexing() {
    setIndexPaused(true);
    indexRef.current += 1;
    indexAbortRef.current?.abort();
    indexingRef.current = false;
    setIndexing(false);
    setIndexWaiting(false);
    busyDeferredKeyRef.current = "";
    busyDeferralsRef.current = 0;
    if (busyTimerRef.current) {
      window.clearTimeout(busyTimerRef.current);
      busyTimerRef.current = undefined;
    }
  }

  function resumeIndexing() {
    setIndexPaused(false);
  }

  function retryIndexing() {
    if (!status?.enabled || !status.available || !status.needed.length) return;
    failedBatchRef.current = "";
    busyDeferredKeyRef.current = "";
    busyDeferralsRef.current = 0;
    setIndexWaiting(false);
    if (busyTimerRef.current) {
      window.clearTimeout(busyTimerRef.current);
      busyTimerRef.current = undefined;
    }
    setIndexPaused(false);
    void indexBatch(status.needed);
  }

  const popoverOpen = open && !!query.trim();
  const selectedId =
    activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined;

  return (
    <section className="pages-search-area" aria-label={t("Page search")}>
      <div className="pages-search-combobox" ref={rootRef}>
        <Search size={16} aria-hidden />
        <Input
          aria-label={pagesT("Search pages")}
          placeholder={pagesT("Search hint")}
          value={query}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={popoverOpen}
          aria-controls={popoverOpen ? listId : undefined}
          aria-activedescendant={popoverOpen ? selectedId : undefined}
          onFocus={() => setOpen(true)}
          onBlur={(event) => {
            if (!rootRef.current?.contains(event.relatedTarget as Node | null))
              setOpen(false);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              setActiveIndex(-1);
              return;
            }
            if (event.key === "ArrowDown" && popoverOpen && results.length) {
              event.preventDefault();
              const next = (activeIndex + 1) % results.length;
              setActiveIndex(next);
              window.requestAnimationFrame(() =>
                document
                  .getElementById(`${listId}-option-${next}`)
                  ?.scrollIntoView?.({ block: "nearest" }),
              );
            }
            if (event.key === "ArrowUp" && popoverOpen && results.length) {
              event.preventDefault();
              const next =
                activeIndex <= 0 ? results.length - 1 : activeIndex - 1;
              setActiveIndex(next);
              window.requestAnimationFrame(() =>
                document
                  .getElementById(`${listId}-option-${next}`)
                  ?.scrollIntoView?.({ block: "nearest" }),
              );
            }
            if (
              event.key === "Enter" &&
              popoverOpen &&
              activeIndex >= 0 &&
              results[activeIndex]
            ) {
              event.preventDefault();
              navigate(`/pages/${encodeURIComponent(results[activeIndex].id)}`);
              setOpen(false);
            }
          }}
        />
        {status?.enabled && status.available && !statusError ? (
          <Tooltip open={indexInfoOpen} onOpenChange={setIndexInfoOpen}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("Page indexing information")}
                onFocus={() => setOpen(false)}
                onClick={() => {
                  setOpen(false);
                  setIndexInfoOpen(true);
                }}
              >
                <Info size={18} aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-[min(320px,calc(100vw-32px))] space-y-2 text-left"
            >
              <p>
                {t("Pages sent for indexing", {
                  indexed: status.indexed,
                  total: status.total,
                })}
              </p>
              <p>{t("Pages are indexed automatically")}</p>
            </TooltipContent>
          </Tooltip>
        ) : null}
        {popoverOpen ? (
          <div className="pages-search-popover">
            {searchComplete && results.length > 0 ? (
              <p className="pages-search-suggestion-count" role="status">
                {t("Showing page suggestions", { count: results.length })}
              </p>
            ) : null}
            <ul id={listId} role="listbox" aria-label={t("Search suggestions")}>
              {searching ? (
                <li role="presentation">
                  <p className="pages-search-popover-message" role="status">
                    {t("Searching pages")}
                  </p>
                </li>
              ) : null}
              {results.map((result, index) => (
                <li
                  key={result.id}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={activeIndex === index}
                  className={activeIndex === index ? "is-active" : undefined}
                  onMouseMove={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    navigate(`/pages/${encodeURIComponent(result.id)}`);
                    setOpen(false);
                  }}
                >
                  {result.kind === "folder" ? (
                    <Folder size={18} aria-hidden />
                  ) : (
                    <FileText size={18} aria-hidden />
                  )}
                  <PageSearchResultContent page={result} query={query} />
                  <ChevronRight size={14} aria-hidden />
                </li>
              ))}
              {searchComplete && results.length === 0 && !searchError ? (
                <li role="presentation">
                  <p className="pages-search-popover-message" role="status">
                    {t("No page search matches")}
                  </p>
                </li>
              ) : null}
              {searchError ? (
                <li role="presentation">
                  <p className="pages-search-popover-message" role="alert">
                    {t("Page search failed")}
                  </p>
                </li>
              ) : null}
              {semanticError && searchComplete && !searchError ? (
                <li role="presentation">
                  <p className="pages-search-popover-note" role="status">
                    {t("Semantic search fallback")}
                  </p>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>

      {statusError && !status ? (
        <div className="pages-search-index-status">
          <p role="status">{t("Search status unavailable")}</p>
        </div>
      ) : null}
      {status?.enabled &&
      (statusError ||
        !status.available ||
        indexing ||
        indexPaused ||
        indexWaiting ||
        indexError) ? (
        <div className="pages-search-index-status">
          {statusError ? (
            <p role="status">{t("Search status unavailable")}</p>
          ) : !status.available ? (
            <p role="status">{t("Cloudflare search unavailable")}</p>
          ) : (
            <>
              <div className="pages-search-index-actions">
                {indexing ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={pauseIndexing}
                  >
                    {t("Pause indexing")}
                  </Button>
                ) : indexPaused && status.needed.length ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resumeIndexing}
                  >
                    {t("Resume indexing")}
                  </Button>
                ) : null}
                {indexError && status.needed.length ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={retryIndexing}
                  >
                    {t("Retry indexing")}
                  </Button>
                ) : null}
              </div>
              {indexing || indexPaused || indexWaiting ? (
                <p role="status" aria-live="polite">
                  {indexWaiting
                    ? t("Waiting for page indexing")
                    : indexPaused
                      ? t("Indexing paused", indexProgress)
                      : t("Indexing pages", indexProgress)}
                </p>
              ) : null}
              {indexError ? (
                <p role="alert">{t("Page indexing failed")}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
