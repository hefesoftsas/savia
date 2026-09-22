import { useQuery } from "@tanstack/react-query";
import {
  notificationClient,
  type InboxFilter,
  type NotificationClient,
} from "./client";

export function useUnreadNotifications(client: NotificationClient = notificationClient) {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => client.unreadCount(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useNotificationInbox(
  filter: InboxFilter,
  client: NotificationClient = notificationClient,
) {
  return useQuery({
    queryKey: ["notifications", "inbox", filter],
    queryFn: () => client.inbox(filter),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
