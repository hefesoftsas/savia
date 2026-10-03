import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n/core";
import { pagesMessages } from "./messages";
import type { PageDocument, PageSummary, PagesClient } from "./client";
import { pageTextChunks } from "./browser-search-index";
import type { SearchWorkerResponse } from "./browser-search-protocol";
import { subscribePageChanges } from "./page-events";
import { subscribeSearchCacheClear } from "./browser-search-cache";

type Status = "loading" | "ready" | "invalidated" | "cancelled" | "error";
type SearchHit = { id: string; title: string; snippet: string; score: number };
type IndexedVersion = Map<string, number>;
type Summary = Pick<PageSummary, "id" | "title" | "version">;

function contentText(content: unknown) {
  return pageTextChunks(content)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSnippet(content: unknown, term: string) {
  const body = contentText(content);
  if (body.length <= 240) return body;
  const match = body
    .toLocaleLowerCase()
    .indexOf(term.trim().toLocaleLowerCase());
  const start = match > 80 ? match - 80 : 0;
  return `${start ? "…" : ""}${body.slice(start, start + 240)}${start + 240 < body.length ? "…" : ""}`;
}

export function BrowserPagesSearch({
  client,
  getScope,
}: {
  client: PagesClient;
  getScope: () => Promise<string>;
}) {
  const t = useMessages(pagesMessages);
  const workerRef = useRef<Worker | undefined>(undefined);
  const generationRef = useRef(0);
  const requestRef = useRef(0);
  const versionsRef = useRef<IndexedVersion>(new Map());
  const summariesRef = useRef<Map<string, Summary>>(new Map());
  const pendingUpdateRef = useRef<((ok: boolean) => void) | undefined>(
    undefined,
  );
  const [status, setStatus] = useState<Status>("loading");
  const [query, setQuery] = useState("");
  const queryRef = useRef(query);
  queryRef.current = query;
  const [readProgress, setReadProgress] = useState({ done: 0, total: 0 });
  const [indexProgress, setIndexProgress] = useState({ done: 0, total: 0 });
  const [plan, setPlan] = useState({ reused: 0, total: 0, received: false });
  const [skipped, setSkipped] = useState(0);
  const [readyTotal, setReadyTotal] = useState(0);
  const [reusedTotal, setReusedTotal] = useState(0);
  const [elapsedMs, setElapsedMs] = useState<number>();
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  const stopWorker = useCallback(() => {
    pendingUpdateRef.current?.(false);
    pendingUpdateRef.current = undefined;
    workerRef.current?.terminate();
    workerRef.current = undefined;
  }, []);

  const invalidate = useCallback(() => {
    generationRef.current += 1;
    requestRef.current += 1;
    stopWorker();
    versionsRef.current = new Map();
    summariesRef.current = new Map();
    setHits([]);
    setSearching(false);
    setStatus("invalidated");
  }, [stopWorker]);

  const updateIndex = useCallback(
    async (rebuild = false) => {
      const generation = ++generationRef.current;
      requestRef.current += 1;
      stopWorker();
      versionsRef.current = new Map();
      summariesRef.current = new Map();
      setStatus("loading");
      setHits([]);
      setSearchError(false);
      setElapsedMs(undefined);
      setSkipped(0);
      setReadyTotal(0);
      setReusedTotal(0);
      setPlan({ reused: 0, total: 0, received: false });
      setReadProgress({ done: 0, total: 0 });
      setIndexProgress({ done: 0, total: 0 });

      let worker: Worker;
      try {
        worker = new Worker(
          new URL("./browser-search.worker.ts", import.meta.url),
          {
            type: "module",
          },
        );
      } catch {
        setStatus("error");
        return;
      }
      workerRef.current = worker;
      let failed = 0;
      const isCurrent = () =>
        generation === generationRef.current && workerRef.current === worker;

      worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
        if (!isCurrent()) return;
        const message = event.data;
        switch (message.type) {
          case "plan": {
            setPlan({
              reused: message.reused,
              total: message.total,
              received: true,
            });
            setReadProgress({ done: 0, total: message.needed.length });
            void (async () => {
              for (const [index, id] of message.needed.entries()) {
                if (!isCurrent()) return;
                const summary = summariesRef.current.get(id);
                if (!summary) {
                  failed += 1;
                  setReadProgress({
                    done: index + 1,
                    total: message.needed.length,
                  });
                  continue;
                }
                try {
                  const page: PageDocument = await client.get(id);
                  if (!isCurrent()) return;
                  if (
                    page.kind !== "page" ||
                    page.id !== id ||
                    page.version !== summary.version
                  ) {
                    failed += 1;
                  } else {
                    versionsRef.current.set(id, page.version);
                    const acknowledged = new Promise<boolean>((resolve) => {
                      pendingUpdateRef.current = resolve;
                    });
                    worker.postMessage({
                      type: "upsert",
                      page: {
                        id: page.id,
                        title: page.title,
                        content: page.content,
                        version: page.version,
                      },
                    });
                    if (!(await acknowledged)) {
                      if (isCurrent()) setStatus("error");
                      return;
                    }
                  }
                } catch {
                  if (!isCurrent()) return;
                  failed += 1;
                }
                if (!isCurrent()) return;
                setReadProgress({
                  done: index + 1,
                  total: message.needed.length,
                });
              }
              if (isCurrent()) {
                setSkipped(failed);
                worker.postMessage({ type: "finish" });
              }
            })();
            break;
          }
          case "updated":
            pendingUpdateRef.current?.(true);
            pendingUpdateRef.current = undefined;
            break;
          case "indexing":
            setIndexProgress({ done: message.done, total: message.total });
            break;
          case "ready":
            setStatus("ready");
            setReadyTotal(message.total);
            setReusedTotal(message.reused);
            setElapsedMs(message.elapsedMs);
            setIndexProgress({ done: message.total, total: message.total });
            break;
          case "results":
            if (message.requestId !== requestRef.current) return;
            setSearching(true);
            void (async () => {
              const verified: SearchHit[] = [];
              const term = queryRef.current;
              for (const hit of message.hits) {
                if (!isCurrent() || message.requestId !== requestRef.current)
                  return;
                const version = versionsRef.current.get(hit.id);
                if (version === undefined) continue;
                try {
                  const page = await client.get(hit.id);
                  if (
                    page.kind !== "page" ||
                    page.version !== version ||
                    page.id !== hit.id
                  )
                    continue;
                  verified.push({
                    id: page.id,
                    title: page.title,
                    snippet: makeSnippet(page.content, term),
                    score: hit.score,
                  });
                } catch {
                  // A page may become inaccessible while searching.
                }
              }
              if (!isCurrent() || message.requestId !== requestRef.current)
                return;
              setHits(verified);
              setSearching(false);
            })();
            break;
          case "error":
            if (
              message.requestId !== undefined &&
              message.requestId !== requestRef.current
            )
              return;
            if (message.requestId === undefined) setStatus("error");
            else {
              setSearchError(true);
              setSearching(false);
            }
            pendingUpdateRef.current?.(false);
            pendingUpdateRef.current = undefined;
            break;
        }
      };
      worker.onerror = () => {
        if (isCurrent()) {
          pendingUpdateRef.current?.(false);
          pendingUpdateRef.current = undefined;
          setStatus("error");
          setSearching(false);
        }
      };

      try {
        const scope = await getScope();
        const summaries = (await client.list("")).slice(0, 200);
        if (!isCurrent()) return;
        const pages = summaries
          .filter((summary) => summary.kind !== "folder")
          .map((summary) => ({
            id: summary.id,
            title: summary.title,
            version: summary.version,
          }));
        summariesRef.current = new Map(pages.map((page) => [page.id, page]));
        versionsRef.current = new Map(
          pages.map((page) => [page.id, page.version]),
        );
        worker.postMessage({
          type: "open",
          scope,
          pages,
          ...(rebuild ? { rebuild: true } : {}),
        });
      } catch {
        if (isCurrent()) setStatus("error");
      }
    },
    [client, getScope, stopWorker],
  );

  useEffect(() => {
    void updateIndex();
    return () => {
      generationRef.current += 1;
      requestRef.current += 1;
      stopWorker();
    };
  }, [updateIndex, stopWorker]);

  useEffect(() => {
    const unsubscribe = subscribePageChanges((change) => {
      if (change.api === client.api) invalidate();
    });
    const unsubscribeCacheClear = subscribeSearchCacheClear(invalidate);
    const onFocus = () => invalidate();
    window.addEventListener("focus", onFocus);
    return () => {
      unsubscribe();
      unsubscribeCacheClear();
      window.removeEventListener("focus", onFocus);
    };
  }, [client, invalidate]);

  useEffect(() => {
    const requestId = ++requestRef.current;
    workerRef.current?.postMessage({ type: "cancel-search", requestId });
    setSearching(false);
    if (status !== "ready" || !query.trim()) return;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(false);
      workerRef.current?.postMessage({
        type: "search",
        requestId,
        term: query,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, status]);

  function cancelIndexing() {
    generationRef.current += 1;
    requestRef.current += 1;
    stopWorker();
    versionsRef.current = new Map();
    setHits([]);
    setStatus("cancelled");
  }

  return (
    <section className="space-y-4" aria-label={t("Browser search")}>
      <label className="block min-w-56 space-y-1 text-sm">
        <span>{t("Search page content")}</span>
        <Input
          value={query}
          onChange={(event) => {
            requestRef.current += 1;
            setHits([]);
            setSearching(false);
            setQuery(event.target.value);
          }}
          disabled={status !== "ready"}
        />
      </label>

      <p className="text-sm text-muted-foreground">
        {t("Browser search privacy")}
      </p>

      {status === "loading" && (
        <div
          className="max-w-2xl space-y-4 rounded-md border bg-muted/40 p-4"
          role="status"
          aria-live="polite"
        >
          <h3 className="text-sm font-semibold">
            {t("Browser search indexing")}
          </h3>
          {!plan.received ? (
            <p className="text-sm">{t("Checking search cache")}</p>
          ) : (
            <>
              <p className="text-sm">
                {t("Search cache plan", {
                  reused: plan.reused,
                  total: plan.total,
                })}
              </p>
              {readProgress.total > 0 && (
                <div className="space-y-1">
                  <p className="text-sm">
                    {t("Reading page progress", readProgress)}
                  </p>
                  <progress
                    className="w-full"
                    aria-label={t("Pages read")}
                    max={readProgress.total}
                    value={readProgress.done}
                  />
                </div>
              )}
              {indexProgress.total > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {t("Indexing page progress", indexProgress)}
                  </p>
                  <progress
                    className="w-full"
                    aria-label={t("Pages indexed")}
                    max={indexProgress.total}
                    value={indexProgress.done}
                  />
                </div>
              )}
            </>
          )}
          <Button type="button" variant="outline" onClick={cancelIndexing}>
            {t("Cancel indexing")}
          </Button>
        </div>
      )}
      {status === "ready" && (
        <p role="status" aria-live="polite">
          {t("Browser search ready", {
            elapsed: Math.max(0, Math.round(elapsedMs ?? 0)),
            total: readyTotal,
          })}{" "}
          {t("Search reused count", { count: reusedTotal })}
          {skipped > 0 ? ` ${t("Skipped pages", { count: skipped })}` : ""}
        </p>
      )}
      {(status === "invalidated" ||
        status === "cancelled" ||
        status === "error") && (
        <div
          role={status === "error" ? "alert" : "status"}
          aria-live="polite"
          className="space-y-2"
        >
          <p>
            {t(
              status === "invalidated"
                ? "Browser search update needed"
                : status === "cancelled"
                  ? "Indexing cancelled"
                  : "Browser search failed",
            )}
          </p>
          {status === "error" && <p>{t("Search cache error help")}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void updateIndex()}
            >
              {t("Update index")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void updateIndex(true)}
            >
              {t("Rebuild index")}
            </Button>
          </div>
        </div>
      )}
      {searchError && <p role="alert">{t("Browser search query failed")}</p>}
      {searching && (
        <p role="status" aria-live="polite">
          {t("Searching pages")}
        </p>
      )}
      {status === "ready" &&
        query.trim() &&
        !searching &&
        !searchError &&
        hits.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("No browser search results")}
          </p>
        )}
      {hits.length > 0 && (
        <ul className="space-y-2" aria-label={t("Browser search results")}>
          {hits.map((hit) => (
            <li key={hit.id} className="rounded-md border p-3">
              <Link
                to={`/pages/${encodeURIComponent(hit.id)}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {hit.title}
              </Link>
              <p className="mt-1 text-sm text-muted-foreground">
                {hit.snippet}
              </p>
            </li>
          ))}
        </ul>
      )}
      {status === "ready" && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void updateIndex()}
          >
            {t("Update index")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void updateIndex(true)}
          >
            {t("Rebuild index")}
          </Button>
        </div>
      )}
    </section>
  );
}
