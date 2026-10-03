import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  Table2,
  Presentation,
  ArrowUpRight,
  Search,
  Plus,
  RefreshCw,
  Check,
  Trash2,
  Share2,
} from "lucide-react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMessages, useAppLocale } from "@/i18n/core";
import { OfficeSharePanel } from "./office-share-panel";
import { officeSuiteMessages } from "./messages";
import { StorageProviderIcon } from "./storage-provider-icon";
import { createBlankOfficeFile } from "../office/new-office-file";
import { officeEditorUrl } from "../office/office-api";
import { officeFormat, type OfficeFormat } from "@savia/studio-shared/office";

type DocumentSummary = {
  role: "owner" | "reader" | "editor";
  ownerName: string;
  id: string;
  name: string;
  mime: string;
  size: number;
  version: number;
  updatedAt: string;
};
type ConnectedOfficeProvider = {
  provider: ConnectedOfficeProviderId;
  label: string;
  accountLabel: string | null;
};
type ConnectedOfficeProviderId =
  "google_drive" | "onedrive_personal" | "onedrive_business";
type ConnectedOfficeDocument = {
  id: string;
  name: string;
  format: OfficeFormat;
  provider: ConnectedOfficeProviderId;
  url: string;
  createdAt: string;
};
type StorageChoice = "savia" | ConnectedOfficeProviderId;
const types = [
  {
    format: "docx",
    label: "Document",
    description: "Text, reports and notes",
    icon: FileText,
    color: "text-blue-600 dark:text-blue-400",
  },
  {
    format: "xlsx",
    label: "Spreadsheet",
    description: "Tables, formulas and data",
    icon: Table2,
    color: "text-emerald-700 dark:text-emerald-400",
  },
  {
    format: "pptx",
    label: "Presentation",
    description: "Ideas in slides",
    icon: Presentation,
    color: "text-orange-700 dark:text-orange-400",
  },
] as const;
const base = "/v1/office-documents";
const connectedBase = "/v1/connected-office-documents";

function isCloudUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
function isConnectedProviderId(
  value: unknown,
): value is ConnectedOfficeProviderId {
  return ["google_drive", "onedrive_personal", "onedrive_business"].includes(
    String(value),
  );
}
function isConnectedOfficeDocument(
  value: ConnectedOfficeDocument,
): value is ConnectedOfficeDocument {
  return Boolean(
    value &&
    typeof value.id === "string" &&
    value.id &&
    typeof value.name === "string" &&
    value.name &&
    ["docx", "xlsx", "pptx"].includes(value.format) &&
    isConnectedProviderId(value.provider) &&
    typeof value.url === "string" &&
    isCloudUrl(value.url),
  );
}

export function OfficeSuitePage({
  services,
}: {
  services: { apiClient: ApiClient };
}) {
  const t = useMessages(officeSuiteMessages);
  const locale = useAppLocale();
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [connectedDocuments, setConnectedDocuments] = useState<
    ConnectedOfficeDocument[]
  >([]);
  const [connectedProviders, setConnectedProviders] = useState<
    ConnectedOfficeProvider[]
  >([]);
  const [format, setFormat] = useState<OfficeFormat>("docx");
  const [name, setName] = useState("");
  const [storage, setStorage] = useState<StorageChoice>("savia");
  const [search, setSearch] = useState("");
  const [storageFilter, setStorageFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [connectedLoading, setConnectedLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [createError, setCreateError] = useState("");
  const [providerError, setProviderError] = useState("");
  const [connectedDocumentsError, setConnectedDocumentsError] = useState("");
  const [saved, setSaved] = useState(false);
  const [connectedSaved, setConnectedSaved] =
    useState<ConnectedOfficeDocument>();
  const [shareTarget, setShareTarget] = useState<DocumentSummary>();
  const [shareNotice, setShareNotice] = useState(false);
  const shareContext = useRef(0);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "local"; document: DocumentSummary }
    | { kind: "connected"; document: ConnectedOfficeDocument }
  >();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deletingRef = useRef(false);
  const creatingRef = useRef(false);
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const connectedLoadGeneration = useRef(0);
  const contextGeneration = useRef(0);
  const requestRef = useRef<{ signature: string; id: string } | undefined>(
    undefined,
  );
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError("");
    try {
      const response = await services.apiClient.get<{
        data: DocumentSummary[];
      }>(base);
      if (mounted.current && generation === loadGeneration.current) {
        setDocuments(response.data);
        setDeleteTarget((current) =>
          current?.kind === "local"
            ? (() => {
                const document = response.data.find(
                  (item) => item.id === current.document.id,
                );
                return document ? { kind: "local", document } : undefined;
              })()
            : current,
        );
      }
    } catch (error) {
      if (mounted.current && generation === loadGeneration.current)
        setLoadError(
          error instanceof Error
            ? error.message
            : t("Could not load documents."),
        );
    } finally {
      if (mounted.current && generation === loadGeneration.current)
        setLoading(false);
    }
  }, [services.apiClient, t]);
  const loadConnected = useCallback(async () => {
    const generation = ++connectedLoadGeneration.current;
    setConnectedLoading(true);
    setProviderError("");
    setConnectedDocumentsError("");
    const [providerResult, documentsResult] = await Promise.allSettled([
      services.apiClient.get<{ data: ConnectedOfficeProvider[] }>(
        `${connectedBase}/providers`,
      ),
      services.apiClient.get<{ data: ConnectedOfficeDocument[] }>(
        connectedBase,
      ),
    ]);
    if (!mounted.current || generation !== connectedLoadGeneration.current)
      return;
    setConnectedLoading(false);
    if (providerResult.status === "fulfilled") {
      const nextProviders = providerResult.value.data.filter(
        (provider) =>
          isConnectedProviderId(provider.provider) &&
          typeof provider.label === "string" &&
          (typeof provider.accountLabel === "string" ||
            provider.accountLabel === null),
      );
      setConnectedProviders(nextProviders);
      const available = new Set(nextProviders.map((entry) => entry.provider));
      setStorageFilter((current) =>
        (current === "google_drive" && !available.has("google_drive")) ||
        (current === "onedrive" &&
          !nextProviders.some((entry) =>
            entry.provider.startsWith("onedrive_"),
          ))
          ? "all"
          : current,
      );
      setStorage((current) =>
        current === "savia" || available.has(current) ? current : "savia",
      );
    } else {
      setConnectedProviders([]);
      setStorage("savia");
      setStorageFilter("all");
      setProviderError(t("Could not load connected storage providers."));
    }
    if (documentsResult.status === "fulfilled") {
      setConnectedDocuments(
        documentsResult.value.data.filter(isConnectedOfficeDocument),
      );
    } else {
      setConnectedDocumentsError(
        t("Could not load connected-drive documents."),
      );
    }
  }, [services.apiClient, t]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (!creatingRef.current && !deletingRef.current) {
        void load();
        void loadConnected();
      }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("savia:personal-integrations-changed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(
        "savia:personal-integrations-changed",
        refresh,
      );
    };
  }, [load, loadConnected]);
  useEffect(() => {
    mounted.current = true;
    void loadConnected();
    return () => {
      mounted.current = false;
    };
  }, [loadConnected]);
  useEffect(() => {
    const contextChanged = () => {
      ++contextGeneration.current;
      ++loadGeneration.current;
      ++connectedLoadGeneration.current;
      setDocuments([]);
      setConnectedDocuments([]);
      setConnectedProviders([]);
      setStorage("savia");
      setStorageFilter("all");
      setDeleteTarget(undefined);
      setDeleteError("");
      setShareTarget(undefined);
      setShareNotice(false);
      setSaved(false);
      setConnectedSaved(undefined);
      setCreateError("");
      requestRef.current = undefined;
      void load();
      void loadConnected();
    };
    const events = [
      "savia:active-tenant-changed",
      "savia:identity-changed",
      "savia:session-cleared",
    ];
    for (const event of events) window.addEventListener(event, contextChanged);
    return () => {
      for (const event of events)
        window.removeEventListener(event, contextChanged);
    };
  }, [load, loadConnected]);
  const hasGoogleDrive = connectedProviders.some(
    (entry) => entry.provider === "google_drive",
  );
  const hasOneDrive = connectedProviders.some((entry) =>
    entry.provider.startsWith("onedrive_"),
  );
  async function removeDocument() {
    if (!deleteTarget || deletingRef.current) return;
    const target = deleteTarget;
    const context = contextGeneration.current;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError("");
    // Invalidate list requests started before deletion so they cannot restore it.
    ++loadGeneration.current;
    ++connectedLoadGeneration.current;
    try {
      await services.apiClient.delete(
        `${target.kind === "local" ? base : connectedBase}/${encodeURIComponent(target.document.id)}`,
        target.kind === "local"
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ version: target.document.version }),
            }
          : undefined,
      );
      if (!mounted.current || context !== contextGeneration.current) return;
      if (target.kind === "local") {
        setDocuments((current) =>
          current.filter((item) => item.id !== target.document.id),
        );
        setSaved(false);
      } else {
        setConnectedDocuments((current) =>
          current.filter((item) => item.id !== target.document.id),
        );
        setConnectedSaved(undefined);
      }
      setDeleteTarget(undefined);
    } catch (error) {
      if (mounted.current && context === contextGeneration.current) {
        setDeleteError(
          error instanceof Error
            ? error.message
            : t("Could not delete the document. Try again."),
        );
        // A version conflict needs the current summary before retrying.
        await Promise.all([load(), loadConnected()]);
      }
    } finally {
      deletingRef.current = false;
      if (mounted.current) setDeleting(false);
      if (mounted.current && context === contextGeneration.current) {
        setLoading(false);
        setConnectedLoading(false);
      }
    }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (creatingRef.current || !name.trim()) return;
    const context = contextGeneration.current;
    creatingRef.current = true;
    setCreating(true);
    setCreateError("");
    setSaved(false);
    setConnectedSaved(undefined);
    let waitingTab: Window | null = null;
    try {
      if (storage === "savia") {
        const file = await createBlankOfficeFile(format, name);
        if (!mounted.current || context !== contextGeneration.current) return;
        const body = new FormData();
        body.set("file", file);
        const response = await services.apiClient.request<{
          data: DocumentSummary;
        }>(base, { method: "POST", body });
        if (!mounted.current || context !== contextGeneration.current) return;
        ++loadGeneration.current;
        setLoading(false);
        setLoadError("");
        setDocuments((current) => [
          response.data,
          ...current.filter((item) => item.id !== response.data.id),
        ]);
        requestRef.current = undefined;
        setName("");
        setSearch("");
        setSaved(true);
      } else {
        // Open synchronously from the submit gesture so the eventual provider
        // redirect is not blocked. The saved list remains the manual fallback.
        try {
          waitingTab = window.open("about:blank", "_blank");
          if (waitingTab) {
            waitingTab.opener = null;
            waitingTab.document.title = t("Preparing connected document…");
            waitingTab.document.body.textContent = t(
              "Preparing connected document…",
            );
          }
        } catch {
          waitingTab = null;
        }
        const signature = JSON.stringify([storage, format, name.trim()]);
        if (requestRef.current?.signature !== signature)
          requestRef.current = { signature, id: crypto.randomUUID() };
        const body = new FormData();
        body.set("provider", storage);
        body.set("format", format);
        body.set("name", name.trim());
        body.set("requestId", requestRef.current.id);
        if (storage !== "google_drive")
          body.set("file", await createBlankOfficeFile(format, name));
        if (!mounted.current || context !== contextGeneration.current) {
          waitingTab?.close();
          return;
        }
        const response = await services.apiClient.request<{
          data: ConnectedOfficeDocument;
        }>(connectedBase, { method: "POST", body });
        const cloudDocument = response.data;
        if (!mounted.current || context !== contextGeneration.current) {
          waitingTab?.close();
          return;
        }
        if (
          !isConnectedOfficeDocument(cloudDocument) ||
          cloudDocument.provider !== storage ||
          cloudDocument.format !== format
        )
          throw new Error(t("The connected document response was invalid."));
        if (waitingTab) {
          try {
            waitingTab.location.replace(cloudDocument.url);
          } catch {
            try {
              waitingTab.close();
            } catch {
              /* the saved document link below remains available */
            }
            waitingTab = null;
          }
        }
        if (!mounted.current) return;
        ++connectedLoadGeneration.current;
        setConnectedDocumentsError("");
        setConnectedDocuments((current) => [
          cloudDocument,
          ...current.filter((item) => item.id !== cloudDocument.id),
        ]);
        requestRef.current = undefined;
        setConnectedSaved(cloudDocument);
        setSearch("");
      }
    } catch (error) {
      try {
        waitingTab?.close();
      } catch {
        /* popup closure is best-effort */
      }
      if (mounted.current && context === contextGeneration.current)
        setCreateError(
          error instanceof Error
            ? error.message
            : t("Could not create the document."),
        );
    } finally {
      creatingRef.current = false;
      if (mounted.current) setCreating(false);
    }
  }
  const filtered = documents.filter(
    (document) =>
      (storageFilter === "all" || storageFilter === "savia") &&
      document.name
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const filteredConnected = connectedDocuments.filter(
    (document) =>
      (storageFilter === "all" ||
        (storageFilter === "onedrive"
          ? document.provider.startsWith("onedrive_")
          : storageFilter === document.provider)) &&
      document.name
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const cloudProviderLabel = (provider: ConnectedOfficeProviderId) => {
    switch (provider) {
      case "google_drive":
        return t("Google Drive");
      case "onedrive_personal":
        return t("OneDrive personal");
      case "onedrive_business":
        return t("OneDrive work or school");
    }
  };
  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 p-4 sm:p-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Office suite")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("Create Office documents and choose where each one is stored.")}
        </p>
      </header>
      <section
        aria-labelledby="new-office-document"
        className="space-y-4 border-b pb-8"
      >
        <h2 id="new-office-document" className="text-base font-semibold">
          {t("New document")}
        </h2>
        <form onSubmit={(event) => void create(event)} className="space-y-5">
          <fieldset
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            disabled={creating}
          >
            <legend className="sr-only">{t("New document")}</legend>
            {types.map((type) => (
              <button
                key={type.format}
                type="button"
                aria-pressed={format === type.format}
                onClick={() => {
                  setFormat(type.format);
                  setSaved(false);
                  setConnectedSaved(undefined);
                  requestRef.current = undefined;
                }}
                className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${format === type.format ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/50"}`}
              >
                <type.icon
                  aria-hidden="true"
                  className={`size-7 shrink-0 ${type.color}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {t(type.label)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(type.description)}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  .{type.format}
                </span>
              </button>
            ))}
          </fieldset>
          <div className="grid max-w-xl gap-2">
            <Label htmlFor="office-document-storage">
              {t("Save document in")}
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                <StorageProviderIcon provider={storage} />
              </span>
              <select
                id="office-document-storage"
                value={storage}
                onChange={(event) => {
                  setStorage(event.target.value as StorageChoice);
                  requestRef.current = undefined;
                  setConnectedSaved(undefined);
                  setSaved(false);
                }}
                disabled={creating}
                className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10"
              >
                <option value="savia">{t("Savia (default)")}</option>
                {connectedProviders.map((provider) => (
                  <option key={provider.provider} value={provider.provider}>
                    {cloudProviderLabel(provider.provider)}
                    {provider.accountLabel ? ` — ${provider.accountLabel}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "Savia stores the document content. Connected-drive entries save a reference in Savia.",
              )}
            </p>
            {!connectedLoading &&
            !providerError &&
            !connectedProviders.length ? (
              <p className="text-xs text-muted-foreground">
                {t(
                  "Connect a personal Google Drive or OneDrive account to create documents there.",
                )}{" "}
                <a
                  href="/#/my-integrations"
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {t("My integrations")}
                </a>
              </p>
            ) : null}
            {providerError ? (
              <div role="alert" className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-destructive">{providerError}</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={creating}
                  onClick={() => void loadConnected()}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  {t("Retry")}
                </Button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="office-document-name">{t("Document name")}</Label>
              <Input
                id="office-document-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  requestRef.current = undefined;
                  setSaved(false);
                  setConnectedSaved(undefined);
                }}
                maxLength={180}
                disabled={creating}
                required
                autoComplete="off"
              />
            </div>
            <Button
              type="submit"
              className="max-sm:h-11"
              disabled={creating || !name.trim()}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t(creating ? "Creating…" : "Create and save")}
            </Button>
          </div>
          {createError && (
            <p
              role="alert"
              className="text-sm text-destructive [overflow-wrap:anywhere]"
            >
              {createError}
            </p>
          )}
          {saved && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Check className="size-4 text-primary" aria-hidden="true" />
              {t("Document saved. Open it below to start editing.")}
            </p>
          )}
          {connectedSaved ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Check className="size-4 text-primary" aria-hidden="true" />
              {t("Connected document saved. Open it below or in the new tab.")}
            </p>
          ) : null}
        </form>
      </section>
      <section aria-labelledby="saved-office-documents" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="saved-office-documents" className="text-base font-semibold">
            {t("Saved documents")}
          </h2>
          <div className="relative sm:w-64">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
            />
            <Input
              aria-label={t("Search documents")}
              placeholder={t("Search documents")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-11 pl-9 sm:h-9"
            />
          </div>
        </div>
        <div
          role="group"
          aria-label={t("Filter by storage")}
          className="flex flex-wrap gap-1.5"
        >
          {[
            { id: "all", label: t("All storage") },
            { id: "savia", label: "Savia", provider: "savia" as const },
            ...(hasGoogleDrive
              ? [
                  {
                    id: "google_drive",
                    label: t("Google Drive"),
                    provider: "google_drive" as const,
                  },
                ]
              : []),
            ...(hasOneDrive
              ? [
                  {
                    id: "onedrive",
                    label: "OneDrive",
                    provider: "onedrive_personal" as const,
                  },
                ]
              : []),
          ].map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={storageFilter === filter.id}
              onClick={() => setStorageFilter(filter.id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 ${storageFilter === filter.id ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              {filter.provider ? (
                <StorageProviderIcon provider={filter.provider} />
              ) : null}
              {filter.label}
            </button>
          ))}
        </div>
        {connectedDocumentsError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-destructive">
              {connectedDocumentsError}
            </p>
            <Button variant="outline" onClick={() => void loadConnected()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {t("Retry")}
            </Button>
          </div>
        ) : null}
        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {t("Retry")}
            </Button>
          </div>
        ) : null}
        {(loading || connectedLoading) &&
        !filtered.length &&
        !filteredConnected.length ? (
          <p role="status" className="py-8 text-sm text-muted-foreground">
            {t("Loading documents…")}
          </p>
        ) : !loading &&
          !connectedLoading &&
          !loadError &&
          !connectedDocumentsError &&
          !filtered.length &&
          !filteredConnected.length ? (
          <div className="space-y-2 py-10 text-center">
            <FileText
              className="mx-auto mb-4 size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <h3 className="font-medium">
              {t(
                documents.length || connectedDocuments.length
                  ? "No matching documents"
                  : "You have no documents yet",
              )}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t(
                documents.length || connectedDocuments.length
                  ? "Try another name."
                  : "Choose a type and name your first document above.",
              )}
            </p>
          </div>
        ) : filtered.length || filteredConnected.length ? (
          <ul className="divide-y overflow-hidden rounded-xl border">
            {filtered.map((document) => {
              const type =
                types.find(
                  (type) =>
                    type.format === officeFormat(document.name, document.mime),
                ) ?? types[0];
              const url = officeEditorUrl(base, document.id);
              return (
                <li
                  key={document.id}
                  className="flex min-w-0 items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/30 sm:gap-4"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                    <type.icon
                      className={`size-5 shrink-0 ${type.color}`}
                      aria-hidden="true"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-2 rounded font-medium text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="truncate">{document.name}</span>
                        <ArrowUpRight
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </a>
                    )}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <StorageProviderIcon
                          provider="savia"
                          className="size-3.5"
                        />
                        Savia
                      </span>
                      {document.role === "reader" ||
                      document.role === "editor" ? (
                        <>
                          <span>
                            {t("Shared by")} {document.ownerName}
                          </span>
                          <span>
                            {t(
                              document.role === "reader"
                                ? "Can view"
                                : "Can edit",
                            )}
                          </span>
                        </>
                      ) : null}
                      <span>
                        {t("Version")} {document.version} ·{" "}
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(document.updatedAt))}
                      </span>
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {Math.max(1, Math.ceil(document.size / 1024))} KB
                  </span>
                  {document.role === "owner" ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={deleting}
                        aria-label={`${t("Share document")}: ${document.name}`}
                        onClick={() => {
                          setShareNotice(false);
                          shareContext.current = contextGeneration.current;
                          setShareTarget(document);
                        }}
                      >
                        <Share2 className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={deleting}
                        aria-label={`${t("Delete document")}: ${document.name}`}
                        onClick={() => {
                          setDeleteError("");
                          setDeleteTarget({ kind: "local", document });
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>{" "}
                    </>
                  ) : null}
                </li>
              );
            })}
            {filteredConnected.map((document) => {
              const type =
                types.find((item) => item.format === document.format) ??
                types[0];
              return (
                <li
                  key={`connected:${document.id}`}
                  className="flex min-w-0 items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/30 sm:gap-4"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                    <type.icon
                      className={`size-5 shrink-0 ${type.color}`}
                      aria-hidden="true"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={document.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-full items-center gap-2 rounded font-medium text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="truncate">{document.name}</span>
                      <ArrowUpRight
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </a>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {connectedProviders.some(
                          (entry) => entry.provider === document.provider,
                        ) ? (
                          <StorageProviderIcon
                            provider={document.provider}
                            className="size-3.5"
                          />
                        ) : null}
                        {cloudProviderLabel(document.provider)}
                      </span>
                      {Number.isFinite(Date.parse(document.createdAt)) ? (
                        <span>
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: "medium",
                          }).format(new Date(document.createdAt))}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={deleting}
                    aria-label={`${t("Remove reference")}: ${document.name}`}
                    onClick={() => {
                      setDeleteError("");
                      setDeleteTarget({ kind: "connected", document });
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {shareNotice ? (
          <p role="status" className="text-sm">
            {t("Permissions saved.")}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t(
            "Savia documents can be shared with members of this workspace. Connected-drive permissions are managed by their provider.",
          )}
        </p>
      </section>
      <Dialog
        open={Boolean(shareTarget)}
        onOpenChange={(open) => {
          if (!open) setShareTarget(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Share document")}</DialogTitle>
            <DialogDescription className="break-words">
              {shareTarget?.name}
            </DialogDescription>
          </DialogHeader>
          {shareTarget ? (
            <OfficeSharePanel
              key={shareTarget.id}
              apiClient={services.apiClient}
              documentId={shareTarget.id}
              onDone={() => {
                if (
                  !mounted.current ||
                  shareContext.current !== contextGeneration.current
                )
                  return;
                setShareTarget(undefined);
                setShareNotice(true);
                void load();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteTarget(undefined);
            setDeleteError("");
          }
        }}
      >
        <DialogContent
          aria-busy={deleting}
          onEscapeKeyDown={(event) => {
            if (deleting) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (deleting) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(
                deleteTarget?.kind === "connected"
                  ? "Remove reference"
                  : "Delete document",
              )}
            </DialogTitle>
            <DialogDescription>
              <span className="block break-words font-medium">
                {deleteTarget?.document.name}
              </span>
              {t(
                deleteTarget?.kind === "connected"
                  ? "The file will remain in Google Drive or OneDrive. Only its saved link in Savia will be removed."
                  : "This will permanently delete the document and all its versions. This action cannot be undone.",
              )}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p
              role="alert"
              className="text-sm text-destructive [overflow-wrap:anywhere]"
            >
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => {
                setDeleteTarget(undefined);
                setDeleteError("");
              }}
            >
              {t("Cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleting || loading}
              onClick={() => void removeDocument()}
            >
              {t(
                deleting
                  ? "Deleting…"
                  : deleteTarget?.kind === "connected"
                    ? "Remove reference"
                    : "Delete document",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
