import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MailPlus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PersonalMailProvider } from "@savia/studio-shared/mail-contracts";
import {
  mailProviderLabel,
  type MailRow,
  type MailState,
} from "./use-my-day-mail";

const PAGE_SIZE = 10;
type MailFilter = PersonalMailProvider | "all";

function rowKey(row: Pick<MailRow, "provider" | "id">) {
  return `${row.provider}:${row.id}`;
}

function safeLink(value: string | null): string | undefined {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      [
        "mail.google.com",
        "outlook.office.com",
        "outlook.office365.com",
        "outlook.live.com",
      ].includes(url.hostname)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
function dateLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Sin fecha";
  return new Intl.DateTimeFormat("es", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function MailWidgetBody({
  mail,
  onCompose,
}: {
  mail: MailState;
  onCompose: () => void;
}) {
  const [filter, setFilter] = useState<MailFilter>("all");
  const [page, setPage] = useState(0);
  const [readerOrder, setReaderOrder] = useState<string[] | null>(null);
  const [pendingNext, setPendingNext] = useState<{
    targetPage: number;
    baseOrder: string[];
    rounds: number;
    resolved: boolean;
  } | null>(null);
  const [paginationNotice, setPaginationNotice] = useState(false);
  const requestId = useRef(0);

  const activeFilter = mail.connections.some(
    (connection) => connection.provider === filter,
  )
    ? filter
    : "all";
  const accountKey = mail.connections
    .map(
      (connection) =>
        `${connection.provider}:${connection.externalAccountLabel ?? ""}`,
    )
    .sort()
    .join("|");
  const resetKey = `${activeFilter}:${mail.sessionRevision}:${accountKey}`;
  const previousResetKey = useRef(resetKey);
  const filteredRows = useMemo(
    () =>
      mail.messages.filter(
        (row) => activeFilter === "all" || row.provider === activeFilter,
      ),
    [mail.messages, activeFilter],
  );
  const rowsByKey = useMemo(
    () => new Map(filteredRows.map((row) => [rowKey(row), row])),
    [filteredRows],
  );
  const availableMoreProviders = (mail.connections ?? [])
    .filter(
      (connection) =>
        (activeFilter === "all" || connection.provider === activeFilter) &&
        mail.hasMore?.[connection.provider],
    )
    .map((connection) => connection.provider);
  const visibleOrder =
    page === 0
      ? filteredRows.map(rowKey)
      : (readerOrder ?? filteredRows.map(rowKey));
  const pageRows = visibleOrder
    .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    .flatMap((key) => {
      const row = rowsByKey.get(key);
      return row ? [row] : [];
    });
  const hasLoadedNextPage = visibleOrder.length > (page + 1) * PAGE_SIZE;
  const canGoNext = hasLoadedNextPage || availableMoreProviders.length > 0;
  const paging = Boolean(pendingNext) || Boolean(mail.loadingMore);

  function providersBeforeFrontier(order: string[], targetPage: number) {
    const targetRows = order
      .slice(targetPage * PAGE_SIZE, (targetPage + 1) * PAGE_SIZE)
      .flatMap((key) => {
        const row = rowsByKey.get(key);
        return row ? [row] : [];
      });
    if (!targetRows.length) return availableMoreProviders;
    if (targetRows.length < PAGE_SIZE) return availableMoreProviders;
    const candidateDates = targetRows
      .map((row) => Date.parse(row.receivedAt ?? ""))
      .filter(Number.isFinite);
    if (!candidateDates.length) {
      return availableMoreProviders.filter((provider) =>
        order.some((key) => {
          const row = rowsByKey.get(key);
          return (
            row?.provider === provider &&
            Number.isFinite(Date.parse(row.receivedAt ?? ""))
          );
        }),
      );
    }
    const boundary = Math.min(...candidateDates);
    const hasUndatedCandidate = candidateDates.length < targetRows.length;
    return availableMoreProviders.filter((provider) => {
      const providerRows = order
        .map((key) => rowsByKey.get(key))
        .filter((row): row is MailRow => row?.provider === provider);
      if (!providerRows.length) return true;
      const providerDates = providerRows
        .map((row) => Date.parse(row.receivedAt ?? ""))
        .filter(Number.isFinite);
      if (!providerDates.length) return false;
      const frontier = Math.min(...providerDates);
      return hasUndatedCandidate || frontier >= boundary;
    });
  }

  function sortedUnion(order: string[], rows: MailRow[]) {
    const keys = new Set(order);
    const next = [
      ...order,
      ...rows.map(rowKey).filter((key) => !keys.has(key)),
    ];
    return next.sort((left, right) => {
      const leftTime = Date.parse(rowsByKey.get(left)?.receivedAt ?? "");
      const rightTime = Date.parse(rowsByKey.get(right)?.receivedAt ?? "");
      const safeLeft = Number.isFinite(leftTime) ? leftTime : -Infinity;
      const safeRight = Number.isFinite(rightTime) ? rightTime : -Infinity;
      return safeRight - safeLeft || left.localeCompare(right);
    });
  }

  useEffect(() => {
    if (previousResetKey.current === resetKey) return;
    previousResetKey.current = resetKey;
    requestId.current += 1;
    setPage(0);
    setReaderOrder(null);
    setPendingNext(null);
    setPaginationNotice(false);
  }, [resetKey]);

  useEffect(() => {
    if (!pendingNext?.resolved) return;
    const nextOrder = sortedUnion(pendingNext.baseOrder, filteredRows);
    const unsafeProviders = providersBeforeFrontier(
      nextOrder,
      pendingNext.targetPage,
    );
    const hasTargetRows = nextOrder.length > pendingNext.targetPage * PAGE_SIZE;
    const loadMoreFailed = mail.errors.some((error) =>
      error.startsWith("No pudimos cargar más correos de "),
    );
    if (loadMoreFailed) {
      setPaginationNotice(true);
      setPendingNext(null);
      return;
    }
    if (unsafeProviders.length && pendingNext.rounds < 4 && mail.loadMore) {
      const request = requestId.current;
      setPendingNext({
        ...pendingNext,
        baseOrder: nextOrder,
        rounds: pendingNext.rounds + 1,
        resolved: false,
      });
      void mail
        .loadMore(unsafeProviders)
        .catch(() => undefined)
        .finally(() => {
          if (request === requestId.current) {
            setPendingNext((current) =>
              current ? { ...current, resolved: true } : current,
            );
          }
        });
      return;
    }
    if (unsafeProviders.length || !hasTargetRows) {
      setPaginationNotice(true);
      setPendingNext(null);
      return;
    }
    setPaginationNotice(false);
    setReaderOrder(nextOrder);
    setPage(pendingNext.targetPage);
    setPendingNext(null);
  }, [filteredRows, mail, pendingNext, rowsByKey, availableMoreProviders]);

  useEffect(() => {
    if (pendingNext || page === 0) return;
    const validOrder = (readerOrder ?? filteredRows.map(rowKey)).filter((key) =>
      rowsByKey.has(key),
    );
    if (readerOrder && validOrder.length !== readerOrder.length) {
      setReaderOrder(validOrder);
    }
    const lastLoadedPage = Math.max(
      0,
      Math.ceil(validOrder.length / PAGE_SIZE) - 1,
    );
    if (page > lastLoadedPage && !availableMoreProviders.length) {
      setPage(lastLoadedPage);
    }
  }, [
    availableMoreProviders.length,
    filteredRows,
    page,
    pendingNext,
    readerOrder,
    rowsByKey,
  ]);

  function changeFilter(value: string) {
    if (value !== "all" && value !== "gmail" && value !== "outlook") return;
    setFilter(value);
    setPage(0);
    setReaderOrder(null);
    setPendingNext(null);
    setPaginationNotice(false);
  }

  function goPrevious() {
    if (page <= 0 || paging) return;
    setPage((current) => Math.max(0, current - 1));
  }

  function goNext() {
    if (paging || !canGoNext) return;
    const targetPage = page + 1;
    const order = readerOrder ?? filteredRows.map(rowKey);
    const unsafeProviders = providersBeforeFrontier(order, targetPage);
    if (hasLoadedNextPage && !unsafeProviders.length) {
      setReaderOrder(order);
      setPage(targetPage);
      return;
    }

    const providers = unsafeProviders.length
      ? unsafeProviders
      : availableMoreProviders;
    if (!providers.length || !mail.loadMore) return;
    const request = ++requestId.current;
    const baseOrder = order;
    setPaginationNotice(false);
    setPendingNext({ targetPage, baseOrder, rounds: 1, resolved: false });
    void mail
      .loadMore(providers)
      .catch(() => undefined)
      .finally(() => {
        if (request === requestId.current) {
          setPendingNext((current) =>
            current ? { ...current, resolved: true } : current,
          );
        }
      });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {mail.connections.length > 1 ? (
          <Tabs
            value={activeFilter}
            onValueChange={changeFilter}
            className="gap-0"
          >
            <TabsList aria-label="Filtrar cuenta de correo" className="h-8">
              <TabsTrigger value="all" className="px-2 text-xs">
                Todos
              </TabsTrigger>
              <TabsTrigger value="gmail" className="px-2 text-xs">
                Gmail
              </TabsTrigger>
              <TabsTrigger value="outlook" className="px-2 text-xs">
                Outlook
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <p className="truncate text-xs text-muted-foreground">
            {mail.connections[0]?.externalAccountLabel ?? "Correo personal"}
          </p>
        )}
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Actualizar correos"
            disabled={mail.loading}
            onClick={() => void mail.refresh()}
          >
            <RefreshCw
              className={mail.loading ? "size-4 animate-spin" : "size-4"}
              aria-hidden="true"
            />
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!mail.connections.length}
            onClick={onCompose}
          >
            <MailPlus className="size-4" aria-hidden="true" />
            Nuevo correo
          </Button>
        </div>
      </div>
      {Boolean(mail.newMessageCount) ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 text-sm"
        >
          <p>Hay nuevos correos en la bandeja.</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Descartar aviso de correos nuevos"
            onClick={mail.dismissNewMessages}
          >
            Entendido
          </Button>
        </div>
      ) : null}
      {mail.errors.map((error) => (
        <p key={error} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ))}
      {paginationNotice ? (
        <p className="text-sm text-muted-foreground">
          No pudimos completar esta página. Intenta de nuevo.
        </p>
      ) : null}
      {mail.loading && !pageRows.length ? (
        <div role="status" aria-label="Cargando correos" className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : pageRows.length ? (
        <ul aria-label="Correos" className="divide-y">
          {pageRows.map((row) => {
            const link = safeLink(row.webLink);
            const content = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {row.subject ?? "Sin asunto"}
                    {link ? (
                      <ExternalLink
                        className="ml-1 inline size-3"
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                  <time
                    className="shrink-0 text-xs text-muted-foreground"
                    dateTime={row.receivedAt ?? undefined}
                  >
                    {dateLabel(row.receivedAt)}
                  </time>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {row.sender ?? "Remitente desconocido"}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {mailProviderLabel(row.provider)} · {row.accountLabel}
                  {!link ? " · Enlace no disponible" : ""}
                </p>
              </>
            );
            return (
              <li key={rowKey(row)} className="py-2.5 first:pt-0 last:pb-0">
                {link ? (
                  <a
                    className="block min-w-0 rounded-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Abrir correo: ${row.subject ?? "Sin asunto"}`}
                  >
                    {content}
                  </a>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      ) : !mail.errors.length ? (
        <p className="py-4 text-sm text-muted-foreground">
          {mail.connections.length
            ? "No hay correos en esta bandeja."
            : "Conecta Gmail u Outlook para ver tus correos."}
        </p>
      ) : null}
      {(filteredRows.length > PAGE_SIZE ||
        availableMoreProviders.length > 0 ||
        page > 0) && (
        <Pagination className="mx-0 justify-between">
          <PaginationContent className="w-full justify-between">
            <PaginationItem>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Anterior"
                disabled={page === 0 || paging}
                onClick={goPrevious}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                <span>Anterior</span>
              </Button>
            </PaginationItem>
            <PaginationItem>
              <span
                className="px-2 text-sm text-muted-foreground"
                aria-live="off"
              >
                Página {page + 1}
              </span>
            </PaginationItem>
            <PaginationItem>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Siguiente"
                disabled={!canGoNext || paging}
                onClick={goNext}
              >
                <span>Siguiente</span>
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
