import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeTopics } from "./use-realtime";

/** Refresh scoped read models; editors keep their draft and revision guard. */
export function useAccessRealtime(scope: string) {
  const client = useQueryClient();
  const tenantId = /^tenant:\d+$/.test(scope)
    ? Number(scope.slice(7))
    : undefined;
  const refresh = () => {
    void client.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === "access-control" && query.queryKey[2] === scope,
    });
  };
  useRealtimeTopics({
    topics: ["access-control"],
    tenantId,
    enabled: tenantId !== undefined,
    onEvent: refresh,
    onConnected: (reason) => {
      if (reason !== "subscription-change") refresh();
    },
  });
}
