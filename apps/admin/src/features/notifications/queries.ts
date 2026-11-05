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
  useRealtimeQuery({
    topics: ["notifications"],
    queryKeys: [queryKey],
  });
  return useQuery({
    queryKey,
    queryFn: () => client.unreadCount(),
    // A short fresh window keeps this count out of the initial query burst.
    // On focus, React Query refreshes it after this window expires.
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnMount: false,
  });
}

export function useNotificationInbox(
  filter: InboxFilter,
  client: NotificationClient = notificationClient,
) {
  const sessionGeneration = useSessionGeneration();
  const queryKey = notificationReadKey(sessionGeneration, "inbox", filter);
  useRealtimeQuery({
    topics: ["notifications"],
    queryKeys: [queryKey],
  });
  return useQuery({
    queryKey,
    queryFn: () => client.inbox(filter),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
