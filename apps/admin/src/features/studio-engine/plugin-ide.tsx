import { PLUGIN_PROJECT_MAX_BYTES } from "@savia/studio-shared/plugin-projects";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useId,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Files,
  Check,
  Bot,
  ArrowUp,
  LoaderCircle,
  X,
  FileCode2,
  Download,
  MoreHorizontal,
  MessageSquare,
  Code2,
  Eye,
  Play,
  Square,
  Undo2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { AssistantMarkdown } from "@/features/assistant/assistant-response-ui";
import { PluginFileTree } from "./plugin-file-tree";
import { PluginDiffEditor } from "./plugin-diff-editor";
import { Textarea } from "@/components/ui/textarea";
import { useAppLocale, useMessages } from "@/i18n/core";
import { useAppServices } from "@/features/assistant/assistant-context";
import { pluginApi } from "./api";
import { ApiClientError } from "@/api/api-client";
import {
  readAuthoringStream,
  requestPluginAuthoring,
  type AuthoringStreamEvent,
} from "./plugin-authoring-request";
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
import { readPluginIdeTheme, observePluginIdeTheme } from "./plugin-ide-theme";
import { createPluginPreviewDocument } from "./plugin-ide-preview";
import { pluginAuthoringResultSchema } from "@savia/studio-shared/plugin-authoring";
import "./plugin-ide.css";

import type { ProjectDraft } from "./plugin-project-session";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  usage?: { input: number; output: number };
};
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
  saveStatus,
  backLabel,
}: {
  tenantId: number;
  saveStatus?: ReactNode;
  backLabel?: string;
  initialFiles?: IdeFiles;
  initialHistory?: ChatMessage[];
  onDraftChange?: (draft: ProjectDraft) => void;
  canPublishShared?: boolean;
  onClose: () => void;
  onPublished: () => void | Promise<unknown>;
}) {
  const t = useMessages(pluginIdeMessages);
  const panelId = useId();
  const [wide, setWide] = useState(false);
  const [pane, setPane] = useState<"files" | "chat" | "code" | "preview">(
    "code",
  );
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [reviewFile, setReviewFile] = useState<keyof IdeFiles | null>(null);
  const [openFiles, setOpenFiles] = useState<(keyof IdeFiles)[]>(["entry.tsx"]);
  const [visitedFiles, setVisitedFiles] = useState<(keyof IdeFiles)[]>([
    "entry.tsx",
  ]);
  const [chatError, setChatError] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const conversation = useRef<HTMLDivElement>(null);
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
    "compile" | "publish" | "activate" | "import" | null
  >(null);
  const [generating, setGenerating] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [liveUsage, setLiveUsage] = useState<{
    input: number;
    output: number;
  } | null>(null);
  const [estimatedInput, setEstimatedInput] = useState(0);

  function formatTokens(value: number): string {
    const amount = Math.max(0, Math.round(value));
    if (amount < 1000) return String(amount);
    if (amount < 10000)
      return `${(amount / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    return `${Math.round(amount / 1000)}k`;
  }
  const [queue, setQueue] = useState<string[]>([]);
  const queueRef = useRef<string[]>([]);
  const [generationSeconds, setGenerationSeconds] = useState(0);
  const locked = generating || !!busy;
  useEffect(() => {
    if (!generating) return;
    const started = Date.now();
    setGenerationSeconds(0);
    const timer = window.setInterval(
      () => setGenerationSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [generating]);
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
    activated: boolean;
  } | null>(null);
  useEffect(() => {
    draftCallback.current?.({
      files,
      history: history.slice(-10).map((item) => ({
        role: item.role,
        content: item.content.slice(0, 4000),
      })),
    });
  }, [files, history]);
  const snapshot = JSON.stringify(files);
  const savedSnapshot = useRef(snapshot);
  const currentSnapshot = useRef(snapshot);
  currentSnapshot.current = snapshot;
  const surface = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!surface.current) return;
    const update = () =>
      setWide(surface.current!.getBoundingClientRect().width >= 850);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = conversation.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [history, generating, proposal, chatError, streamingMessage, queue]);
  function openFile(name: keyof IdeFiles) {
    setSelected(name);
    setOpenFiles((current) =>
      current.includes(name) ? current : [...current, name],
    );
    setVisitedFiles((current) =>
      current.includes(name) ? current : [...current, name],
    );
    setReviewFile(null);
    setPane("code");
  }

  useEffect(() => {
    if (!surface.current || !preview) return;
    return observePluginIdeTheme(surface.current, (theme) => {
      frame.current?.contentWindow?.postMessage(
        { type: "savia-plugin-ide-theme", session: preview.session, theme },
        "*",
      );
    });
  }, [preview?.session]);
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
    setReviewFile(null);
  }
  function enqueuePrompt(requestPrompt: string): boolean {
    if (
      queueRef.current.length >= 5 ||
      queueRef.current.includes(requestPrompt)
    )
      return false;
    queueRef.current = [...queueRef.current, requestPrompt];
    setQueue(queueRef.current);
    return true;
  }
  function shiftQueue(): string | undefined {
    const next = queueRef.current[0];
    if (next === undefined) return undefined;
    queueRef.current = queueRef.current.slice(1);
    setQueue(queueRef.current);
    return next;
  }
  function removeQueued(index: number) {
    queueRef.current = queueRef.current.filter((_, item) => item !== index);
    setQueue(queueRef.current);
  }
  async function generate(input = prompt) {
    const requestPrompt = input.trim();
    if (!requestPrompt || busy) return;
    if (generating) {
      if (enqueuePrompt(requestPrompt) && input === prompt) setPrompt("");
      return;
    }
    if (input === prompt) setPrompt("");
    await runGeneration(requestPrompt);
  }
  async function runGeneration(
    requestPrompt: string,
    context?: { history: ChatMessage[]; files: IdeFiles },
  ) {
    const requestId = ++operation.current;
    const abort = new AbortController();
    controller.current = abort;
    const priorHistory =
      context?.history ??
      (history.at(-1)?.role === "user" &&
      history.at(-1)?.content === requestPrompt
        ? history.slice(0, -1)
        : history);
    const baseFiles = context?.files ?? proposal?.files ?? files;
    setLastPrompt(requestPrompt);
    setChatError("");
    setHistory(
      [...priorHistory, { role: "user", content: requestPrompt }].slice(
        -10,
      ) as ChatMessage[],
    );
    setReviewFile(null);
    setGenerating(true);
    setStreamingMessage("");
    setLiveUsage(null);
    setEstimatedInput(
      Math.ceil((requestPrompt.length + JSON.stringify(baseFiles).length) / 4),
    );
    setError("");
    let streamedText = "";
    let usage: { input: number; output: number } | null = null;
    let succeeded = false;
    let successfulContext: { history: ChatMessage[]; files: IdeFiles } | null =
      null;
    try {
      const result = await requestPluginAuthoring(async (signal) => {
        const response = await apiClient.requestResponse(
          "/api/assistant/plugin-authoring/stream",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenantId,
              prompt: requestPrompt,
              files: baseFiles,
              history: priorHistory.slice(-10).map((item) => ({
                role: item.role,
                content: item.content.slice(0, 4000),
              })),
              diagnostics: [error, ...logs]
                .filter(Boolean)
                .join("\n")
                .slice(-8000),
            }),
            signal,
          },
        );
        if (!response.ok) {
          const envelope = (await response.json().catch(() => null)) as {
            error?: { code?: string; message?: string };
          } | null;
          throw new ApiClientError(
            response.status,
            envelope?.error?.code ?? `HTTP_${response.status}`,
            envelope?.error?.message ?? response.statusText ?? "Request failed",
            envelope,
          );
        }
        // Boxed so closure assignments stay visible to the type checker.
        const outcome: {
          current: {
            message: string;
            files: Record<string, string>;
          } | null;
        } = { current: null };
        await readAuthoringStream(
          response,
          signal,
          (event: AuthoringStreamEvent) => {
            if (operation.current !== requestId || !active.current) return;
            if (event.type === "message") {
              streamedText += event.delta;
              setStreamingMessage(streamedText);
            } else if (event.type === "usage") {
              usage = { input: event.input, output: event.output };
              setLiveUsage(usage);
            } else if (event.type === "result") {
              outcome.current = {
                message: event.message,
                files: event.files,
              };
            } else if (event.type === "error") {
              throw new ApiClientError(
                event.code === "PLUGIN_AUTHORING_TIMEOUT" ? 504 : 502,
                event.code ?? "PLUGIN_AUTHORING_UNAVAILABLE",
                event.message,
                event.details
                  ? { error: { details: event.details } }
                  : undefined,
              );
            }
          },
        );
        if (!outcome.current) throw new Error(t("failed"));
        return outcome.current;
      }, abort);
      if (!active.current || operation.current !== requestId) return;
      if (currentSnapshot.current !== snapshot) throw new Error(t("stale"));
      // Treat the response as data, including when returned by a proxy.
      const proposedFiles = pluginAuthoringResultSchema.parse(result).files;
      setProposal({ message: result.message, files: proposedFiles });
      const nextHistory = [
        ...priorHistory,
        { role: "user" as const, content: requestPrompt },
        {
          role: "assistant" as const,
          content: result.message,
          ...(usage ? { usage } : {}),
        },
      ].slice(-10) as ChatMessage[];
      setHistory(nextHistory);
      successfulContext = { history: nextHistory, files: proposedFiles };
      setStreamingMessage("");
      setLiveUsage(null);
      succeeded = true;
    } catch (reason) {
      if (
        active.current &&
        operation.current === requestId &&
        (!abort.signal.aborted || (reason as Error)?.name === "TimeoutError")
      ) {
        setChatError(
          (reason as Error)?.name === "TimeoutError"
            ? t("generationTimeout")
            : authoringError(reason),
        );
        setStreamingMessage("");
        setLiveUsage(null);
      }
    } finally {
      if (active.current && operation.current === requestId) {
        // Drain one queued follow-up per successful generation, keeping the
        // pending indicator across the chain instead of flashing it.
        const next = succeeded ? shiftQueue() : undefined;
        if (!next) setGenerating(false);
        if (next) void runGeneration(next, successfulContext ?? undefined);
      }
    }
  }
  function authoringError(reason: unknown): string {
    if (!(reason instanceof ApiClientError)) return message(reason);
    const keys = {
      PLUGIN_AUTHORING_TIMEOUT: "generationTimeout",
      PLUGIN_AUTHORING_INVALID_OUTPUT: "generationInvalid",
      PLUGIN_AUTHORING_PROVIDER_AUTH_FAILED: "generationAuth",
      PLUGIN_AUTHORING_RATE_LIMITED: "generationQuota",
      PLUGIN_AUTHORING_PROVIDER_REQUEST_REJECTED: "generationRejected",
      PLUGIN_AUTHORING_NOT_CONFIGURED: "generationNotConfigured",
      PLUGIN_AUTHORING_METADATA_UNAVAILABLE: "generationMetadataUnavailable",
      PLUGIN_AUTHORING_UNAVAILABLE: "generationUnavailable",
    } as const;
    const key = keys[reason.code as keyof typeof keys];
    const summary = key ? t(key) : message(reason);
    const envelope = reason.details as
      { error?: { details?: unknown } } | undefined;
    const issues = envelope?.error?.details;
    if (!Array.isArray(issues)) return summary;
    const details = issues.slice(0, 12).flatMap((issue) => {
      if (
        !issue ||
        typeof issue !== "object" ||
        ![
          "entry.tsx",
          "savia-extension.json",
          "store.json",
          "preview.json",
        ].includes(issue.file) ||
        typeof issue.path !== "string" ||
        typeof issue.message !== "string"
      )
        return [];
      return [
        `${issue.file}${issue.path ? ` (${issue.path.slice(0, 160)})` : ""}: ${issue.message.slice(0, 240)}`,
      ];
    });
    return [summary, ...details].join("\n");
  }
  async function runPreview() {
    setPane("preview");
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
          readPluginIdeTheme(surface.current ?? document.documentElement),
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
  async function installPublished(release: { id: string; version: string }) {
    await pluginApi(
      `/extensions/${encodeURIComponent(release.id)}/install`,
      "POST",
      { version: release.version },
    );
    if (!active.current) return;
    setPublished((current) =>
      current?.id === release.id && current.version === release.version
        ? { ...current, activated: true }
        : current,
    );
  }
  async function activatePublished() {
    if (
      locked ||
      !published ||
      published.destination !== "tenant" ||
      published.activated
    )
      return;
    setBusy("activate");
    setError("");
    try {
      await installPublished(published);
      if (active.current) await onPublished();
    } catch (reason) {
      if (active.current) setError(message(reason));
    } finally {
      if (active.current) setBusy(null);
    }
  }
  async function publish(activate = destination === "tenant") {
    if (locked || preview?.state !== "ready" || preview.snapshot !== snapshot)
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
      setPublished({
        ...response.data,
        snapshot: revision,
        destination,
        activated: false,
      });
      if (activate && destination === "tenant") {
        try {
          await installPublished(response.data);
        } catch (reason) {
          if (active.current) setError(message(reason));
        }
      }
      if (!active.current) return;
      // Keep the publication receipt even when activation or catalog refresh fails.
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
    if (!file || locked) return;
    setBusy("import");
    try {
      if (file.size > PLUGIN_PROJECT_MAX_BYTES) throw new Error(t("tooLarge"));
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
  let projectName = "my-plugin";
  try {
    const manifest = JSON.parse(files["savia-extension.json"]);
    const label = manifest.label ?? manifest.id;
    if (typeof label === "string" && label.trim()) projectName = label;
  } catch {
    /* Keep the workspace usable while JSON is edited. */
  }
  const changedFiles = proposal
    ? (Object.keys(files) as (keyof IdeFiles)[]).filter(
        (name) => files[name] !== proposal.files[name],
      )
    : [];
  const canPublish =
    !locked &&
    preview?.state === "ready" &&
    preview.snapshot === snapshot &&
    (published?.snapshot !== snapshot || published.destination !== destination);
  return (
    <section ref={surface} className="plugin-ide" aria-label={t("title")}>
      <header className="plugin-ide-header">
        <div className="plugin-ide-heading">
          <Button
            variant="ghost"
            size="icon"
            aria-label={backLabel ?? t("back")}
            disabled={locked}
            onClick={() => {
              if (
                onDraftChange ||
                snapshot === savedSnapshot.current ||
                window.confirm(t("discardConfirm"))
              )
                onClose();
            }}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <h2>
            <span className="plugin-ide-title-full">{t("title")}</span>
            <span className="plugin-ide-title-short">{t("shortTitle")}</span>
          </h2>
          <span className="plugin-ide-project-name">{projectName}</span>
        </div>
        <div className="plugin-ide-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy}
            aria-label={t("run")}
            onClick={() => void runPreview()}
          >
            <Play aria-hidden="true" />
            {t("tryPreview")}
          </Button>
          <Button
            size="sm"
            disabled={!canPublish}
            aria-label={t(
              busy === "publish"
                ? "publishing"
                : destination === "tenant"
                  ? "publishAndActivate"
                  : "publish",
            )}
            title={!canPublish ? t("previewBeforePublish") : undefined}
            onClick={() => void publish()}
          >
            <Upload aria-hidden="true" />
            {t(
              busy === "publish"
                ? "publishing"
                : destination === "tenant"
                  ? "publishAndActivateShort"
                  : "publishShort",
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("projectOptions")}
                disabled={locked}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {destination === "tenant" && (
                <DropdownMenuItem
                  disabled={!canPublish}
                  onSelect={() => void publish(false)}
                >
                  <Upload aria-hidden="true" />
                  {t("publishOnly")}
                </DropdownMenuItem>
              )}
              {preview && (
                <DropdownMenuItem
                  onSelect={() => {
                    currentPreview.current = null;
                    setPreview(null);
                  }}
                >
                  <Square aria-hidden="true" />
                  {t("stop")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={exportProject}>
                <Download aria-hidden="true" />
                {t("export")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => importInput.current?.click()}>
                <Upload aria-hidden="true" />
                {t("import")}
              </DropdownMenuItem>
              {canPublishShared && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    aria-label={t("destination")}
                    value={destination}
                    onValueChange={(value) =>
                      setDestination(value as "tenant" | "shared")
                    }
                  >
                    <DropdownMenuRadioItem value="tenant">
                      {t("tenantStore")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="shared">
                      {t("sharedStore")}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label={t("import")}
            onChange={(event) => void importProject(event.target.files?.[0])}
          />
        </div>
      </header>
      <nav className="plugin-ide-navigation" aria-label={t("workspaceViews")}>
        <button
          type="button"
          aria-pressed={wide ? explorerOpen : pane === "files"}
          onClick={() =>
            wide ? setExplorerOpen(!explorerOpen) : setPane("files")
          }
        >
          <Files />
          {t("files")}
        </button>
        <button
          type="button"
          aria-pressed={pane === "code"}
          onClick={() => {
            setPane("code");
            setReviewFile(null);
          }}
        >
          <Code2 />
          {t("codeTab")}
        </button>
        <button
          type="button"
          aria-pressed={pane === "preview"}
          onClick={() => setPane("preview")}
        >
          <Eye />
          {t("preview")}
        </button>
        <button
          type="button"
          className="plugin-ide-chat-toggle"
          aria-pressed={wide ? chatOpen : pane === "chat"}
          onClick={() => (wide ? setChatOpen(!chatOpen) : setPane("chat"))}
        >
          <MessageSquare />
          {t("chatTab")}
        </button>
      </nav>
      {error && (
        <p className="plugin-ide-notice plugin-ide-error" role="alert">
          {error}
        </p>
      )}
      {published && (
        <div className="plugin-ide-notice" role="status">
          <Check />
          <span>
            {t(
              published.destination === "shared"
                ? "sharedPublished"
                : published.activated
                  ? "publishedActive"
                  : "published",
            )}
            : {published.id} · {published.version}. {t("versionHint")}
          </span>
          {published.destination === "tenant" && !published.activated && (
            <Button
              size="sm"
              variant="outline"
              disabled={locked}
              onClick={() => void activatePublished()}
            >
              {t(busy === "activate" ? "activating" : "activateVersion")}
            </Button>
          )}
        </div>
      )}
      <div className="plugin-ide-workbench">
        <Allotment defaultSizes={[190, 640, 320]}>
          <Allotment.Pane
            preferredSize={190}
            minSize={wide ? 150 : 0}
            maxSize={wide ? 300 : Infinity}
            visible={wide ? explorerOpen : pane === "files"}
          >
            <aside className="plugin-ide-explorer" aria-label={t("files")}>
              <h3 className="plugin-ide-panel-title">{t("explorer")}</h3>
              <PluginFileTree
                names={Object.keys(files) as (keyof IdeFiles)[]}
                selected={selected}
                projectName={projectName}
                label={t("files")}
                onSelect={openFile}
              />
              <p className="plugin-ide-explorer-hint">
                {t("projectFilesHint")}
              </p>
            </aside>
          </Allotment.Pane>
          <Allotment.Pane
            minSize={wide ? 280 : 0}
            visible={wide || pane === "code" || pane === "preview"}
          >
            <div className="plugin-ide-editor-area">
              <div
                className="plugin-ide-editor-tabs"
                role="tablist"
                aria-label={t("openFiles")}
                onKeyDown={(event) => {
                  if (
                    (event.target as HTMLElement).getAttribute("role") !== "tab"
                  )
                    return;
                  const tabs = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]',
                    ),
                  );
                  const index = tabs.indexOf(event.target as HTMLButtonElement);
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : -1;
                  if (next >= 0) {
                    event.preventDefault();
                    tabs[next].focus();
                    tabs[next].click();
                  }
                }}
              >
                {openFiles.map((name) => (
                  <div
                    role="presentation"
                    className="plugin-ide-editor-tab"
                    data-active={
                      pane !== "preview" && selected === name && !reviewFile
                    }
                    key={name}
                  >
                    <button
                      role="tab"
                      id={`${panelId}-${name}`}
                      aria-controls={`${panelId}-code`}
                      tabIndex={
                        pane !== "preview" && selected === name && !reviewFile
                          ? 0
                          : -1
                      }
                      aria-selected={
                        pane !== "preview" && selected === name && !reviewFile
                      }
                      onClick={() => openFile(name)}
                    >
                      <FileCode2 />
                      {name}
                    </button>
                    {openFiles.length > 1 && (
                      <button
                        className="plugin-ide-close-tab"
                        aria-label={`${t("closeFile")} ${name}`}
                        onClick={() => {
                          const next = openFiles.filter(
                            (file) => file !== name,
                          );
                          setOpenFiles(next);
                          if (selected === name) openFile(next[0]);
                        }}
                      >
                        <X />
                      </button>
                    )}
                  </div>
                ))}
                {reviewFile && proposal && (
                  <button
                    role="tab"
                    className="plugin-ide-special-tab"
                    id={`${panelId}-review`}
                    aria-controls={`${panelId}-code`}
                    tabIndex={pane !== "preview" ? 0 : -1}
                    aria-selected={pane !== "preview"}
                    onClick={() => setPane("code")}
                  >
                    {t("review")} · {reviewFile}
                  </button>
                )}
                <button
                  role="tab"
                  className="plugin-ide-special-tab"
                  id={`${panelId}-preview-tab`}
                  aria-controls={`${panelId}-preview`}
                  tabIndex={pane === "preview" ? 0 : -1}
                  aria-selected={pane === "preview"}
                  onClick={() => setPane("preview")}
                >
                  <Eye />
                  {t("preview")}
                </button>
              </div>
              <section
                id={`${panelId}-code`}
                role="tabpanel"
                aria-labelledby={`${panelId}-${reviewFile ? "review" : selected}`}
                className="plugin-ide-code"
                hidden={pane === "preview"}
                aria-label={t("codeTab")}
              >
                <div className="plugin-ide-breadcrumb">
                  <span>{projectName}</span>
                  <span>/</span>
                  <span>{reviewFile ?? selected}</span>
                  {reviewFile && <span>{t("proposed")}</span>}
                </div>
                <div className="plugin-ide-editors">
                  {visitedFiles.map((name) => (
                    <div
                      className="plugin-ide-editor-document"
                      key={name}
                      hidden={selected !== name || !!reviewFile}
                    >
                      <MonacoCodeEditor
                        value={files[name]}
                        onChange={(value) => {
                          setUndo(null);
                          replaceFiles({ ...files, [name]: value });
                        }}
                        language={name === "entry.tsx" ? "typescript" : "json"}
                        ariaLabel={name}
                        inlineCompletion={
                          name === "entry.tsx"
                            ? {
                                filename: "entry.tsx",
                                fetchCompletion: async (prefix, suffix) => {
                                  try {
                                    const result = await apiClient.post<{
                                      completion: string;
                                    }>("/api/assistant/plugin-completion", {
                                      tenantId,
                                      filename: "entry.tsx",
                                      prefix,
                                      suffix,
                                    });
                                    return result.completion?.trim()
                                      ? result.completion
                                      : null;
                                  } catch {
                                    // Inline completions are best-effort.
                                    return null;
                                  }
                                },
                              }
                            : undefined
                        }
                        readOnly={locked}
                        contextDeclarations={pluginIdeDeclarations}
                        height={520}
                      />
                    </div>
                  ))}
                  {reviewFile && proposal && (
                    <PluginDiffEditor
                      key={reviewFile}
                      original={files[reviewFile]}
                      modified={proposal.files[reviewFile]}
                      filename={reviewFile}
                      originalLabel={t("currentCode")}
                      modifiedLabel={t("proposedCode")}
                    />
                  )}
                </div>
              </section>
              <section
                id={`${panelId}-preview`}
                role="tabpanel"
                aria-labelledby={`${panelId}-preview-tab`}
                className="plugin-ide-preview"
                hidden={pane !== "preview"}
                aria-label={t("preview")}
              >
                {preview ? (
                  <iframe
                    ref={frame}
                    key={preview.session}
                    title={t("frame")}
                    sandbox="allow-scripts"
                    referrerPolicy="no-referrer"
                    onLoad={() =>
                      frame.current?.contentWindow?.postMessage(
                        {
                          type: "savia-plugin-ide-theme",
                          session: preview.session,
                          theme: readPluginIdeTheme(
                            surface.current ?? document.documentElement,
                          ),
                        },
                        "*",
                      )
                    }
                    srcDoc={preview.document}
                    className="plugin-ide-frame"
                  />
                ) : (
                  <div className="plugin-ide-preview-empty">
                    <Play />
                    <h3>{t("previewTitle")}</h3>
                    <p>{t(busy === "compile" ? "compiling" : "empty")}</p>
                    <Button
                      variant="outline"
                      disabled={!!busy}
                      onClick={() => void runPreview()}
                    >
                      {t("tryPreview")}
                    </Button>
                  </div>
                )}
                <details className="plugin-ide-console" open={logs.length > 0}>
                  <summary>
                    {t("console")} ({logs.length}){" "}
                    <span>{preview?.state === "ready" ? t("ready") : ""}</span>
                  </summary>
                  <pre>{logs.join("\n") || t("noLogs")}</pre>
                </details>
              </section>
            </div>
          </Allotment.Pane>
          <Allotment.Pane
            preferredSize={320}
            minSize={wide ? 270 : 0}
            maxSize={wide ? 560 : Infinity}
            visible={wide ? chatOpen : pane === "chat"}
          >
            <aside className="plugin-ide-chat" aria-label={t("chat")}>
              <h3 className="plugin-ide-panel-title">
                <Bot />
                {t("chat")}
                <span>{t("aiModel")}</span>
              </h3>
              <div
                ref={conversation}
                className="plugin-ide-conversation"
                role="log"
                aria-label={t("conversation")}
                aria-live="polite"
                aria-busy={generating}
              >
                {!history.length && (
                  <div className="plugin-ide-chat-welcome">
                    <h4>{t("welcome")}</h4>
                    <p>{t("welcomeHint")}</p>
                    <div className="plugin-ide-suggestions">
                      {["suggestTasks", "suggestDashboard"].map((key) => (
                        <button
                          key={key}
                          onClick={() => {
                            setPrompt(t(key as "suggestTasks"));
                            document
                              .getElementById("plugin-ide-prompt")
                              ?.focus();
                          }}
                        >
                          {t(key as "suggestTasks")}
                          <ArrowUp />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {history.map((item, index) => (
                  <article
                    key={index}
                    className={`plugin-ide-message plugin-ide-message-${item.role}`}
                  >
                    <span className="plugin-ide-message-author">
                      {item.role === "user" ? t("you") : t("assistant")}
                    </span>
                    {item.role === "assistant" ? (
                      <AssistantMarkdown text={item.content} />
                    ) : (
                      <p>{item.content}</p>
                    )}
                    {item.role === "assistant" && item.usage && (
                      <p
                        className="plugin-ide-usage"
                        title={t("tokenUsage")}
                        aria-label={t("tokenUsage")}
                      >
                        <span aria-hidden="true">
                          ↑{formatTokens(item.usage.input)}
                        </span>{" "}
                        <span aria-hidden="true">
                          ↓{formatTokens(item.usage.output)}
                        </span>
                      </p>
                    )}
                  </article>
                ))}
                {queue.map((item, index) => (
                  <article
                    key={`queued-${index}`}
                    className="plugin-ide-message plugin-ide-message-user"
                  >
                    <span className="plugin-ide-message-author">
                      {t("you")} · {t("queued")}
                    </span>
                    <p>{item}</p>
                    <button
                      type="button"
                      className="plugin-ide-queue-remove"
                      aria-label={`${t("removeQueued")} ${item.slice(0, 80)}`}
                      onClick={() => removeQueued(index)}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </article>
                ))}
                {generating && !!streamingMessage && (
                  <article className="plugin-ide-message plugin-ide-message-assistant">
                    <span className="plugin-ide-message-author">
                      {t("assistant")}
                    </span>
                    <AssistantMarkdown text={streamingMessage} />
                  </article>
                )}
                {generating && (
                  <p className="plugin-ide-generating" role="status">
                    <LoaderCircle />
                    {t("generating")}
                    <span aria-hidden="true">
                      {t("elapsedSeconds", { seconds: generationSeconds })}
                    </span>
                    <span
                      className="plugin-ide-usage"
                      title={t("tokenUsage")}
                      aria-label={t("tokenUsage")}
                    >
                      {liveUsage ? (
                        <>
                          <span aria-hidden="true">
                            ↑{formatTokens(liveUsage.input)}
                          </span>{" "}
                          <span aria-hidden="true">
                            ↓{formatTokens(liveUsage.output)}
                          </span>
                        </>
                      ) : (
                        <span aria-hidden="true">
                          ↑~{formatTokens(estimatedInput)}
                        </span>
                      )}
                    </span>
                  </p>
                )}
                {chatError && (
                  <div className="plugin-ide-chat-error" role="alert">
                    <p style={{ whiteSpace: "pre-line" }}>{chatError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={locked}
                      onClick={() => void generate(lastPrompt)}
                    >
                      {t("retry")}
                    </Button>
                  </div>
                )}
                {proposal && (
                  <section
                    className="plugin-ide-proposal"
                    aria-label={t("proposed")}
                  >
                    <h4>
                      {t("proposed")} <span>{changedFiles.length}</span>
                    </h4>
                    {changedFiles.map((name) => (
                      <button
                        className="plugin-ide-change-file"
                        key={name}
                        onClick={() => {
                          setReviewFile(name);
                          setPane("code");
                        }}
                      >
                        <FileCode2 />
                        <span>{name}</span>
                        <span>{t("review")}</span>
                      </button>
                    ))}
                    <div className="plugin-ide-proposal-actions">
                      <Button
                        size="sm"
                        disabled={locked || !changedFiles.length}
                        onClick={() => {
                          setUndo(files);
                          replaceFiles(proposal.files);
                          setPane("code");
                        }}
                      >
                        {t("apply")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={locked}
                        onClick={() => {
                          setProposal(null);
                          setReviewFile(null);
                        }}
                      >
                        {t("discard")}
                      </Button>
                    </div>
                  </section>
                )}
              </div>
              <div className="plugin-ide-compose-area">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void generate();
                  }}
                  className="plugin-ide-prompt"
                >
                  <label htmlFor="plugin-ide-prompt" className="sr-only">
                    {t("prompt")}
                  </label>
                  <Textarea
                    id="plugin-ide-prompt"
                    value={prompt}
                    maxLength={8000}
                    rows={3}
                    disabled={!!busy}
                    placeholder={
                      generating ? t("queuePlaceholder") : t("placeholder")
                    }
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        void generate();
                      }
                    }}
                  />
                  <div className="plugin-ide-compose-tools">
                    <span>
                      <Files />
                      {t("projectContext")}
                    </span>
                    {generating && (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        aria-label={t("cancel")}
                        onClick={() => {
                          operation.current++;
                          controller.current?.abort();
                          setStreamingMessage("");
                          setLiveUsage(null);
                          setPrompt(lastPrompt);
                          const next = shiftQueue();
                          setGenerating(Boolean(next));
                          if (next) void runGeneration(next);
                        }}
                      >
                        <Square />
                      </Button>
                    )}
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!!busy || !prompt.trim()}
                      aria-label={generating ? t("queueSend") : t("send")}
                      title={generating ? t("queueSend") : undefined}
                    >
                      <ArrowUp />
                    </Button>
                  </div>
                </form>
                <p className="plugin-ide-hint">{t("aiHint")}</p>
              </div>
            </aside>
          </Allotment.Pane>
        </Allotment>
      </div>
      <footer className="plugin-ide-statusbar">
        <span role="status">{saveStatus ?? t("draft")}</span>
        <span>
          {t(selected === "entry.tsx" ? "typescriptLanguage" : "jsonLanguage")}
        </span>
        {undo && (
          <button
            disabled={locked}
            onClick={() => {
              replaceFiles(undo);
              setUndo(null);
            }}
          >
            <Undo2 />
            {t("undo")}
          </button>
        )}
      </footer>
    </section>
  );
}
