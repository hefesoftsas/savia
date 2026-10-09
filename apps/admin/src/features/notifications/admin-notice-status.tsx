import { useRealtimeRefresh } from "@/realtime/use-realtime-refresh";
import { useSessionGeneration } from "@/auth/session-scope";
import { ReadRefreshStatus } from "@/components/admin/read-refresh-status";
import { useTranslate } from "ra-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationClient, type NotificationClient } from "./client";
import { notificationReadKey } from "./queries";

export function AdminNoticeStatus({
  eventId,
  client = notificationClient,
}: {
  eventId: string;
  client?: NotificationClient;
}) {
  const translate = useTranslate();
  const t = (key: string) => translate(`savia.notificationInbox.${key}`);
  const cache = useQueryClient();
  const sessionGeneration = useSessionGeneration();
  useRealtimeRefresh({
    topics: ["notifications"],
    refresh: () =>
      cache.invalidateQueries({
        queryKey: notificationReadKey(
          sessionGeneration,
          "admin-status",
          eventId,
        ),
      }),
  });
  const status = useQuery({
    queryKey: notificationReadKey(sessionGeneration, "admin-status", eventId),
    queryFn: () => client.adminStatus(eventId),
    refetchInterval: 15_000,
  });

  if (status.isPending) return <p>{t("loading")}</p>;
  if (status.isError && !status.data)
    return <p role="alert">{t("loadError")}</p>;
  if (!status.data) return <p>{t("loading")}</p>;
  return (
    <>
      <ReadRefreshStatus
        refreshing={status.isFetching && !status.isPending}
        error={status.isError ? t("loadError") : undefined}
        onRetry={() => void status.refetch()}
      />
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt>{t("statusState")}</dt>
        <dd>{status.data.status}</dd>
        <dt>{t("statusDelivered")}</dt>
        <dd>{status.data.delivered}</dd>
        <dt>{t("statusFailed")}</dt>
        <dd>{status.data.failed}</dd>
        <dt>{t("statusRetrying")}</dt>
        <dd>{status.data.pendingRetries}</dd>
      </dl>
    </>
  );
}
