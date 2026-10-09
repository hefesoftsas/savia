import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ReadRefreshStatus } from "@/components/admin/read-refresh-status";
import { officeEditorUrl } from "@/features/office/office-api";
import { useMessages } from "@/i18n/core";
import {
  StorageProviderIcon,
  providerName,
} from "@/features/office-suite/storage-provider-icon";
import { officeDocumentsWidgetMessages } from "./office-documents-widget-messages";

type StorageProvider =
  "savia" | "google_drive" | "onedrive_personal" | "onedrive_business";

type RecentDocument = {
  id: string;
  name: string;
  provider: StorageProvider;
  href: string;
  updatedAt: string;
};

type WidgetState = {
  status: "loading" | "disabled" | "ready" | "partial" | "error";
  documents: RecentDocument[];
  hasMore: boolean;
  refreshing?: boolean;
};

const emptyState: WidgetState = {
  status: "loading",
  documents: [],
  hasMore: false,
};
const providers = new Set<StorageProvider>([
  "savia",
  "google_drive",
  "onedrive_personal",
  "onedrive_business",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAccessDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 401 || error.status === 403)
  );
}

function toRecentDocuments(
  saved: unknown,
  connected: unknown,
): { documents: RecentDocument[]; hasMore: boolean } {
  const documents: RecentDocument[] = [];
  if (Array.isArray(saved)) {
    for (const entry of saved) {
      if (
        !isRecord(entry) ||
        typeof entry.id !== "string" ||
        typeof entry.name !== "string" ||
        typeof entry.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(entry.updatedAt))
      )
        continue;
      const href = officeEditorUrl("/v1/office-documents", entry.id);
      if (!href) continue;
      documents.push({
        id: `savia:${entry.id}`,
        name: entry.name,
        provider: "savia",
        href,
        updatedAt: entry.updatedAt,
      });
    }
  }
  if (Array.isArray(connected)) {
    for (const entry of connected) {
      if (
        !isRecord(entry) ||
        typeof entry.id !== "string" ||
        typeof entry.name !== "string" ||
        typeof entry.createdAt !== "string" ||
        !Number.isFinite(Date.parse(entry.createdAt)) ||
        typeof entry.url !== "string" ||
        !providers.has(entry.provider as StorageProvider) ||
        entry.provider === "savia"
      )
        continue;
      try {
        if (new URL(entry.url).protocol !== "https:") continue;
      } catch {
        continue;
      }
      documents.push({
        id: `connected:${entry.id}`,
        name: entry.name,
        provider: entry.provider as StorageProvider,
        href: entry.url,
        updatedAt: entry.createdAt,
      });
    }
  }
  const sorted = documents.sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
  return { documents: sorted.slice(0, 5), hasMore: sorted.length > 5 };
}

export function OfficeDocumentsWidgetBody({
  apiClient,
}: {
  apiClient: ApiClient | undefined;
}) {
  const t = useMessages(officeDocumentsWidgetMessages);
  const [state, setState] = useState<WidgetState>(emptyState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [loadedClient, setLoadedClient] = useState<ApiClient>();
  const loadedClientRef = useRef<ApiClient | undefined>(undefined);
  const hasSuccessfulRead = useRef(false);
  const generation = useRef(0);
  const publish = useCallback((next: WidgetState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const load = useCallback(
    async (background = true) => {
      const request = ++generation.current;
      const previous = stateRef.current;
      const hasCurrentRead =
        loadedClientRef.current === apiClient && hasSuccessfulRead.current;
      if (background && hasCurrentRead) {
        publish({ ...previous, refreshing: true });
      } else {
        if (!hasCurrentRead) {
          hasSuccessfulRead.current = false;
          loadedClientRef.current = undefined;
          setLoadedClient(undefined);
        }
        publish(emptyState);
      }
      if (!apiClient) {
        hasSuccessfulRead.current = false;
        loadedClientRef.current = undefined;
        setLoadedClient(undefined);
        publish({ status: "error", documents: [], hasMore: false });
        return;
      }
      try {
        const settings = await apiClient.get<{ data: { enabled: boolean } }>(
          "/v1/office-settings",
          { signal: AbortSignal.timeout(15_000) },
        );
        if (request !== generation.current) return;
        if (settings.data.enabled !== true) {
          hasSuccessfulRead.current = true;
          loadedClientRef.current = apiClient;
          setLoadedClient(apiClient);
          publish({ status: "disabled", documents: [], hasMore: false });
          return;
        }
        const [savedResult, connectedResult] = await Promise.allSettled([
          apiClient.get<{ data: unknown[] }>("/v1/office-documents", {
            signal: AbortSignal.timeout(15_000),
          }),
          apiClient.get<{ data: unknown[] }>("/v1/connected-office-documents", {
            signal: AbortSignal.timeout(15_000),
          }),
        ]);
        if (request !== generation.current) return;
        const saved =
          savedResult.status === "fulfilled" ? savedResult.value.data : [];
        const connected =
          connectedResult.status === "fulfilled"
            ? connectedResult.value.data
            : [];
        const retainedFromFailedSource = hasCurrentRead
          ? previous.documents.filter((document) =>
              document.provider === "savia"
                ? savedResult.status === "rejected" &&
                  !isAccessDenied(savedResult.reason)
                : connectedResult.status === "rejected" &&
                  !isAccessDenied(connectedResult.reason),
            )
          : [];
        const currentDocuments = toRecentDocuments(saved, connected);
        if (
          savedResult.status === "rejected" &&
          connectedResult.status === "rejected"
        ) {
          const deniedSaved = isAccessDenied(savedResult.reason);
          const deniedConnected = isAccessDenied(connectedResult.reason);
          const retained = hasCurrentRead
            ? previous.documents.filter((document) =>
                document.provider === "savia" ? !deniedSaved : !deniedConnected,
              )
            : [];
          hasSuccessfulRead.current =
            hasCurrentRead &&
            !(deniedSaved && deniedConnected) &&
            (retained.length > 0 || (!deniedSaved && !deniedConnected));
          publish({
            status: "error",
            documents: retained,
            hasMore: previous.hasMore,
          });
          loadedClientRef.current = apiClient;
          setLoadedClient(apiClient);
          return;
        }
        const documents = [
          ...currentDocuments.documents,
          ...retainedFromFailedSource.filter(
            (document) =>
              !currentDocuments.documents.some(
                (current) => current.id === document.id,
              ),
          ),
        ].sort(
          (left, right) =>
            Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
        );
        publish({
          status:
            savedResult.status === "fulfilled" &&
            connectedResult.status === "fulfilled"
              ? "ready"
              : "partial",
          documents,
          hasMore: currentDocuments.hasMore,
        });
        hasSuccessfulRead.current = true;
        loadedClientRef.current = apiClient;
        setLoadedClient(apiClient);
      } catch (error) {
        if (request !== generation.current) return;
        if (isAccessDenied(error)) {
          hasSuccessfulRead.current = false;
          loadedClientRef.current = undefined;
          setLoadedClient(apiClient);
          publish({ status: "error", documents: [], hasMore: false });
          return;
        }
        if (hasCurrentRead) {
          publish({ ...previous, status: "error", refreshing: false });
          loadedClientRef.current = apiClient;
          setLoadedClient(apiClient);
        } else {
          publish({ status: "error", documents: [], hasMore: false });
          loadedClientRef.current = apiClient;
          setLoadedClient(apiClient);
        }
      }
    },
    [apiClient, publish],
  );

  useEffect(() => {
    void load(false);
    const refresh = () => void load(true);
    const resetAndRefresh = () => {
      generation.current += 1;
      hasSuccessfulRead.current = false;
      loadedClientRef.current = undefined;
      setLoadedClient(undefined);
      publish(emptyState);
      void load(false);
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("savia:personal-integrations-changed", refresh);
    window.addEventListener("savia:office-settings-changed", refresh);
    window.addEventListener("savia:principal-changed", resetAndRefresh);
    window.addEventListener("savia:active-tenant-changed", resetAndRefresh);
    window.addEventListener("savia:session-cleared", resetAndRefresh);
    return () => {
      generation.current += 1;
      window.removeEventListener("focus", refresh);
      window.removeEventListener(
        "savia:personal-integrations-changed",
        refresh,
      );
      window.removeEventListener("savia:office-settings-changed", refresh);
      window.removeEventListener("savia:principal-changed", resetAndRefresh);
      window.removeEventListener(
        "savia:active-tenant-changed",
        resetAndRefresh,
      );
      window.removeEventListener("savia:session-cleared", resetAndRefresh);
    };
  }, [load, publish]);

  if (
    state.status === "loading" ||
    (apiClient !== undefined && loadedClient !== apiClient)
  )
    return (
      <div
        role="status"
        aria-label={t("Loading recent documents")}
        className="space-y-2"
      >
        <span className="sr-only">{t("Loading recent documents")}</span>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-4/5" />
      </div>
    );

  if (state.status === "disabled")
    return (
      <p className="text-sm text-muted-foreground">
        {t("Office suite is disabled for this workspace.")}
      </p>
    );

  return (
    <div className="space-y-3">
      <ReadRefreshStatus
        refreshing={state.refreshing}
        error={
          state.status === "error" && hasSuccessfulRead.current
            ? t("Could not load recent documents.")
            : undefined
        }
        onRetry={() => void load(true)}
      />
      {state.status === "error" && !hasSuccessfulRead.current ? (
        <div role="alert" className="flex items-center justify-between gap-2">
          <p className="text-sm text-destructive">
            {t("Could not load recent documents.")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
          >
            {t("Retry")}
          </Button>
        </div>
      ) : null}
      {state.status === "partial" ? (
        <div role="alert" className="flex items-center justify-between gap-2">
          <p className="text-sm text-destructive">
            {state.documents.length > 0
              ? t(
                  "One document source could not be loaded. Showing available documents.",
                )
              : t(
                  "One document source could not be loaded. The list may be incomplete.",
                )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
          >
            {t("Retry")}
          </Button>
        </div>
      ) : null}
      {state.status !== "error" || hasSuccessfulRead.current ? (
        <>
          {state.documents.length > 0 ? (
            <ul className="divide-y">
              {state.documents.map((document) => (
                <li key={document.id}>
                  <a
                    href={document.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 items-center gap-2 rounded-sm py-2 text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <StorageProviderIcon
                      provider={document.provider}
                      className="size-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {document.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {t(
                          providerName(
                            document.provider,
                          ) as keyof typeof officeDocumentsWidgetMessages,
                        )}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {state.status === "partial"
                ? t(
                    "No documents found in the available source; the list may be incomplete.",
                  )
                : t("No recent documents yet.")}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <Button asChild variant="outline" size="sm">
              <a href="/#/office-suite">{t("New document")}</a>
            </Button>
            {state.hasMore ? (
              <a
                href="/#/office-suite"
                className="rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("View all documents")}
              </a>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
