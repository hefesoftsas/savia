import { useRealtimeRefresh } from "@/realtime/use-realtime-refresh";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import {
  notificationClient,
  type InboxFilter,
  type NotificationClient,
} from "./client";

export function useUnreadNotifications(
  client: NotificationClient = notificationClient,
) {
  const cache = useQueryClient();
  const { status } = useRealtimeRefresh({
    topics: ["notifications"],
    refresh: () => cache.invalidateQueries({ queryKey: ["notifications"] }),
  });
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => client.unreadCount(),
    // El conteo compite con los datos críticos en la cascada inicial
    // (1051ms en el HAR): no refetchear al enfocar ni al remontar.
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: status === "live" ? false : 30_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function useNotificationInbox(
  filter: InboxFilter,
  client: NotificationClient = notificationClient,
) {
  const cache = useQueryClient();
  const { status } = useRealtimeRefresh({
    topics: ["notifications"],
    refresh: () =>
      cache.invalidateQueries({ queryKey: ["notifications", "inbox"] }),
  });
  return useQuery({
    queryKey: ["notifications", "inbox", filter],
    queryFn: () => client.inbox(filter),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: status === "live" ? false : 30_000,
    refetchOnWindowFocus: false,
  });
}
