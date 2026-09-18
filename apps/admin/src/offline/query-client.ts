import { QueryClient } from "@tanstack/react-query";
import { isOfflineError } from "./offline-error";

const ONE_WEEK_MS = 1000 * 60 * 60 * 24 * 7;
const FIVE_MINUTES_MS = 1000 * 60 * 5;

export const OFFLINE_CACHE_MAX_AGE_MS = ONE_WEEK_MS;

/**
 * App-wide QueryClient tuned for flaky networks:
 * - reads survive reloads via the persisted cache (see query-persister.ts)
 * - no retries without a usable network (avoids toast storms and logouts)
 * - mutations never retry: destructive ops must fail fast with a clear
 *   message instead of firing twice
 */
export function createOfflineQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: ONE_WEEK_MS,
        staleTime: FIVE_MINUTES_MS,
        refetchOnReconnect: "always",
        retry: (failureCount, error) => {
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            return false;
          }
          if (isOfflineError(error)) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
