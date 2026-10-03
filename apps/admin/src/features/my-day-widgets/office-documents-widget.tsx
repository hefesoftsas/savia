import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

type WidgetState =
  | { status: "loading"; documents: RecentDocument[]; hasMore: boolean }
  | { status: "disabled"; documents: RecentDocument[]; hasMore: boolean }
  | { status: "ready"; documents: RecentDocument[]; hasMore: boolean }
  | { status: "error"; documents: RecentDocument[]; hasMore: boolean };

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
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState(emptyState);
    if (!apiClient) {
      setState({ status: "error", documents: [], hasMore: false });
      return;
    }
    try {
      const settings = await apiClient.get<{ data: { enabled: boolean } }>(
        "/v1/office-settings",
        { signal: AbortSignal.timeout(15_000) },
      );
      if (request !== generation.current) return;
      if (settings.data.enabled !== true) {
        setState({ status: "disabled", documents: [], hasMore: false });
        return;
      }
      const [saved, connected] = await Promise.all([
        apiClient.get<{ data: unknown[] }>("/v1/office-documents", {
          signal: AbortSignal.timeout(15_000),
        }),
        apiClient.get<{ data: unknown[] }>("/v1/connected-office-documents", {
          signal: AbortSignal.timeout(15_000),
        }),
      ]);
      if (request !== generation.current) return;
      setState({
        status: "ready",
        ...toRecentDocuments(saved.data, connected.data),
      });
    } catch {
      if (request === generation.current)
        setState({ status: "error", documents: [], hasMore: false });
    }
  }, [apiClient]);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    const resetAndRefresh = () => {
      generation.current += 1;
      setState(emptyState);
      void load();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("savia:personal-integrations-changed", refresh);
    window.addEventListener("savia:office-settings-changed", refresh);
    window.addEventListener("savia:identity-changed", resetAndRefresh);
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
      window.removeEventListener("savia:identity-changed", resetAndRefresh);
      window.removeEventListener(
        "savia:active-tenant-changed",
        resetAndRefresh,
      );
      window.removeEventListener("savia:session-cleared", resetAndRefresh);
    };
  }, [load]);

  if (state.status === "loading")
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
      {state.status === "error" ? (
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
      ) : state.documents.length > 0 ? (
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
          {t("No recent documents yet.")}
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
    </div>
  );
}
