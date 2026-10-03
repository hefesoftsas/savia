import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
  useBlocker,
  Link,
} from "react-router-dom";
import type { AppServices } from "@/app-services";
import { ApiClientError } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useMessages } from "@/i18n/core";
import {
  Folder,
  MoreHorizontal,
  History,
  Trash2,
  FolderPlus,
  FilePlus2,
  FileText,
  Plus,
  Search,
  LockKeyhole,
  Users,
  ChevronRight,
  Download,
  Upload,
} from "lucide-react";
import { pagesMessages } from "./messages";
import {
  PagesClient,
  type PageDocument,
  type PageSummary,
  type PagesArchive,
} from "./client";
import { PageSaveQueue } from "./save-queue";
import { PageEditor } from "./editor";
import { SharePanel } from "./share-panel";
import { HistoryWorkspace } from "./history-workspace";
import { RecordProperties } from "./record-properties";
import type { Value } from "platejs";
import { publishPageChange, subscribePageChanges } from "./page-events";
import { exportPageMarkdown } from "./markdown-export";
import { useIssueProviders, type IssueProvider } from "./use-issue-providers";
import { PagesCloudflareSearch } from "@/features/tenant-pages-search/pages-cloudflare-search";
import { retireLocalPageSearchCaches } from "@/features/tenant-pages-search/retire-local-search-cache";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import "./pages.css";

const MAX_PAGES_ARCHIVE_BYTES = 50 * 1024 * 1024;

function isPagesArchive(value: unknown): value is PagesArchive {
  if (!value || typeof value !== "object") return false;
  const archive = value as Record<string, unknown>;
  return (
    archive.format === "savia-pages" &&
    archive.version === 1 &&
    typeof archive.exportedAt === "string" &&
    Array.isArray(archive.pages) &&
    archive.pages.every((page) => {
      if (!page || typeof page !== "object") return false;
      const item = page as Record<string, unknown>;
      return (
        typeof item.id === "string" &&
        (typeof item.parentId === "string" || item.parentId === null) &&
        typeof item.title === "string" &&
        (item.kind === "page" || item.kind === "folder") &&
        Array.isArray(item.content)
      );
    }) &&
    Array.isArray(archive.files) &&
    archive.files.every((file) => {
      if (!file || typeof file !== "object") return false;
      const item = file as Record<string, unknown>;
      return (
        typeof item.id === "string" &&
        typeof item.pageId === "string" &&
        typeof item.name === "string" &&
        typeof item.mimeType === "string" &&
        typeof item.size === "number" &&
        typeof item.data === "string"
      );
    })
  );
}

export function PagesPage({
  services,
}: {
  services: Pick<AppServices, "apiClient">;
}) {
  const t = useMessages(pagesMessages),
    navigate = useNavigate(),
    { pageId } = useParams();
  const [searchParams] = useSearchParams();
  const issueProviders = useIssueProviders(services.apiClient);
  const client = useMemo(
    () => new PagesClient(services.apiClient),
    [services.apiClient],
  );
  const [pages, setPages] = useState<PageSummary[]>([]),
    [document, setDocument] = useState<PageDocument | null>(null);
  const [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [generation, setGeneration] = useState(0);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false),
    [archiveFile, setArchiveFile] = useState<File | null>(null),
    [archiveBusy, setArchiveBusy] = useState(false),
    [exportingArchive, setExportingArchive] = useState(false),
    [archiveError, setArchiveError] = useState<string | null>(null),
    [archiveNotice, setArchiveNotice] = useState<string | null>(null);
  const archiveInput = useRef<HTMLInputElement>(null);
  const canLeave = useRef<() => boolean>(() => true);
  const bindingRequests = useMemo(
    () => new Map<string, Promise<PageSummary>>(),
    [client],
  );
  const listRequest = useRef(0);
  useEffect(() => {
    void retireLocalPageSearchCaches();
  }, []);
  const refresh = useCallback(async () => {
    const request = ++listRequest.current;
    try {
      const result = await client.list(query);
      if (request === listRequest.current) setPages(result);
    } catch {
      if (request === listRequest.current) setError(true);
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [client, query]);
  useEffect(
    () =>
      subscribePageChanges((change) => {
        if (change.api === services.apiClient) void refresh();
      }),
    [refresh, services.apiClient],
  );
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 200);
    return () => clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    let active = true;
    setDocument(null);
    if (pageId)
      void client
        .get(pageId)
        .then((value) => {
          if (active) setDocument(value);
        })
        .catch(() => {
          if (active) setError(true);
        });
    return () => {
      active = false;
    };
  }, [client, pageId, generation]);
  useEffect(() => {
    const domain = searchParams.get("domain"),
      collection = searchParams.get("collection"),
      recordId = searchParams.get("record");
    if (
      pageId ||
      !domain ||
      !collection ||
      !recordId ||
      !/^\/v1\/studio\/\d+$/.test(domain)
    )
      return;
    const key = JSON.stringify({ domain, collection, recordId });
    let active = true;
    setBusy(true);
    let request = bindingRequests.get(key);
    if (!request) {
      request = client.resolveBinding({
        title: `${collection} · ${recordId}`.slice(0, 200),
        binding: { domain, collection, recordId },
      });
      bindingRequests.set(key, request);
    }
    void request
      .then((page) => {
        if (active) {
          navigate(`/pages/${page.id}`, { replace: true });
          setPages((current) =>
            current.some((item) => item.id === page.id)
              ? current
              : [page, ...current],
          );
        }
      })
      .catch(() => {
        bindingRequests.delete(key);
        if (active) setError(true);
      })
      .finally(() => {
        if (bindingRequests.get(key) === request) bindingRequests.delete(key);
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [searchParams, client, navigate, pageId, bindingRequests]);
  async function create(parentId?: string, kind: "page" | "folder" = "page") {
    if (!canLeave.current()) return;
    setBusy(true);
    try {
      const page = await client.create({
        title: t(kind === "folder" ? "Untitled folder" : "Untitled"),
        kind,
        ...(parentId ? { parentId } : {}),
      });
      setQuery("");
      navigate(`/pages/${page.id}`);
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const createRequests = useRef(new Map<string, Promise<PageDocument>>());
  const requestKind = searchParams.get("create"),
    requestParent = searchParams.get("parent");
  useEffect(() => {
    if (pageId || (requestKind !== "page" && requestKind !== "folder")) return;
    let active = true;
    const key = JSON.stringify([requestKind, requestParent]);
    let request = createRequests.current.get(key);
    if (!request) {
      request = client.create({
        title: t(requestKind === "folder" ? "Untitled folder" : "Untitled"),
        kind: requestKind,
        ...(requestParent ? { parentId: requestParent } : {}),
      });
      createRequests.current.set(key, request);
    }
    setBusy(true);
    void request
      .then((page) => {
        if (active) {
          navigate(`/pages/${page.id}`, { replace: true });
          void refresh();
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setBusy(false);
        if (createRequests.current.get(key) === request)
          createRequests.current.delete(key);
      });
    return () => {
      active = false;
    };
  }, [pageId, requestKind, requestParent, client, navigate, t, refresh]);
  const byId = new Map(pages.map((page) => [page.id, page]));
  async function exportAllPages() {
    setArchiveBusy(true);
    setExportingArchive(true);
    setArchiveNotice(null);
    setArchiveError(null);
    try {
      const archive = await client.exportAll();
      const blob = new Blob([JSON.stringify(archive)], {
        type: "application/json;charset=utf-8",
      });
      if (blob.size > MAX_PAGES_ARCHIVE_BYTES) {
        setArchiveError(t("Archive too large"));
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = "my-pages.savia-pages.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setArchiveNotice(t("Pages exported"));
    } catch (failure) {
      setArchiveError(
        failure instanceof ApiClientError &&
          (failure.status === 413 || failure.code === "ARCHIVE_TOO_LARGE")
          ? t("Archive too large")
          : t("Could not export pages"),
      );
    } finally {
      setExportingArchive(false);
      setArchiveBusy(false);
    }
  }
  async function importPages() {
    if (!archiveFile) {
      setArchiveError(t("Select archive first"));
      return;
    }
    if (archiveFile.size > MAX_PAGES_ARCHIVE_BYTES) {
      setArchiveError(t("Archive too large"));
      if (archiveInput.current) archiveInput.current.value = "";
      return;
    }
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await archiveFile.text());
      } catch {
        setArchiveError(t("Invalid archive JSON"));
        if (archiveInput.current) archiveInput.current.value = "";
        return;
      }
      if (!isPagesArchive(parsed)) {
        setArchiveError(t("Invalid archive format"));
        if (archiveInput.current) archiveInput.current.value = "";
        return;
      }
      const result = await client.importArchive(parsed);
      setQuery("");
      setArchiveNotice(
        t("Pages imported", {
          pages: result.pages,
          folders: result.folders,
          files: result.files,
        }),
      );
      setArchiveDialogOpen(false);
      setArchiveFile(null);
      if (archiveInput.current) archiveInput.current.value = "";
      publishPageChange({ api: services.apiClient });
      await refresh();
    } catch (failure) {
      setArchiveError(
        failure instanceof ApiClientError &&
          (failure.status === 413 || failure.code === "ARCHIVE_TOO_LARGE")
          ? t("Archive too large")
          : failure instanceof ApiClientError &&
              failure.code === "INVALID_ARCHIVE"
            ? t("Invalid archive format")
            : t("Could not import pages"),
      );
      if (archiveInput.current) archiveInput.current.value = "";
    } finally {
      setArchiveBusy(false);
    }
  }
  function closeArchiveDialog() {
    setArchiveDialogOpen(false);
    setArchiveError(null);
    setArchiveFile(null);
    if (archiveInput.current) archiveInput.current.value = "";
  }
  const ancestors: PageSummary[] = [];
  let parent = document?.parentId;
  const seen = new Set<string>();
  while (parent && byId.has(parent) && !seen.has(parent)) {
    seen.add(parent);
    const ancestor = byId.get(parent)!;
    ancestors.unshift(ancestor);
    parent = ancestor.parentId;
  }
  return (
    <main className="pages-workspace">
      <section className="pages-canvas">
        {error && (
          <div
            role="alert"
            className="m-6 flex flex-wrap items-center gap-3 text-destructive"
          >
            {t("Unavailable")}
            <Button
              variant="outline"
              onClick={() => {
                if (canLeave.current()) {
                  setError(false);
                  setGeneration((n) => n + 1);
                  void refresh();
                }
              }}
            >
              {t("Reload")}
            </Button>
          </div>
        )}
        {pageId ? (
          document ? (
            <DocumentPane
              key={`${document.id}:${generation}`}
              document={document}
              issueProviders={issueProviders}
              client={client}
              onSaved={(saved) =>
                setPages((current) =>
                  current.map((page) => (page.id === saved.id ? saved : page)),
                )
              }
              onCreateChild={() => void create(document.id)}
              onCreateFolder={() => void create(document.id, "folder")}
              ancestors={ancestors}
              childrenPages={pages.filter(
                (page) => page.parentId === document.id,
              )}
              onReload={() => {
                setGeneration((n) => n + 1);
                void refresh();
              }}
              onDeleted={() => {
                navigate("/pages");
                void refresh();
              }}
              canLeave={canLeave}
            />
          ) : (
            !error && (
              <p className="p-8" role="status">
                {t("Loading")}
              </p>
            )
          )
        ) : (
          <div className="pages-home">
            <div className="pages-home-heading">
              <div>
                <h1>{t("Your pages")}</h1>
                <p>{t("Pages hint")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void create(undefined, "folder")}
                >
                  <FolderPlus size={16} />
                  {t("New folder")}
                </Button>
                <Button disabled={busy} onClick={() => void create()}>
                  <Plus size={16} />
                  {t("New page")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("Pages options")}
                      disabled={busy || archiveBusy}
                    >
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={archiveBusy}
                      onSelect={() => void exportAllPages()}
                    >
                      <Download size={16} />
                      {t("Export all my pages")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={archiveBusy}
                      onSelect={() => {
                        setArchiveError(null);
                        setArchiveNotice(null);
                        setArchiveDialogOpen(true);
                      }}
                    >
                      <Upload size={16} />
                      {t("Import pages")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {archiveNotice && (
              <p className="mb-3 text-sm text-muted-foreground" role="status">
                {archiveNotice}
              </p>
            )}
            {exportingArchive && (
              <p
                className="mb-3 text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {t("Exporting pages")}
              </p>
            )}
            {archiveError && !archiveDialogOpen && (
              <div
                className="mb-3 flex flex-wrap items-center gap-3 text-sm text-destructive"
                role="alert"
              >
                {archiveError}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void exportAllPages()}
                  disabled={archiveBusy}
                >
                  {t("Retry")}
                </Button>
              </div>
            )}
            <PagesCloudflareSearch client={client} />
            <div className="pages-search">
              <Search size={16} aria-hidden />
              <Input
                aria-label={t("Search pages")}
                placeholder={t("Search hint")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {loading || busy ? (
              <div className="pages-loading" role="status">
                {t("Loading")}
              </div>
            ) : (
              <PageListing
                pages={
                  query
                    ? pages
                    : pages.filter(
                        (page) => !page.parentId || !byId.has(page.parentId),
                      )
                }
                empty={query ? t("No results") : t("Empty")}
              />
            )}
            <Dialog
              open={archiveDialogOpen}
              onOpenChange={(open) => {
                if (archiveBusy) return;
                if (open) setArchiveDialogOpen(true);
                else closeArchiveDialog();
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("Import pages")}</DialogTitle>
                  <DialogDescription>
                    {t("Import pages description")}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="pages-archive-file"
                  >
                    {t("Choose archive")}
                  </label>
                  <Input
                    ref={archiveInput}
                    id="pages-archive-file"
                    type="file"
                    accept=".savia-pages.json,application/json,.json"
                    disabled={archiveBusy}
                    aria-describedby="pages-archive-hint"
                    onChange={(event) => {
                      setArchiveFile(event.currentTarget.files?.[0] ?? null);
                      setArchiveError(null);
                    }}
                  />
                  <p
                    id="pages-archive-hint"
                    className="text-sm text-muted-foreground"
                  >
                    {t("Import pages hint")}
                  </p>
                  {archiveFile && (
                    <p className="break-all text-sm text-muted-foreground">
                      {t("Selected archive")}: {archiveFile.name}
                    </p>
                  )}
                  {archiveError && (
                    <p role="alert" className="text-sm text-destructive">
                      {archiveError}
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    disabled={archiveBusy}
                    onClick={closeArchiveDialog}
                  >
                    {t("Cancel")}
                  </Button>
                  <Button
                    disabled={archiveBusy || !archiveFile}
                    onClick={() => void importPages()}
                  >
                    {archiveBusy ? t("Importing pages") : t("Import archive")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </section>
    </main>
  );
}
function DocumentPane({
  document,
  issueProviders,
  client,
  onSaved,
  onCreateChild,
  onCreateFolder,
  ancestors,
  childrenPages,
  onReload,
  onDeleted,
  canLeave,
}: {
  document: PageDocument;
  issueProviders: IssueProvider[];
  client: PagesClient;
  onSaved(page: PageDocument): void;
  onCreateChild(): void;
  onCreateFolder(): void;
  ancestors: PageSummary[];
  childrenPages: PageSummary[];
  onReload(): void;
  onDeleted(): void;
  canLeave: React.MutableRefObject<() => boolean>;
}) {
  const t = useMessages(pagesMessages),
    editable = document.role !== "reader";
  const [draft, setDraft] = useState({
      title: document.title,
      content: document.content,
    }),
    [version, setVersion] = useState(document.version);
  const [status, setStatus] = useState<"saved" | "saving" | "dirty" | "failed">(
      "saved",
    ),
    [panel, setPanel] = useState<"share" | "history" | "delete" | null>(null),
    [leaveWarning, setLeaveWarning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pendingUpload = useRef(false);
  const current = useRef(draft);
  current.current = draft;
  const snapshotCache = useRef<{
    draft: typeof draft;
    value: string;
  } | null>(null);
  if (snapshotCache.current === null)
    snapshotCache.current = { draft, value: JSON.stringify(draft) };
  const acknowledged = useRef(snapshotCache.current.value),
    latestSent = useRef(acknowledged.current),
    alive = useRef(true);
  const getSnapshot = useCallback((value: typeof draft) => {
    const cached = snapshotCache.current!;
    if (cached.draft !== value) {
      cached.draft = value;
      cached.value = JSON.stringify(value);
    }
    return cached.value;
  }, []);
  const hasUnsavedChanges = useCallback(
    () =>
      getSnapshot(current.current) !== acknowledged.current ||
      latestSent.current !== acknowledged.current,
    [getSnapshot],
  );
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;
  const queue = useRef(
    new PageSaveQueue(document.version, (next: typeof draft, expected) =>
      client.save(document.id, { ...next, version: expected }),
    ),
  );
  const submit = useCallback(() => {
    const next = current.current,
      snapshot = getSnapshot(next);
    if (!editable || !next.title.trim()) return;
    if (snapshot === latestSent.current) {
      if (snapshot === acknowledged.current)
        setStatus((currentStatus) =>
          currentStatus === "failed" ? currentStatus : "saved",
        );
      return;
    }
    latestSent.current = snapshot;
    if (alive.current) setStatus("saving");
    void queue.current
      .save(next)
      .then((saved) => {
        acknowledged.current = snapshot;
        if (alive.current) {
          setVersion(saved.version);
          const currentSnapshot = getSnapshot(current.current);
          setStatus(
            currentSnapshot === snapshot && latestSent.current === snapshot
              ? "saved"
              : "dirty",
          );
          savedCallback.current(saved);
          if (currentSnapshot !== latestSent.current) submit();
        }
      })
      .catch(() => {
        if (alive.current) setStatus("failed");
      });
  }, [editable, getSnapshot]);
  const blocker = useBlocker(
    () => pendingUpload.current || hasUnsavedChanges(),
  );
  useEffect(() => {
    if (blocker.state === "blocked") {
      setLeaveWarning(true);
      submit();
      blocker.reset();
    }
  }, [blocker, submit]);
  useEffect(() => {
    setStatus((currentStatus) =>
      currentStatus === "failed" ? currentStatus : "dirty",
    );
    const timer = setTimeout(submit, 600);
    return () => clearTimeout(timer);
  }, [draft, submit]);
  useEffect(() => {
    alive.current = true;
    const before = (event: BeforeUnloadEvent) => {
      if (pendingUpload.current || hasUnsavedChanges()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    canLeave.current = () => {
      if (!pendingUpload.current && !hasUnsavedChanges()) return true;
      setLeaveWarning(true);
      submit();
      return false;
    };
    const capture = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement)?.closest?.("a");
      if (
        anchor?.getAttribute("href")?.startsWith("#/") &&
        anchor.target !== "_blank" &&
        !canLeave.current()
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.document.addEventListener("click", capture, true);
    return () => {
      submit();
      alive.current = false;
      canLeave.current = () => true;
      window.removeEventListener("beforeunload", before);
      window.document.removeEventListener("click", capture, true);
    };
  }, [submit, canLeave, hasUnsavedChanges]);
  const onPendingUpload = useCallback((pending: boolean) => {
    pendingUpload.current = pending;
    setUploading(pending);
  }, []);
  const onEditorChange = useCallback(
    (content: Value) => {
      if (editable) setDraft((value) => ({ ...value, content }));
    },
    [editable],
  );
  const initialEditorValue = useRef(document.content).current;
  function download() {
    const blob = new Blob(
      [JSON.stringify({ title: draft.title, content: draft.content }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = "page-draft.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportMarkdown() {
    const blob = new Blob([exportPageMarkdown(draft.title, draft.content)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = `${draft.title.trim() || "page"}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <article className="page-document">
      <header className="page-document-header">
        <nav className="page-breadcrumbs" aria-label={t("Page path")}>
          <Link to="/pages">{t("Pages")}</Link>
          {ancestors.map((ancestor) => (
            <span key={ancestor.id}>
              <ChevronRight size={12} aria-hidden />
              <Link to={`/pages/${ancestor.id}`}>{ancestor.title}</Link>
            </span>
          ))}
          <span>
            <ChevronRight size={12} aria-hidden />
            <span aria-current="page">{draft.title}</span>
          </span>
        </nav>
        <div className="page-document-actions">
          <span className="page-save-status" role="status">
            {t(
              !editable
                ? "Read only"
                : uploading || status === "saving"
                  ? "Saving"
                  : status === "saved"
                    ? "Saved"
                    : "Unsaved",
            )}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="page-privacy-indicator"
                tabIndex={0}
                role="img"
                aria-label={t(
                  document.isShared ? "Team shared" : "Team private",
                )}
              >
                {document.isShared ? (
                  <Users size={14} aria-hidden />
                ) : (
                  <LockKeyhole size={14} aria-hidden />
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t(document.isShared ? "Team shared" : "Team private")}
            </TooltipContent>
          </Tooltip>
          {document.role === "owner" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={uploading || status !== "saved"}
              onClick={() => setPanel("share")}
            >
              <Users size={14} aria-hidden />
              {t("Share")}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("Page actions")}
                disabled={uploading || status !== "saved"}
              >
                <MoreHorizontal size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {editable && (
                <>
                  <DropdownMenuItem onSelect={onCreateChild}>
                    <FilePlus2 size={15} />
                    {t("Subpage")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onCreateFolder}>
                    <FolderPlus size={15} />
                    {t("New folder")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onSelect={() => setPanel("history")}>
                <History size={15} />
                {t("History")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={exportMarkdown}>
                <Download size={15} />
                {t("Export as Markdown")}
              </DropdownMenuItem>
              {document.role === "owner" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setPanel("delete")}
                  >
                    <Trash2 size={15} />
                    {t("Delete")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {panel === "history" && (
        <HistoryWorkspace
          client={client}
          document={{ ...document, version }}
          issueProviders={issueProviders}
          onClose={() => setPanel(null)}
          onRestored={() => {
            setPanel(null);
            onReload();
          }}
        />
      )}
      <div className="page-document-body" hidden={panel === "history"}>
        {(status === "failed" || leaveWarning) && (
          <div role="alert" className="my-4 border rounded-md p-4">
            <p>
              {t(
                uploading
                  ? "Upload pending"
                  : status === "failed"
                    ? "Save failed"
                    : "Unsaved leave",
              )}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={download}
              >
                {t("Download draft")}
              </Button>
              {status === "failed" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => {
                    if (window.confirm(t("Unsaved leave"))) onReload();
                  }}
                >
                  {t("Reload")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLeaveWarning(false)}
              >
                {t("Close")}
              </Button>
            </div>
          </div>
        )}
        <textarea
          rows={1}
          ref={(node) => {
            if (node) {
              node.style.height = "auto";
              node.style.height = `${node.scrollHeight}px`;
            }
          }}
          className="page-title"
          aria-label={t("Heading")}
          value={draft.title}
          maxLength={200}
          readOnly={!editable}
          onChange={(event) =>
            setDraft((value) => ({ ...value, title: event.target.value }))
          }
        />
        {document.binding && (
          <RecordProperties binding={document.binding} api={client.api} />
        )}
        {document.kind === "folder" ? (
          <section
            className="page-folder-content"
            aria-label={t("Inside folder")}
          >
            <div className="page-folder-heading">
              <p>{t("Folder hint")}</p>
              {editable && (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={uploading || status !== "saved"}
                    onClick={onCreateFolder}
                  >
                    <FolderPlus size={15} />
                    {t("New folder")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={uploading || status !== "saved"}
                    onClick={onCreateChild}
                  >
                    <Plus size={15} />
                    {t("New page")}
                  </Button>
                </div>
              )}
            </div>
            <PageListing pages={childrenPages} empty={t("Folder empty")} />
          </section>
        ) : (
          <>
            <PageEditor
              issueProviders={issueProviders}
              pageId={document.id}
              onPendingUpload={onPendingUpload}
              initialValue={initialEditorValue}
              readOnly={!editable}
              api={client.api}
              pages={client}
              onChange={onEditorChange}
            />

            {childrenPages.length > 0 && (
              <section
                className="page-subpages"
                aria-label={t("Inside folder")}
              >
                <PageListing pages={childrenPages} empty="" />
              </section>
            )}
          </>
        )}
      </div>
      <Dialog
        open={panel !== null && panel !== "history"}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(
                panel === "share"
                  ? "Share"
                  : panel === "delete"
                    ? "Delete"
                    : "History",
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                panel === "share"
                  ? "Inherited"
                  : panel === "delete"
                    ? "Delete hint"
                    : "Restore hint",
              )}
            </DialogDescription>
          </DialogHeader>
          {panel === "share" && (
            <SharePanel
              client={client}
              pageId={document.id}
              pageTitle={document.title}
              pageKind={document.kind === "folder" ? "folder" : "page"}
              onDone={() => {
                setPanel(null);
                onReload();
              }}
            />
          )}
          {panel === "delete" && (
            <DeletePanel
              client={client}
              pageId={document.id}
              version={version}
              onDone={onDeleted}
            />
          )}
        </DialogContent>
      </Dialog>
    </article>
  );
}
function PageListing({
  pages,
  empty,
}: {
  pages: PageSummary[];
  empty: string;
}) {
  const t = useMessages(pagesMessages);
  const sorted = [...pages].sort(
    (a, b) =>
      Number(b.kind === "folder") - Number(a.kind === "folder") ||
      a.title.localeCompare(b.title),
  );
  if (!sorted.length)
    return (
      <div className="pages-empty">
        <Folder size={28} strokeWidth={1.4} aria-hidden />
        <p>{empty}</p>
      </div>
    );
  return (
    <ul className="pages-list">
      {sorted.map((page) => (
        <li key={page.id}>
          <Link to={`/pages/${page.id}`}>
            {page.kind === "folder" ? (
              <Folder size={20} strokeWidth={1.5} aria-hidden />
            ) : (
              <FileText size={20} strokeWidth={1.5} aria-hidden />
            )}
            <span className="pages-list-title">{page.title}</span>
            <span className="pages-list-access">
              {t(page.isShared ? "Team shared" : "Team private")}
            </span>
            <ChevronRight size={14} aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DeletePanel({
  client,
  pageId,
  version,
  onDone,
}: {
  client: PagesClient;
  pageId: string;
  version: number;
  onDone(): void;
}) {
  const t = useMessages(pagesMessages),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  return (
    <div>
      {error && <p role="alert">{t("Unavailable")}</p>}
      <Button
        variant="destructive"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await client.remove(pageId, version);
            onDone();
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Delete")}
      </Button>
    </div>
  );
}
