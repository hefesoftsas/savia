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
    let requestSequence = 0;
    async function refresh(force = false) {
      if (pending && !force) return pending;
      if (force) {
        controller?.abort();
        pending = null;
      }
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const sequence = ++requestSequence;
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
          if (requestSequence === sequence) pending = null;
        }
      })();
      pending = task;
      return task;
    }
    const reload = () => void refresh();
    const invalidate = () => void refresh(true);
    const visible = () => {
      if (document.visibilityState === "visible") reload();
    };
    const clear = () => {
      requestSequence += 1;
      pending = null;
      controller?.abort();
      setProviders([]);
    };
    const principalChanged = () => {
      clear();
      reload();
    };
    reload();
    window.addEventListener("focus", reload);
    window.addEventListener("savia:personal-integrations-changed", invalidate);
    window.addEventListener("savia:principal-changed", principalChanged);
    window.addEventListener("savia:session-cleared", clear);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener("focus", reload);
      window.removeEventListener(
        "savia:personal-integrations-changed",
        invalidate,
      );
      window.removeEventListener("savia:principal-changed", principalChanged);
      window.removeEventListener("savia:session-cleared", clear);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [api]);
  return providers;
}
