import { useState } from "react";
import { useTranslate } from "ra-core";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void run("read-all", () => client.readAll())}
        >
          {t("markAllRead")}
        </Button>
      </div>
      <div role="tablist" aria-label={t("title")} className="flex gap-1">
        {filterIds.map((id) => (
          <Button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            variant={filter === id ? "default" : "ghost"}
            size="sm"
            onClick={() => setFilter(id)}
          >
            {t(id)}
          </Button>
        ))}
      </div>
      {inbox.isPending && <p>{t("loading")}</p>}
      {inbox.isError && <p role="alert">{t("loadError")}</p>}
      {error && <p role="alert">{error}</p>}
      {!inbox.isPending && items.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-1 rounded-md border p-3"
            aria-label={item.title}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatTime(item.createdAt)}
                  {item.actionState === "pending" ? ` · ${t("pending")}` : ""}
                  {item.readAt === null ? ` · ${t("unread")}` : ""}
                </p>
              </div>
            </div>
            {item.body && (
              <p className="whitespace-pre-wrap break-words text-sm">{item.body}</p>
            )}
            <div className="flex flex-wrap gap-1">
              {item.readAt === null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy === item.id}
                  onClick={() => void run(item.id, () => client.setRead(item.id, true))}
                >
                  {t("markRead")}
                </Button>
              )}
              {item.actionState === "pending" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy === item.id}
                  onClick={() => void run(item.id, () => client.resolve(item.id))}
                >
                  {t("resolve")}
                </Button>
              )}
              {item.archivedAt === null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy === item.id}
                  onClick={() => void run(item.id, () => client.archive(item.id))}
                >
                  {t("archive")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
