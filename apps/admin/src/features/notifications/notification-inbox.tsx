import { useState } from "react";
import { useTranslate } from "ra-core";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Bell,
  Check,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  Inbox,
  LoaderCircle,
  Megaphone,
  RefreshCw,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  notificationClient,
  type InboxFilter,
  type NoticeItem,
  type NotificationClient,
} from "./client";
import { useNotificationInbox } from "./queries";

const filterIds: InboxFilter[] = ["all", "unread", "pending"];

function formatTime(createdAt: number): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function isoTime(createdAt: number): string | undefined {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function NoticeIcon({ kind }: { kind: string }) {
  const Icon = kind === "admin-message" ? Megaphone : Bell;
  return (
    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

export function NotificationInbox({
  client = notificationClient,
}: {
  client?: NotificationClient;
}) {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const translate = useTranslate();
  const t = (key: string) => translate(`savia.notificationInbox.${key}`);
  const queryClient = useQueryClient();
  const inbox = useNotificationInbox(filter, client);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    setError("");
    try {
      await action();
      await refresh();
    } catch {
      setError(t("actionError"));
    } finally {
      setBusy(null);
    }
  };

  const items: NoticeItem[] = inbox.data?.items ?? [];
  const showEmpty = !inbox.isPending && !inbox.isError && items.length === 0;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4 py-6">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            <Bell className="size-5 text-primary" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void run("read-all", () => client.readAll())}
        >
          {busy === "read-all" ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <CheckCheck aria-hidden="true" />
          )}
          {t("markAllRead")}
        </Button>
      </header>

      <div
        role="tablist"
        aria-label={t("title")}
        className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/60 p-1"
      >
        {filterIds.map((id) => {
          const active = filter === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(id)}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {inbox.isPending && (
          <div
            role="status"
            aria-label={t("loading")}
            className="flex flex-col gap-3"
          >
            <span className="sr-only">{t("loading")}</span>
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm"
              >
                <Skeleton className="size-9 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {inbox.isError && (
          <Alert variant="destructive" className="rounded-2xl">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{t("loadError")}</AlertTitle>
            <AlertDescription className="mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refresh()}
              >
                <RefreshCw aria-hidden="true" />
                {t("retry")}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive" className="rounded-2xl">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}

        {showEmpty && (
          <div
            className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center"
            data-testid="notifications-empty"
          >
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <Inbox aria-hidden="true" className="size-7 text-primary" />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-foreground">
              {t("empty")}
            </h2>
            {filter !== "all" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-4"
                onClick={() => setFilter("all")}
              >
                {t("showAll")}
              </Button>
            ) : null}
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const unread = item.readAt === null;
            const busyItem = busy === item.id;
            return (
              <li
                key={item.id}
                aria-label={item.title}
                className={cn(
                  "rounded-2xl border bg-card p-4 shadow-sm transition-colors",
                  unread
                    ? "border-primary/30 bg-primary/[0.03]"
                    : "border-border/60",
                )}
              >
                <div className="flex items-start gap-3">
                  <NoticeIcon kind={item.source.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p
                        className={cn(
                          "flex min-w-0 items-start gap-2 text-sm leading-6",
                          unread ? "font-semibold" : "font-medium",
                        )}
                      >
                        {unread ? (
                          <span
                            aria-hidden="true"
                            className="mt-2 size-2 shrink-0 rounded-full bg-primary"
                          />
                        ) : null}
                        <span className="break-words">{item.title}</span>
                      </p>
                      <time
                        dateTime={isoTime(item.createdAt)}
                        className="shrink-0 text-xs tabular-nums text-muted-foreground"
                      >
                        {formatTime(item.createdAt)}
                      </time>
                    </div>
                    {item.body && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                        {item.body}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {unread ? (
                        <Badge variant="outline">{t("unread")}</Badge>
                      ) : null}
                      {item.actionState === "pending" ? (
                        <Badge variant="secondary">{t("pending")}</Badge>
                      ) : null}
                      <div className="ml-auto flex flex-wrap gap-1">
                        {unread && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busyItem}
                            onClick={() =>
                              void run(item.id, () =>
                                client.setRead(item.id, true),
                              )
                            }
                          >
                            {busyItem ? (
                              <LoaderCircle
                                className="animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <Check aria-hidden="true" />
                            )}
                            {t("markRead")}
                          </Button>
                        )}
                        {item.actionState === "pending" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busyItem}
                            onClick={() =>
                              void run(item.id, () => client.resolve(item.id))
                            }
                          >
                            {busyItem ? (
                              <LoaderCircle
                                className="animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <CircleCheck aria-hidden="true" />
                            )}
                            {t("resolve")}
                          </Button>
                        )}
                        {item.archivedAt === null && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busyItem}
                            onClick={() =>
                              void run(item.id, () => client.archive(item.id))
                            }
                          >
                            {busyItem ? (
                              <LoaderCircle
                                className="animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <Archive aria-hidden="true" />
                            )}
                            {t("archive")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
