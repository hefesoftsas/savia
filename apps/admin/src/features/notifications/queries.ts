import { useQuery } from "@tanstack/react-query";
import { useSessionGeneration } from "@/auth/session-scope";
import { useRealtimeQuery } from "@/realtime/use-realtime-query";
import {
  notificationClient,
  type InboxFilter,
  type NotificationClient,
} from "./client";

export function notificationReadKey(
  sessionGeneration: number,
  ...parts: Array<string | InboxFilter>
) {
  return ["notifications", sessionGeneration, ...parts] as const;
}

export function useUnreadNotifications(
  client: NotificationClient = notificationClient,
) {
  const sessionGeneration = useSessionGeneration();
  const queryKey = notificationReadKey(sessionGeneration, "unread-count");
  const { status } = useRealtimeQuery({
    topics: ["notifications"],
    queryKeys: [queryKey],
  });
  return useQuery({
    queryKey,
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
  const sessionGeneration = useSessionGeneration();
  const queryKey = notificationReadKey(sessionGeneration, "inbox", filter);
  const { status } = useRealtimeQuery({
    topics: ["notifications"],
    queryKeys: [queryKey],
  });
  return useQuery({
    queryKey,
    queryFn: () => client.inbox(filter),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: status === "live" ? false : 30_000,
    refetchOnWindowFocus: false,
  });
}
