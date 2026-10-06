import { useEffect, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import type {
  PersonalIntegrationConnection,
  PersonalIntegrationProvider,
} from "@/api/personal-integrations-client";

export type IssueProvider = "jira" | "linear" | "github";
type Resource<T> = { id: string; attributes: T };

/** Server availability and the current reader's authorization both gate previews. */
export function useIssueProviders(api: ApiClient): IssueProvider[] {
  const [providers, setProviders] = useState<IssueProvider[]>([]);
  useEffect(() => {
    let controller: AbortController | undefined;
    let active = true;
    let pending: Promise<void> | null = null;
    async function refresh() {
      if (pending) return pending;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const task = (async () => {
        try {
          const [catalog, connections] = await Promise.all([
            api.get<{ data: Resource<PersonalIntegrationProvider>[] }>(
              "/v1/personal-integrations/providers",
              { signal: request.signal },
            ),
            api.get<{ data: Resource<PersonalIntegrationConnection>[] }>(
              "/v1/personal-integrations/connections",
              { signal: request.signal },
            ),
          ]);
          if (!active || request.signal.aborted) return;
          const next = (["jira", "linear", "github"] as const).filter(
            (provider) =>
              catalog.data.some(
                (item) =>
                  item.id === provider &&
                  item.attributes.availability === "enabled",
              ) &&
              connections.data.some(
                (item) =>
                  item.attributes.provider === provider &&
                  item.attributes.status === "connected",
              ),
          );
          setProviders((current) => {
            if (
              current.length === next.length &&
              current.every((p, i) => p === next[i])
            ) {
              return current;
            }
            return next;
          });
        } catch {
          // Inaccessible, expired, or unavailable connections must not be offered.
          if (active && !request.signal.aborted) setProviders([]);
        } finally {
          pending = null;
        }
      })();
      pending = task;
      return task;
    }
    const reload = () => void refresh();
    const visible = () => {
      if (document.visibilityState === "visible") reload();
    };
    const clear = () => {
      pending = null;
      controller?.abort();
      setProviders([]);
    };
    reload();
    window.addEventListener("focus", reload);
    window.addEventListener("savia:personal-integrations-changed", reload);
    window.addEventListener("savia:identity-changed", reload);
    window.addEventListener("savia:session-cleared", clear);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener("focus", reload);
      window.removeEventListener("savia:personal-integrations-changed", reload);
      window.removeEventListener("savia:identity-changed", reload);
      window.removeEventListener("savia:session-cleared", clear);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [api]);
  return providers;
}
