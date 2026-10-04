import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Play,
  Send,
  Square,
  Undo2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAppLocale, useMessages } from "@/i18n/core";
import { useAppServices } from "@/features/assistant/assistant-context";
import { pluginApi } from "./api";
import { MonacoCodeEditor } from "./monaco-code-editor";
import { pluginIdeMessages } from "./plugin-ide-messages";
import { pluginIdeDeclarations } from "./plugin-ide-declarations";
import {
  compilePluginProject,
  createPluginProject,
  packagePluginProject,
  parsePluginProject,
  serializePluginProject,
  type IdeFiles,
} from "./plugin-ide-project";
import { createPluginPreviewDocument } from "./plugin-ide-preview";
import { pluginAuthoringResultSchema } from "@savia/studio-shared/plugin-authoring";
import "./plugin-ide.css";

import type { ProjectDraft } from "./plugin-project-session";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Proposal = { message: string; files: IdeFiles };
type Preview = {
  document: string;
  session: string;
  snapshot: string;
  entryJs: string;
  state: "loading" | "ready" | "error";
};

export default function PluginIde({
  tenantId,
  onClose,
  onPublished,
  initialFiles,
  initialHistory,
  onDraftChange,
  canPublishShared = false,
}: {
  tenantId: number;
  initialFiles?: IdeFiles;
  initialHistory?: ChatMessage[];
  onDraftChange?: (draft: ProjectDraft) => void;
  canPublishShared?: boolean;
  onClose: () => void;
  onPublished: () => void | Promise<unknown>;
}) {
  const t = useMessages(pluginIdeMessages);
  const locale = useAppLocale();
  const { apiClient } = useAppServices();
  const [files, setFiles] = useState<IdeFiles>(
    () => initialFiles ?? createPluginProject(),
  );
  const [destination, setDestination] = useState<"tenant" | "shared">("tenant");
  const draftCallback = useRef(onDraftChange);
  draftCallback.current = onDraftChange;
  const [selected, setSelected] = useState<keyof IdeFiles>("entry.tsx");
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>(initialHistory ?? []);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [undo, setUndo] = useState<IdeFiles | null>(null);
  const [busy, setBusy] = useState<
    "generate" | "compile" | "publish" | "import" | null
  >(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const currentPreview = useRef(preview);
  currentPreview.current = preview;
  const [published, setPublished] = useState<{
    id: string;
    version: string;
    snapshot: string;
    destination: "tenant" | "shared";
  } | null>(null);
  useEffect(() => {
    draftCallback.current?.({
      files,
      history: history
        .slice(-10)
        .map((item) => ({ ...item, content: item.content.slice(0, 4000) })),
    });
  }, [files, history]);
  const snapshot = JSON.stringify(files);
  const savedSnapshot = useRef(snapshot);
  const currentSnapshot = useRef(snapshot);
  currentSnapshot.current = snapshot;
  const frame = useRef<HTMLIFrameElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  const operation = useRef(0);
  const message = (reason: unknown) =>
    reason instanceof Error ? reason.message : t("failed");

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      operation.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (
        !draftCallback.current &&
        currentSnapshot.current !== savedSnapshot.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  useLayoutEffect(() => {
    if (!preview) return;
    const session = preview.session;
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== "savia-plugin-ide" ||
        event.data.session !== session
      )
        return;
      const { kind, message: detail } = event.data;
      if (kind === "ready")
        setPreview((value) =>
          value?.session === session && value.state === "loading"
            ? { ...value, state: "ready" }
            : value,
        );
      if (kind === "error") {
        if (currentPreview.current?.session === session)
          currentPreview.current = {
            ...currentPreview.current,
            state: "error",
          };
        setPreview((value) =>
          value?.session === session ? { ...value, state: "error" } : value,
        );
        if (typeof detail === "string") setError(detail.slice(0, 4000));
      }
      if ((kind === "log" || kind === "error") && typeof detail === "string")
        setLogs((value) => [...value.slice(-49), detail.slice(0, 2000)]);
    };
    window.addEventListener("message", receive);
    const timer = window.setTimeout(
      () =>
        setPreview((value) => {
          if (value?.session !== session || value.state !== "loading")
            return value;
          setError(t("timeout"));
          return { ...value, state: "error" };
        }),
      15000,
    );
    return () => {
      window.removeEventListener("message", receive);
      window.clearTimeout(timer);
    };
  }, [preview?.session, t]);

  function replaceFiles(next: IdeFiles) {
    currentPreview.current = null;
    setFiles(next);
    setPreview(null);
    setError("");
    setLogs([]);
    setProposal(null);
  }
  async function generate() {
    if (!prompt.trim() || busy) return;
    const requestId = ++operation.current;
    const abort = new AbortController();
    controller.current = abort;
    const requestPrompt = prompt.trim();
    setBusy("generate");
    setError("");
    setProposal(null);
    try {
      const result = await apiClient.post<Proposal>(
        "/api/assistant/plugin-authoring",
        {
          tenantId,
          prompt: requestPrompt,
          files,
          history: history
            .slice(-10)
            .map((item) => ({ ...item, content: item.content.slice(0, 4000) })),
          diagnostics: [error, ...logs].filter(Boolean).join("\n").slice(-8000),
        },
        { signal: abort.signal },
      );
      if (!active.current || operation.current !== requestId) return;
      if (currentSnapshot.current !== snapshot) throw new Error(t("stale"));
      // Treat the response as data, including when returned by a proxy.
      const proposedFiles = pluginAuthoringResultSchema.parse(result).files;
      setProposal({ message: result.message, files: proposedFiles });
      setHistory(
        (value) =>
          [
            ...value,
            { role: "user", content: requestPrompt },
            { role: "assistant", content: result.message },
          ].slice(-10) as ChatMessage[],
      );
      setPrompt("");
    } catch (reason) {
      if (
        active.current &&
        operation.current === requestId &&
        !abort.signal.aborted
      )
        setError(message(reason));
    } finally {
      if (active.current && operation.current === requestId) setBusy(null);
    }
  }
  async function runPreview() {
    if (busy) return;
    const revision = snapshot;
    setBusy("compile");
    setError("");
    setLogs([]);
    setPreview(null);
    try {
      const compiled = await compilePluginProject(files);
      if (!active.current || currentSnapshot.current !== revision) return;
      const session = crypto.randomUUID();
      setPreview({
        document: createPluginPreviewDocument(
          compiled.entryJs,
          compiled.fixtures,
          compiled.store,
          session,
          locale,
        ),
        session,
        snapshot: revision,
        entryJs: compiled.entryJs,
        state: "loading",
      });
    } catch (reason) {
      if (active.current) setError(message(reason));
    } finally {
      if (active.current) setBusy(null);
    }
  }
  async function publish() {
    if (busy || preview?.state !== "ready" || preview.snapshot !== snapshot)
      return;
    const revision = snapshot;
    setBusy("publish");
    setError("");
    try {
      const artifact = await packagePluginProject(files);
      if (!active.current) return;
      if (
        currentSnapshot.current !== revision ||
        artifact.entryJs !== preview.entryJs ||
        currentPreview.current?.session !== preview.session ||
        currentPreview.current?.state !== "ready"
      )
        throw new Error(t("stale"));
      const form = new FormData();
      form.set(
        "file",
        new File(
          [artifact.blob],
          `${artifact.manifest.id}-${artifact.manifest.version}.zip`,
          { type: "application/zip" },
        ),
      );
      const response = await pluginApi<{
        data: { id: string; version: string };
      }>(
        destination === "shared"
          ? "/plugin-store/registry/publish"
          : "/plugin-store/upload",
        "POST",
        form,
      );
      if (!active.current) return;
      setPublished({ ...response.data, snapshot: revision, destination });
      // Keep the publication receipt even when refreshing the catalog fails.
      await onPublished();
    } catch (reason) {
      if (active.current) setError(message(reason));
    } finally {
      if (active.current) setBusy(null);
    }
  }
  function exportProject() {
    try {
      const url = URL.createObjectURL(
        new Blob([serializePluginProject(files)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "savia-plugin-project.json";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      savedSnapshot.current = snapshot;
    } catch (reason) {
      setError(message(reason));
    }
  }
  async function importProject(file?: File) {
    if (!file || busy) return;
    setBusy("import");
    try {
      if (file.size > 512 * 1024) throw new Error(t("tooLarge"));
      const next = parsePluginProject(await file.text());
      if (!active.current || !window.confirm(t("importConfirm"))) return;
      replaceFiles(next);
      setHistory([]);
      setUndo(null);
      setPublished(null);
      savedSnapshot.current = JSON.stringify(next);
    } catch (reason) {
      setError(message(reason));
    } finally {
      if (active.current) setBusy(null);
      if (importInput.current) importInput.current.value = "";
    }
  }
  const canPublish =
    !busy &&
    preview?.state === "ready" &&
    preview.snapshot === snapshot &&
    (published?.snapshot !== snapshot || published.destination !== destination);
  return (
    <section className="plugin-ide" aria-label={t("title")}>
      <header className="plugin-ide-header">
        <div>
          <Button
            variant="ghost"
            size="sm"
            disabled={!!busy}
            onClick={() => {
              if (
                !!onDraftChange ||
                snapshot === savedSnapshot.current ||
                window.confirm(t("discardConfirm"))
              )
                onClose();
            }}
          >
            <ArrowLeft aria-hidden="true" />
            {t("back")}
          </Button>
          <h2 className="mt-3 text-xl font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy}
            onClick={exportProject}
          >
            <Download aria-hidden="true" />
            {t("export")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy}
            onClick={() => importInput.current?.click()}
          >
            <Upload aria-hidden="true" />
            {t("import")}
          </Button>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label={t("import")}
            onChange={(event) => void importProject(event.target.files?.[0])}
          />
          {canPublishShared && (
            <select
              aria-label={t("destination")}
              value={destination}
              onChange={(event) =>
                setDestination(event.target.value as "tenant" | "shared")
              }
              disabled={!!busy}
              className="rounded border bg-background p-2 text-sm"
            >
              <option value="tenant">{t("tenantStore")}</option>
              <option value="shared">{t("sharedStore")}</option>
            </select>
          )}
          <Button
            size="sm"
            disabled={!canPublish}
            onClick={() => void publish()}
          >
            <Upload aria-hidden="true" />
            {t(busy === "publish" ? "publishing" : "publish")}
          </Button>
        </div>
      </header>
      {error && (
        <p className="plugin-ide-notice text-destructive" role="alert">
          {error}
        </p>
      )}
      {published && (
        <div className="plugin-ide-notice" role="status">
          <strong>
            {t(
              published.destination === "shared"
                ? "sharedPublished"
                : "published",
            )}
            : {published.id} · {published.version}
          </strong>
          <p>
            {published.destination === "tenant" && t("installHint")}{" "}
            {t("versionHint")}
          </p>
        </div>
      )}
      <div className="plugin-ide-panes">
        <aside className="plugin-ide-chat" aria-label={t("chat")}>
          <h3 className="font-semibold">{t("chat")}</h3>
          <p className="text-sm text-muted-foreground">{t("aiHint")}</p>
          <div className="plugin-ide-conversation" aria-live="polite">
            {history.map((item, index) => (
              <p
                key={index}
                className={
                  item.role === "user"
                    ? "plugin-ide-user-message"
                    : "whitespace-pre-wrap text-sm"
                }
              >
                {item.content}
              </p>
            ))}
            {busy === "generate" && <p role="status">{t("generating")}</p>}
          </div>
          {proposal && (
            <section className="plugin-ide-proposal" aria-label={t("proposed")}>
              <h4 className="font-medium">{t("proposed")}</h4>
              {(Object.keys(files) as (keyof IdeFiles)[])
                .filter((name) => files[name] !== proposal.files[name])
                .map((name) => (
                  <details key={name}>
                    <summary>{name}</summary>
                    <pre>{proposal.files[name]}</pre>
                  </details>
                ))}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setUndo(files);
                    replaceFiles(proposal.files);
                  }}
                >
                  {t("apply")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setProposal(null)}
                >
                  {t("discard")}
                </Button>
              </div>
            </section>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
            className="mt-auto space-y-2"
          >
            <label htmlFor="plugin-ide-prompt" className="text-sm font-medium">
              {t("prompt")}
            </label>
            <Textarea
              id="plugin-ide-prompt"
              value={prompt}
              maxLength={8000}
              rows={4}
              disabled={!!busy}
              placeholder={t("placeholder")}
              onChange={(event) => setPrompt(event.target.value)}
            />
            {busy === "generate" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  operation.current++;
                  controller.current?.abort();
                  setBusy(null);
                }}
              >
                {t("cancel")}
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                disabled={!!busy || !prompt.trim()}
              >
                <Send aria-hidden="true" />
                {t("send")}
              </Button>
            )}
          </form>
        </aside>
        <section className="plugin-ide-code" aria-label={t("files")}>
          <div
            className="plugin-ide-file-tabs"
            role="group"
            aria-label={t("files")}
          >
            {(Object.keys(files) as (keyof IdeFiles)[]).map((name) => (
              <button
                type="button"
                key={name}
                aria-pressed={selected === name}
                onClick={() => setSelected(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <MonacoCodeEditor
            key={selected}
            value={files[selected]}
            onChange={(value) => {
              setUndo(null);
              replaceFiles({ ...files, [selected]: value });
            }}
            language={selected === "entry.tsx" ? "typescript" : "json"}
            ariaLabel={selected}
            readOnly={!!busy}
            contextDeclarations={pluginIdeDeclarations}
            height={520}
          />
          <footer className="flex flex-wrap items-center gap-2 border-t p-3">
            <p className="flex-1 text-xs text-muted-foreground">
              {t(onDraftChange ? "autosaveHint" : "draft")}
            </p>
            {undo && (
              <Button
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() => {
                  replaceFiles(undo);
                  setUndo(null);
                }}
              >
                <Undo2 aria-hidden="true" />
                {t("undo")}
              </Button>
            )}
          </footer>
        </section>
        <section className="plugin-ide-preview" aria-label={t("preview")}>
          <header className="flex flex-wrap items-center gap-2 border-b p-3">
            <h3 className="mr-auto font-semibold">{t("preview")}</h3>
            {preview && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  currentPreview.current = null;
                  setPreview(null);
                }}
                aria-label={t("stop")}
              >
                <Square aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!!busy}
              onClick={() => void runPreview()}
            >
              <Play aria-hidden="true" />
              {t("run")}
            </Button>
          </header>
          <p className="border-b px-3 py-2 text-xs text-muted-foreground">
            {t("fixtures")}
          </p>
          {preview ? (
            <iframe
              ref={frame}
              key={preview.session}
              title={t("frame")}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={preview.document}
              className="plugin-ide-frame"
            />
          ) : (
            <p className="plugin-ide-preview-empty" role="status">
              {t(busy === "compile" ? "compiling" : "empty")}
            </p>
          )}
          {preview?.state === "ready" && (
            <p
              role="status"
              className="px-3 py-2 text-xs text-muted-foreground"
            >
              {t("ready")}
            </p>
          )}
          <details className="plugin-ide-console" open={logs.length > 0}>
            <summary>
              {t("console")} ({logs.length})
            </summary>
            <pre>{logs.join("\n")}</pre>
          </details>
        </section>
      </div>
    </section>
  );
}
