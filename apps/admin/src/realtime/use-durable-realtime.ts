import { useEffect, useState } from "react";
import { ApiClientError, type ApiClient } from "@/api/api-client";
import { useSessionGeneration } from "@/auth/session-scope";
import { useAppServices } from "@/features/assistant/assistant-context";
import type { RealtimeStatus } from "./use-realtime";

export function useDurableRealtime(status: RealtimeStatus): boolean {
  let client: ApiClient | undefined;
  try {
    client = useAppServices().apiClient;
  } catch {
    client = undefined;
  }
  const generation = useSessionGeneration();
  const [confirmed, setConfirmed] = useState<{
    client: ApiClient;
    generation: number;
  } | null>(null);
  useEffect(() => {
    setConfirmed(null);
    if (status !== "live" || !client) return;
    let cancelled = false;
    const currentClient = client;
    void currentClient
      .get<{ data?: { durable?: unknown } }>(
        "/v1/realtime/events?after=0&limit=1",
      )
      .then((result) => {
        if (!cancelled && result.data?.durable === true)
          setConfirmed({ client: currentClient, generation });
      })
      .catch((error: unknown) => {
        const details =
          error instanceof ApiClientError ? error.details : undefined;
        const expired =
          details && typeof details === "object"
            ? (
                details as {
                  error?: { durable?: unknown; resyncRequired?: unknown };
                }
              ).error
            : undefined;
        if (
          !cancelled &&
          error instanceof ApiClientError &&
          error.status === 410 &&
          expired?.durable === true &&
          expired.resyncRequired === true
        )
          setConfirmed({ client: currentClient, generation });
      });
    return () => {
      cancelled = true;
    };
  }, [status, client, generation]);
  return (
    status === "live" &&
    confirmed?.client === client &&
    confirmed?.generation === generation
  );
}
