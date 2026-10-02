import type { ApiClient } from "@/api/api-client";
import type { PageSummary } from "./client";

type Change = { api: ApiClient; page?: PageSummary; removedId?: string };
const listeners = new Set<(change: Change) => void>();
export function publishPageChange(change: Change) {
  for (const listener of listeners) listener(change);
}
export function subscribePageChanges(listener: (change: Change) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
