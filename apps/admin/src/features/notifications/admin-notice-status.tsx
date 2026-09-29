import { useRealtimeRefresh } from "@/realtime/use-realtime-refresh";
import { useTranslate } from "ra-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationClient, type NotificationClient } from "./client";

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
  useRealtimeRefresh({
    topics: ["notifications"],
    refresh: () =>
      cache.invalidateQueries({
        queryKey: ["notifications", "admin-status", eventId],
      }),
  });
  const status = useQuery({
    queryKey: ["notifications", "admin-status", eventId],
    queryFn: () => client.adminStatus(eventId),
    refetchInterval: 15_000,
  });

  if (status.isPending) return <p>{t("loading")}</p>;
  if (status.isError || !status.data)
    return <p role="alert">{t("loadError")}</p>;
  return (
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
  );
}
