import { useEffect, useRef, useState } from "react";
import { ArrowLeft, History, Trash2 } from "lucide-react";
import type { Value } from "platejs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useMessages } from "@/i18n/core";
import { pagesMessages } from "./messages";
import { PageEditor } from "./editor";
import { PagesClient, type PageDocument, type PageRevision } from "./client";
import type { IssueProvider } from "./use-issue-providers";

const ignoreChanges = () => {};

export function HistoryWorkspace({
  client,
  document,
  issueProviders,
  onClose,
  onRestored,
}: {
  client: PagesClient;
  document: PageDocument;
  issueProviders: IssueProvider[];
  onClose(): void;
  onRestored(): void;
}) {
  const t = useMessages(pagesMessages);
  const [revisions, setRevisions] = useState<PageRevision[]>([]);
  const [selected, setSelected] = useState(document.version);
  const [preview, setPreview] = useState<{
    title: string;
    content: Value;
  } | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [listError, setListError] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    let active = true;
    setLoadingList(true);
    setListError(false);
    void client
      .revisions(document.id)
      .then((value) => {
        if (active) setRevisions(value);
      })
      .catch(() => {
        if (active) setListError(true);
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });
    return () => {
      active = false;
    };
  }, [client, document.id, reload]);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setLoadingPreview(true);
    setPreviewError(false);
    void client
      .revision(document.id, selected)
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch(() => {
        if (active) setPreviewError(true);
      })
      .finally(() => {
        if (active) setLoadingPreview(false);
      });
    return () => {
      active = false;
    };
  }, [client, document.id, selected, reload]);
  const revision = revisions.find((item) => item.version === selected);
  async function restore() {
    if (busy || !preview || selected === document.version) return;
    setBusy(true);
    setActionError(false);
    try {
      await client.restore(document.id, selected, document.version);
      onRestored();
    } catch {
      setActionError(true);
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    setActionError(false);
    try {
      await client.clearHistory(document.id, document.version);
      setSelected(document.version);
      setPreview(null);
      setRevisions((items) =>
        items.filter((item) => item.version === document.version),
      );
      setConfirmClear(false);
      setReload((value) => value + 1);
    } catch {
      setActionError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page-history-workspace" aria-label={t("History")}>
      <div className="page-history-heading">
        <Button
          ref={closeRef}
          variant="ghost"
          onClick={onClose}
          disabled={busy}
        >
          <ArrowLeft size={16} aria-hidden />
          {t("Back to note")}
        </Button>
        <span>{t("History preview")}</span>
      </div>
      <div className="page-history-layout">
        <section
          className="page-history-preview"
          aria-label={t("View revision")}
          aria-busy={loadingPreview}
        >
          {loadingPreview && <p role="status">{t("Revision loading")}</p>}
          {previewError && (
            <div role="alert">
              <p>{t("Unavailable")}</p>
              <Button
                variant="outline"
                onClick={() => setReload((value) => value + 1)}
              >
                {t("History retry")}
              </Button>
            </div>
          )}
          {preview && !loadingPreview && (
            <>
              <div className="page-history-version-label">
                v{selected}
                {revision && (
                  <>
                    {" "}
                    ·{" "}
                    <time dateTime={revision.createdAt}>
                      {new Date(revision.createdAt).toLocaleString()}
                    </time>
                  </>
                )}
              </div>
              <h1 className="page-history-title">{preview.title}</h1>
              <PageEditor
                key={selected}
                pageId={document.id}
                initialValue={preview.content}
                readOnly
                api={client.api}
                pages={client}
                issueProviders={issueProviders}
                onChange={ignoreChanges}
              />
            </>
          )}
        </section>
        <aside className="page-history-drawer" aria-label={t("History")}>
          <header>
            <h2>
              <History size={18} aria-hidden />
              {t("History")}
            </h2>
            <p>{t("History help")}</p>
          </header>
          {loadingList && <p role="status">{t("History loading")}</p>}
          {listError && (
            <div role="alert">
              <p>{t("Unavailable")}</p>
              <Button
                variant="outline"
                onClick={() => setReload((value) => value + 1)}
              >
                {t("History retry")}
              </Button>
            </div>
          )}
          <ol className="page-history-versions">
            {revisions.map((item) => (
              <li key={item.version}>
                <button
                  type="button"
                  aria-pressed={item.version === selected}
                  disabled={busy}
                  onClick={() => setSelected(item.version)}
                >
                  <span>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                    <small>
                      v{item.version}
                      {item.version === document.version
                        ? ` · ${t("Current version")}`
                        : ""}
                    </small>
                  </span>
                  <span className="page-history-selected-dot" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
          {!loadingList && !listError && revisions.length <= 1 && (
            <p>{t("History empty")}</p>
          )}
          <footer>
            {actionError && !confirmClear && (
              <p role="alert">{t("Unavailable")}</p>
            )}
            {document.role !== "reader" && (
              <Button
                disabled={
                  busy ||
                  loadingPreview ||
                  !preview ||
                  selected === document.version
                }
                onClick={() => void restore()}
              >
                {t("Restore")}
              </Button>
            )}
            {document.role === "owner" && (
              <Button
                variant="ghost"
                disabled={busy || loadingList || revisions.length <= 1}
                onClick={() => {
                  setActionError(false);
                  setConfirmClear(true);
                }}
              >
                <Trash2 size={15} aria-hidden />
                {t("Clear history")}
              </Button>
            )}
          </footer>
        </aside>
      </div>
      <Dialog
        open={confirmClear}
        onOpenChange={(open) => {
          if (!busy) setConfirmClear(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Clear history")}</DialogTitle>
            <DialogDescription>{t("Clear history hint")}</DialogDescription>
          </DialogHeader>
          {actionError && <p role="alert">{t("Unavailable")}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmClear(false)}
            >
              {t("Close")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void clear()}
            >
              {t("Clear history")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
