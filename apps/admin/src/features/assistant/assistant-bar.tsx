import {
  AssistantQuoteResult,
  parseQuoteResult,
  quoteFieldLabels,
  formatQuoteField,
} from "./assistant-quote-result";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AssistantRuntimeProvider,
  AttachmentPrimitive,
  ComposerPrimitive,
  getExternalStoreMessages,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/ai-sdk";
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Check,
  Copy,
  Cpu,
  Database,
  FileSpreadsheet,
  FileText,
  History,
  LoaderCircle,
  MessageSquare,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Square,
  SquarePen,
  Table,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { VirtualEmployee } from "@/api/virtual-employees-client";
import type {
  AssistantModel,
  AssistantConfigurationSummary,
} from "@/api/assistant-configuration-client";
import { ModelCapabilityBadges } from "@/features/assistant-configuration/model-capability-badges";
import { getEmployeeAvatarIcon } from "@/features/personal-integrations/virtual-employees-management";
import { requestAssistantAction } from "./assistant-api";
import { useAppServices } from "./assistant-context";
import { ActiveTenantSelector } from "./active-tenant-selector";
import {
  AssistantMarkdown,
  AssistantPresentationCard,
  presentationFrom,
} from "./assistant-response-ui";
import type { StoredUIMessage } from "./assistant-thread-storage";
import type { RecordingContext } from "./assistant-threads-client";
import { useAssistantThreads } from "./use-assistant-threads";
import { AssistantSyncStatus } from "./assistant-sync-status";
import { assistantSyncMessages } from "./assistant-sync-messages";
import { AssistantThreadList } from "./assistant-thread-list";
import { useMessages } from "@/i18n/core";
import { uiMessages } from "@/i18n/locales/ui";
import { assistantExternalMessages } from "./assistant-external-messages";
import {
  formatExternalAssistantAnswer,
  formatExternalAssistantConversation,
} from "./assistant-external-copy";
import {
  getPluginAssistantProvider,
  subscribePluginAssistantProvider,
  type PluginAssistantProvider,
  type PluginAssistantResponse,
} from "@savia/studio-shared/plugin-assistant";

function ProviderSources({
  citations,
}: {
  citations: NonNullable<
    PluginAssistantResponse["messages"][number]["citations"]
  >;
}) {
  const tx = useMessages(assistantExternalMessages);
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const shown = search
    ? citations.filter((citation) =>
        `${citation.id} ${citation.label}`.toLocaleLowerCase().includes(search),
      )
    : citations;
  return (
    <details className="mt-3 border-t border-current/15 pt-2 text-xs">
      <summary className="cursor-pointer py-1 font-medium">
        {tx("Sources (%{count})", { count: citations.length })}
      </summary>
      {citations.length > 8 && (
        <label className="mt-3 block">
          <span className="mb-1 block font-medium">{tx("Search sources")}</span>
          <input
            type="search"
            aria-label={tx("Search sources")}
            placeholder={tx("Reference or document name")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          />
        </label>
      )}
      {shown.length === 0 && (
        <p className="mt-3">{tx("No sources match this search.")}</p>
      )}
      <ul className="mt-3 space-y-4">
        {shown.map((citation) => (
          <li key={citation.id}>
            <strong>
              {citation.id} · {citation.label}
            </strong>
            <p className="mt-1 whitespace-pre-wrap opacity-80">
              {citation.excerpt}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ExternalAssistantConversation({
  provider,
  onReturn,
}: {
  provider: PluginAssistantProvider;
  onReturn: () => void;
}) {
  const [conversation, setConversation] = useState<PluginAssistantResponse>({
    revision: 0,
    messages: [],
  });
  const [draft, setDraft] = useState(provider.initialMessage ?? "");
  const draftRef = useRef(provider.initialMessage ?? "");
  const [loading, setLoading] = useState(true);
  const [loadedSuccessfully, setLoadedSuccessfully] = useState(false);
  const [sending, setSending] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<
    "answer" | "conversation" | "error" | null
  >(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedConversation, setCopiedConversation] = useState(false);
  const copyFeedbackGeneration = useRef(0);
  const pollRunning = useRef(false);
  const mounted = useRef(true);
  const refreshedAt = useRef(0);
  const scrollArea = useRef<HTMLDivElement>(null);
  const latestMessage = useRef<HTMLElement>(null);
  const sendAttempt = useRef<{ message: string; key: string } | null>(null);
  const tx = useMessages(assistantExternalMessages);

  useLayoutEffect(() => {
    copyFeedbackGeneration.current += 1;
    setCopyFeedback(null);
    setCopiedMessageId(null);
    setCopiedConversation(false);
  }, [
    conversation.messages,
    provider.sessionId,
    provider.actionId,
    provider.connectionId,
    provider.context,
  ]);

  const copyText = async (
    text: string,
    target: "answer" | "conversation",
    messageId?: string,
  ) => {
    const generation = copyFeedbackGeneration.current;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      if (generation !== copyFeedbackGeneration.current) return;
      setCopyFeedback(target);
      setCopiedMessageId(target === "answer" ? (messageId ?? null) : null);
      setCopiedConversation(target === "conversation");
    } catch {
      if (generation !== copyFeedbackGeneration.current) return;
      setCopyFeedback("error");
      setCopiedMessageId(null);
      setCopiedConversation(false);
    }
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await provider.invoke({ method: "load" });
      if (!mounted.current) return;
      setLoadedSuccessfully(true);
      setConversation(result);
      if (result.pendingJobId) refreshedAt.current = Date.now();
    } catch (caught) {
      if (mounted.current)
        setError(
          caught instanceof Error
            ? caught.message
            : tx("Could not load this conversation."),
        );
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [provider, tx]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const recoverFromPollFailure = useCallback(
    async (caught: unknown) => {
      const message =
        caught instanceof Error
          ? caught.message
          : tx("Could not update the response.");
      if (!mounted.current) return;
      setError(message);
      try {
        const result = await provider.invoke({ method: "load" });
        if (!mounted.current) return;
        setLoadedSuccessfully(true);
        setConversation(result);
        // Only a fresh provider load may retire a failed job. Keep the poll
        // error visible whether the provider reports it as terminal or still
        // pending, so the user can understand the recovery state.
        setError(message);
      } catch {
        if (mounted.current) setError(message);
      }
    },
    [provider, tx],
  );

  useEffect(() => {
    if (!conversation.pendingJobId) return;
    const timer = window.setInterval(() => {
      if (pollRunning.current || pollTimedOut) return;
      if (Date.now() - refreshedAt.current > 180_000) {
        setPollTimedOut(true);
        setError(
          tx(
            "The response is taking longer than expected. Check its status to continue.",
          ),
        );
        return;
      }
      pollRunning.current = true;
      void provider
        .invoke({ method: "poll", jobId: conversation.pendingJobId! })
        .then((result) => {
          if (mounted.current) {
            setLoadedSuccessfully(true);
            setConversation(result);
            if (!result.pendingJobId) setError(null);
          }
        })
        .catch((caught) => {
          return recoverFromPollFailure(caught);
        })
        .finally(() => {
          pollRunning.current = false;
        });
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [
    conversation.pendingJobId,
    pollTimedOut,
    provider,
    recoverFromPollFailure,
  ]);

  useLayoutEffect(() => {
    const area = scrollArea.current;
    const latest = latestMessage.current;
    if (area && latest)
      area.scrollTop = Math.max(0, latest.offsetTop - area.offsetTop - 12);
  }, [conversation.messages.length]);

  const checkStatus = async () => {
    if (!conversation.pendingJobId || pollRunning.current) return;
    pollRunning.current = true;
    setError(null);
    setPollTimedOut(false);
    refreshedAt.current = Date.now();
    try {
      const result = await provider.invoke({
        method: "poll",
        jobId: conversation.pendingJobId,
      });
      if (mounted.current) {
        setLoadedSuccessfully(true);
        setConversation(result);
      }
    } catch (caught) {
      await recoverFromPollFailure(caught);
    } finally {
      pollRunning.current = false;
    }
  };

  const send = async () => {
    const sentDraft = draft;
    const message = sentDraft.trim();
    if (!message || !loadedSuccessfully || sending || conversation.pendingJobId)
      return;
    setSending(true);
    setError(null);
    const idempotencyKey =
      sendAttempt.current?.message === message
        ? sendAttempt.current.key
        : crypto.randomUUID();
    sendAttempt.current = { message, key: idempotencyKey };
    try {
      const result = await provider.invoke({
        method: "send",
        message,
        idempotencyKey,
        ...(conversation.conversationId
          ? { conversationId: conversation.conversationId }
          : {}),
        expectedRevision: conversation.revision,
      });
      if (!mounted.current) return;
      setConversation(result);
      if (draftRef.current === sentDraft) {
        draftRef.current = "";
        setDraft("");
      }
      sendAttempt.current = null;
      setPollTimedOut(false);
      if (result.pendingJobId) refreshedAt.current = Date.now();
    } catch (caught) {
      if (mounted.current)
        setError(
          caught instanceof Error
            ? caught.message
            : tx("Could not send this message."),
        );
    } finally {
      if (mounted.current) setSending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReturn}
          className="h-8 gap-1.5 px-2"
        >
          <ArrowLeft className="size-4" /> {tx("General assistant")}
        </Button>
        <div className="min-w-0 flex-1 text-right">
          <p className="truncate text-sm font-medium">{provider.title}</p>
          <p className="text-xs text-muted-foreground">
            {tx("Connected assistant")}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={tx("Copy conversation")}
              title={tx("Copy conversation")}
              disabled={loading || conversation.messages.length === 0}
              onClick={() =>
                void copyText(
                  formatExternalAssistantConversation(
                    provider.title,
                    conversation.messages,
                    {
                      user: tx("You"),
                      assistant: tx("Assistant"),
                      sources: tx("Sources"),
                      insufficientEvidence: tx(
                        "The available sources do not support a complete answer.",
                      ),
                      stale: tx("This answer uses an earlier source version."),
                    },
                  ),
                  "conversation",
                )
              }
            >
              {copiedConversation ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{tx("Copy conversation")}</TooltipContent>
        </Tooltip>
      </div>
      {copyFeedback && (
        <p
          role={copyFeedback === "error" ? "alert" : "status"}
          className={cn(
            "px-4 py-1 text-xs",
            copyFeedback === "error"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {copyFeedback === "error"
            ? tx("Unable to copy. Clipboard access is unavailable.")
            : copyFeedback === "answer"
              ? tx("Answer copied.")
              : tx("Conversation copied.")}
        </p>
      )}
      {conversation.coverage && (
        <div className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          {conversation.coverage.label}
          {conversation.coverage.complete ? "" : ` · ${tx("partial")}`}
        </div>
      )}
      <div
        ref={scrollArea}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5"
        aria-live="polite"
      >
        {loading && (
          <p className="text-sm text-muted-foreground">
            {tx("Loading conversation…")}
          </p>
        )}
        {!loading && conversation.messages.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">
            {tx("Ask a question about this workspace item.")}
          </p>
        )}
        {conversation.messages.map((message, index) => (
          <article
            key={message.id}
            ref={
              index === conversation.messages.length - 1
                ? latestMessage
                : undefined
            }
            className={cn(
              "min-w-0 max-w-[92%] rounded-xl px-4 py-3 text-sm leading-6 [overflow-wrap:anywhere] [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2:first-child]:mt-0 [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:font-semibold [&_strong]:text-inherit",
              message.role === "user"
                ? "self-end bg-primary text-primary-foreground"
                : "self-start bg-muted/70",
            )}
          >
            <AssistantMarkdown text={message.text} />
            {message.insufficientEvidence && (
              <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">
                {tx("The available sources do not support a complete answer.")}
              </p>
            )}
            {message.stale && (
              <p className="mt-2 text-xs text-muted-foreground">
                {tx("This answer uses an earlier source version.")}
              </p>
            )}
            {message.citations?.length ? (
              <ProviderSources citations={message.citations} />
            ) : null}
            {message.role === "assistant" && (
              <div className="mt-2 flex justify-end border-t border-current/10 pt-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={
                        copiedMessageId === message.id
                          ? tx("Answer copied")
                          : tx("Copy answer")
                      }
                      title={
                        copiedMessageId === message.id
                          ? tx("Answer copied")
                          : tx("Copy answer")
                      }
                      onClick={() =>
                        void copyText(
                          formatExternalAssistantAnswer(message, {
                            sources: tx("Sources"),
                            insufficientEvidence: tx(
                              "The available sources do not support a complete answer.",
                            ),
                            stale: tx(
                              "This answer uses an earlier source version.",
                            ),
                          }),
                          "answer",
                          message.id,
                        )
                      }
                    >
                      {copiedMessageId === message.id ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <Copy className="size-4" aria-hidden="true" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {copiedMessageId === message.id
                      ? tx("Answer copied")
                      : tx("Copy answer")}
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </article>
        ))}
        {conversation.pendingJobId && (
          <div>
            <p className="text-sm text-muted-foreground">
              {tx("Preparing a response…")}
            </p>
            {pollTimedOut && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => void checkStatus()}
              >
                {tx("Check status")}
              </Button>
            )}
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
            {!conversation.pendingJobId && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => void load()}
                className="ml-2 h-auto p-0"
              >
                {tx("Retry")}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="border-t p-4">
        <label className="sr-only" htmlFor="external-assistant-composer">
          {tx("Message")}
        </label>
        <textarea
          id="external-assistant-composer"
          value={draft}
          onChange={(event) => {
            draftRef.current = event.target.value;
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          maxLength={8_000}
          placeholder={tx("Write your question…")}
          className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {tx("Shift+Enter for a new line")}
          </span>
          <Button
            type="button"
            onClick={() => void send()}
            disabled={
              !draft.trim() ||
              loading ||
              !loadedSuccessfully ||
              sending ||
              Boolean(conversation.pendingJobId)
            }
          >
            {sending ? (
              <LoaderCircle className="mr-2 size-4 animate-spin" />
            ) : (
              <SendHorizontal className="mr-2 size-4" />
            )}
            {tx("Send")}
          </Button>
        </div>
      </div>
    </div>
  );
}

type PreparedAction = {
  actionId: string;
  domain: string;
  command: string;
  expiresAt: string;
  input: Record<string, unknown>;
  requiresConfirmation: true;
};

type ActionState =
  | "idle"
  | "confirming"
  | "cancelling"
  | "confirmed"
  | "cancelled"
  | "error"
  | "unavailable";

function assistantApiUrl(apiUrl: string): string {
  return new URL("/api/assistant/chat", apiUrl).toString();
}

function preparedActionFrom(result: unknown): PreparedAction | null {
  if (typeof result !== "object" || result === null) return null;
  const candidate = result as Partial<PreparedAction>;
  if (
    typeof candidate.actionId !== "string" ||
    typeof candidate.domain !== "string" ||
    typeof candidate.command !== "string" ||
    typeof candidate.expiresAt !== "string" ||
    typeof candidate.input !== "object" ||
    candidate.input === null ||
    Array.isArray(candidate.input) ||
    candidate.requiresConfirmation !== true
  ) {
    return null;
  }
  return candidate as PreparedAction;
}

function redactedInput(value: unknown, key?: string): unknown {
  if (key && /(?:api.?key|authorization|password|secret|token)/i.test(key)) {
    return "[oculto]";
  }
  if (Array.isArray(value)) return value.map((item) => redactedInput(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        redactedInput(item, name),
      ]),
    );
  }
  return value;
}

function inputValue(value: unknown, key: string): string {
  const redacted = redactedInput(value, key);
  const rendered =
    typeof redacted === "string"
      ? redacted
      : (JSON.stringify(redacted) ?? String(redacted));
  return rendered.length > 400 ? `${rendered.slice(0, 397)}…` : rendered;
}

export function AssistantActionCard({ action }: { action: PreparedAction }) {
  const { authSession } = useAppServices();
  const [state, setState] = useState<ActionState>("idle");
  const [quoteResult, setQuoteResult] =
    useState<ReturnType<typeof parseQuoteResult>>(null);
  const isQuote =
    action.domain === "insurance" && action.command === "quote-auto";
  const [error, setError] = useState<string | null>(null);
  const apiUrl = import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin;
  const busy = state === "confirming" || state === "cancelling";

  useEffect(() => {
    if (
      !isQuote ||
      state === "confirmed" ||
      state === "cancelled" ||
      state === "unavailable"
    )
      return;
    let active = true;
    const restore = async () => {
      try {
        const token = await authSession.getAccessToken();
        if (!token) return;
        const response = await fetch(
          new URL(
            `/api/assistant/actions/${encodeURIComponent(action.actionId)}`,
            apiUrl,
          ),
          {
            headers: { Authorization: `Bearer ${token}` },
            credentials: "include",
          },
        );
        if (!response.ok || !active) return;
        const saved = await response.json();
        if (!active) return;
        if (saved.state === "completed") {
          setQuoteResult(parseQuoteResult(saved.result));
          setState("confirmed");
        } else if (saved.state === "executing") setState("confirming");
        else if (saved.state === "cancelled") setState("cancelled");
        else if (saved.state === "expired" || saved.state === "failed") {
          setState("unavailable");
          setError(
            saved.state === "expired"
              ? "La confirmación venció sin enviar la solicitud. Pide a Alice que la prepare nuevamente."
              : "La cotización no pudo completarse. Revisa el historial del cotizador antes de solicitarla nuevamente: algunas aseguradoras pudieron recibir los datos.",
          );
        }
      } catch {
        /* Confirmation remains protected by the server's consume-once guard. */
      }
    };
    void restore();
    const timer = window.setInterval(() => void restore(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isQuote, action.actionId, apiUrl, authSession, state]);

  const resolveAction = async (operation: "confirm" | "cancel") => {
    setState(operation === "confirm" ? "confirming" : "cancelling");
    setError(null);

    try {
      const accessToken = await authSession.getAccessToken();
      if (!accessToken) {
        throw new Error(
          "Tu sesión ya no está disponible. Vuelve a iniciar sesión.",
        );
      }
      const response = await requestAssistantAction({
        apiUrl,
        actionId: action.actionId,
        operation,
        accessToken,
      });
      const nextState = (response as { state?: unknown }).state;
      const expectedState = operation === "confirm" ? "completed" : "cancelled";
      if (nextState !== expectedState) {
        throw new Error(
          nextState === "unavailable"
            ? "Esta acción ya no está disponible. Solicita una nueva propuesta."
            : "El cambio no pudo completarse. Revisa los datos y solicita una nueva propuesta.",
        );
      }
      if (isQuote && operation === "confirm")
        setQuoteResult(
          parseQuoteResult((response as { result?: unknown }).result),
        );
      setState(operation === "confirm" ? "confirmed" : "cancelled");
    } catch (exception) {
      setError(
        exception instanceof Error
          ? exception.message
          : "No fue posible completar esta acción.",
      );
      setState("error");
    }
  };

  const isStudioAction =
    action.domain === "crm" ||
    action.command.includes("record") ||
    action.command.includes("create") ||
    action.command.includes("update") ||
    action.command.includes("delete");

  const studioCollection = String(
    action.input.collection ??
      action.input.object ??
      (action.domain !== "crm" ? action.domain : ""),
  ).trim();

  let actionTitle = isQuote
    ? "consultar las aseguradoras habilitadas"
    : `${action.domain}.${action.command}`;
  if (isStudioAction && studioCollection) {
    const cmd = action.command.toLowerCase();
    if (cmd.includes("create")) {
      actionTitle = `Crear registro en "${studioCollection}"`;
    } else if (cmd.includes("update") || cmd.includes("edit")) {
      actionTitle = `Actualizar registro en "${studioCollection}"`;
    } else if (cmd.includes("delete") || cmd.includes("remove")) {
      actionTitle = `Eliminar registro en "${studioCollection}"`;
    }
  }

  const flattenedEntries = useMemo(() => {
    const entries: Array<{ key: string; value: unknown }> = [];
    for (const [name, value] of Object.entries(action.input)) {
      if (
        (name === "data" ||
          (isQuote && ["vehicle", "applicant"].includes(name))) &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        for (const [subKey, subVal] of Object.entries(value)) {
          entries.push({
            key: isQuote ? `${name}.${subKey}` : subKey,
            value: subVal,
          });
        }
      } else {
        entries.push({ key: name, value });
      }
    }
    return entries;
  }, [action.input, isQuote]);

  return (
    <section
      className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-sm shadow-2xs"
      data-testid="assistant-action-card"
    >
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">
            {isQuote
              ? "Cotización lista para enviar"
              : "Cambio pendiente de confirmación"}
          </p>
          <p className="mt-1 leading-5 text-muted-foreground">
            {isQuote ? "La solicitud para " : "La actualización para "}
            <span className="font-medium text-foreground">
              {actionTitle}
            </span>{" "}
            solo se ejecutará si la confirmas.
          </p>
          <dl className="mt-3 space-y-1 rounded-lg border bg-background/80 p-2.5 text-xs">
            {flattenedEntries.map(({ key: name, value }) => (
              <div
                className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2"
                key={name}
              >
                <dt className="truncate font-medium text-muted-foreground">
                  {isQuote ? (quoteFieldLabels[name] ?? name) : name}
                </dt>
                <dd className="break-words text-foreground">
                  {isQuote
                    ? formatQuoteField(value, name)
                    : inputValue(value, name)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {state === "confirmed" ? (
        <p className="mt-3 flex items-center gap-2 font-medium text-primary">
          <Check className="size-4" />{" "}
          {isQuote
            ? "Consulta a aseguradoras completada."
            : "Cambio ejecutado."}
        </p>
      ) : null}
      {quoteResult ? <AssistantQuoteResult result={quoteResult} /> : null}
      {state === "cancelled" ? (
        <p className="mt-3 flex items-center gap-2 text-muted-foreground">
          <X className="size-4" /> Cambio cancelado.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-destructive">{error}</p> : null}

      {state !== "confirmed" &&
      state !== "cancelled" &&
      state !== "unavailable" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => void resolveAction("confirm")}
            disabled={busy}
          >
            {state === "confirming" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Check />
            )}
            {isQuote
              ? busy
                ? "Consultando aseguradoras…"
                : "Confirmar y cotizar"
              : "Confirmar cambio"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void resolveAction("cancel")}
            disabled={busy}
          >
            {state === "cancelling" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <X />
            )}
            Cancelar
          </Button>
        </div>
      ) : null}
    </section>
  );
}

const toolDescriptorConfig: Record<
  string,
  { inProgress: string; done: string }
> = {
  savia_list_studio_collections: {
    inProgress: "Explorando colecciones de Studio…",
    done: "Colecciones de Studio consultadas",
  },
  savia_list_studio_records: {
    inProgress: "Consultando registros de Studio…",
    done: "Registros de Studio obtenidos",
  },
  savia_aggregate_studio_records: {
    inProgress: "Calculando estadísticas en la base de datos…",
    done: "Métricas calculadas",
  },
  savia_get_studio_record: {
    inProgress: "Consultando detalle de registro…",
    done: "Detalle obtenido",
  },
  savia_get_studio_record_links: {
    inProgress: "Consultando relaciones…",
    done: "Relaciones obtenidas",
  },
  savia_list_crm_collections: {
    inProgress: "Explorando colecciones de Studio…",
    done: "Colecciones de Studio consultadas",
  },
  savia_list_crm_records: {
    inProgress: "Consultando registros de Studio…",
    done: "Registros de Studio obtenidos",
  },
  savia_aggregate_crm_records: {
    inProgress: "Calculando estadísticas en la base de datos…",
    done: "Métricas calculadas",
  },
  savia_get_crm_record: {
    inProgress: "Consultando detalle de registro…",
    done: "Detalle obtenido",
  },
  savia_get_crm_record_links: {
    inProgress: "Consultando relaciones…",
    done: "Relaciones obtenidas",
  },
  savia_list_domains: {
    inProgress: "Consultando dominios autorizados…",
    done: "Dominios consultados",
  },
  savia_list_documents: {
    inProgress: "Buscando documentos…",
    done: "Documentos obtenidos",
  },
  savia_get_document: {
    inProgress: "Obteniendo documento…",
    done: "Documento obtenido",
  },
  savia_search_personal_files: {
    inProgress: "Buscando en archivos personales…",
    done: "Búsqueda en archivos completada",
  },
  savia_search_personal_messages: {
    inProgress: "Buscando en mensajes…",
    done: "Búsqueda en mensajes completada",
  },
  savia_list_personal_events: {
    inProgress: "Consultando agenda…",
    done: "Agenda consultada",
  },
};

function AssistantToolCall({
  toolName,
  args,
  result,
  isError,
}: ToolCallMessagePartProps) {
  const payload = result ?? args;
  const action = preparedActionFrom(payload);
  const presentation = presentationFrom(payload);
  if (
    action &&
    (toolName === "savia_prepare_command" ||
      toolName === "tool-savia_prepare_command")
  ) {
    return <AssistantActionCard action={action} />;
  }
  if (
    presentation &&
    (toolName === "savia_present_visualization" ||
      toolName === "tool-savia_present_visualization")
  ) {
    return <AssistantPresentationCard presentation={presentation} />;
  }

  return null;
}

function AssistantToolTrace({
  toolName,
  result,
  isError,
}: ToolCallMessagePartProps) {
  const name = toolName.replace(/^tool-/, "");
  const descriptor = toolDescriptorConfig[name];
  return (
    <p className="py-1 text-xs text-muted-foreground">
      {isError
        ? "Una consulta no se completó"
        : result === undefined
          ? "Consulta en curso"
          : (descriptor?.done ?? "Consulta completada")}
    </p>
  );
}

function AssistantActivity() {
  const toolCount = useAuiState(
    (s) => s.message.parts.filter((p) => p.type === "tool-call").length,
  );
  if (!toolCount) return null;
  return (
    <details className="mt-3 text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-ring">
        Ver consultas ({toolCount})
      </summary>
      <div className="mt-1 space-y-1">
        <MessagePrimitive.Parts
          components={{
            Text: ({ text }) => (
              <p className="text-xs text-muted-foreground">{text}</p>
            ),
            Reasoning: () => null,
            tools: { Override: AssistantToolTrace },
          }}
        />
      </div>
    </details>
  );
}

function extractUserText(userMsg: unknown): string {
  if (!userMsg || typeof userMsg !== "object") return "";
  const msg = userMsg as Record<string, unknown>;
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((c) =>
        typeof c === "string"
          ? c
          : ((c as Record<string, unknown>)?.text ?? ""),
      )
      .join(" ");
  }
  if (Array.isArray(msg.parts)) {
    return (msg.parts as Record<string, unknown>[])
      .filter((p) => p && p.type === "text")
      .map((p) => (p.text as string) ?? "")
      .join(" ");
  }
  return "";
}

function findMentionedEmployee(
  text: string,
  employees: VirtualEmployee[],
): VirtualEmployee | null {
  if (!text || employees.length === 0) return null;
  const match = text.match(/@([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  const handle = match[1].toLowerCase();
  return employees.find((e) => e.handle.toLowerCase() === handle) ?? null;
}

function ChatMessage({
  isUser,
  message,
  employees = [],
}: {
  isUser: boolean;
  message?: unknown;
  employees?: VirtualEmployee[];
}) {
  const t = useMessages(uiMessages);
  const threadMessages = useAuiState((s) => s.thread.messages);
  const messageParts = useAuiState((s) => s.message.parts);
  const answerText = (() => {
    const parts = messageParts;
    let lastTool = -1;
    parts.forEach((part, index) => {
      if (part.type === "tool-call") lastTool = index;
    });
    const afterTools = parts
      .slice(lastTool + 1)
      .filter((p) => p.type === "text")
      .map((p) => p.text);
    return afterTools.length
      ? afterTools
      : parts
          .filter((p) => p.type === "text")
          .slice(-1)
          .map((p) => p.text);
  })();

  if (isUser) {
    return (
      <MessagePrimitive.Root className="ml-auto max-w-[90%] rounded-xl bg-muted px-4 py-3 text-sm text-foreground">
        <div className="flex flex-wrap gap-1.5 mb-1.5 empty:hidden">
          <MessagePrimitive.Attachments
            components={{
              Attachment: MessageAttachment,
            }}
          />
        </div>
        <MessagePrimitive.Parts
          components={{
            Text: ({ text }) => (
              <p className="whitespace-pre-wrap break-words">{text}</p>
            ),
          }}
        />
      </MessagePrimitive.Root>
    );
  }

  let respondingEmployee: VirtualEmployee | null = null;
  if (employees.length > 0 && message && typeof message === "object") {
    const currentId = (message as { id?: unknown }).id;
    if (currentId) {
      const currentIndex = threadMessages.findIndex((m) => m.id === currentId);
      if (currentIndex > 0) {
        for (let i = currentIndex - 1; i >= 0; i--) {
          const item = threadMessages[i];
          if (item?.role === "user") {
            const text = extractUserText(item);
            const found = findMentionedEmployee(text, employees);
            if (found) {
              respondingEmployee = found;
              break;
            }
          }
        }
      }
    }
  }

  const EmployeeIcon = respondingEmployee
    ? getEmployeeAvatarIcon(respondingEmployee.avatar)
    : Sparkles;

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <div className="flex size-5 items-center justify-center rounded-md bg-primary/10 text-primary">
          <EmployeeIcon className="size-3" />
        </div>
        <span className="text-xs font-semibold tracking-tight text-foreground/80">
          {respondingEmployee ? respondingEmployee.name : t("Savia assistant")}
        </span>
      </div>
      <MessagePrimitive.Root className="min-w-0 text-sm leading-relaxed text-foreground">
        <MessagePrimitive.Parts
          components={{
            Text: ({ text }) =>
              answerText.includes(text) ? (
                <AssistantMarkdown text={text} />
              ) : null,
            Reasoning: () => null,
            tools: { Override: AssistantToolCall },
          }}
        />
        <AssistantActivity />
        <MessagePrimitive.Error>
          <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>{t("The response was interrupted. Try again.")}</span>
          </div>
        </MessagePrimitive.Error>
      </MessagePrimitive.Root>
    </div>
  );
}

const quickPrompts = [
  {
    icon: Users,
    label: "Customers by city",
    prompt: "Ask about customers by city in a bar chart.",
  },
  {
    icon: Database,
    label: "CRM collections",
    prompt:
      "Ask what collections are available and how many records they contain.",
  },
  {
    icon: BarChart3,
    label: "Quotes by status",
    prompt:
      "Create a report with quotes grouped by status in a chart and table.",
  },
  {
    icon: FileSpreadsheet,
    label: "Active customers with email and city",
    prompt: "Show active customers with their email, phone, and city.",
  },
];

function RuntimeStatusSync({
  onStatusChange,
}: {
  onStatusChange?: (isRunning: boolean) => void;
}) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  useEffect(() => {
    onStatusChange?.(isRunning);
    return () => onStatusChange?.(false);
  }, [isRunning, onStatusChange]);
  return null;
}

function AssistantRunningIndicator({
  employees = [],
}: {
  employees?: VirtualEmployee[];
}) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  if (!isRunning) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="assistant-thinking-indicator"
      className="flex items-center gap-2 py-2 text-xs text-muted-foreground"
    >
      <LoaderCircle
        aria-hidden="true"
        className="size-3.5 animate-spin motion-reduce:animate-none"
      />
      <span>Consultando datos y preparando respuesta…</span>
    </div>
  );
}

function MessageAttachment() {
  return (
    <AttachmentPrimitive.Root className="inline-flex items-center gap-1 rounded bg-primary-foreground/20 px-2 py-0.5 text-xs text-primary-foreground">
      <Paperclip className="size-3 shrink-0" />
      <span className="max-w-[140px] truncate">
        <AttachmentPrimitive.Name />
      </span>
    </AttachmentPrimitive.Root>
  );
}

function ComposerAttachment() {
  return (
    <AttachmentPrimitive.Root className="relative inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/60 px-2.5 py-1 text-xs text-foreground shadow-2xs">
      <Paperclip className="size-3 text-muted-foreground shrink-0" />
      <span className="max-w-[140px] truncate font-medium">
        <AttachmentPrimitive.Name />
      </span>
      <AttachmentPrimitive.Remove asChild>
        <button
          type="button"
          className="ml-1 rounded-full p-0.5 text-muted-foreground transition hover:bg-muted-foreground/20 hover:text-foreground"
          aria-label="Quitar archivo adjunto"
        >
          <X className="size-3" />
        </button>
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

function injectTextIntoInput(
  textarea: HTMLTextAreaElement,
  textToInsert: string,
) {
  const val = textarea.value;
  const nextVal = val
    ? val.endsWith(" ")
      ? val + textToInsert
      : val + " " + textToInsert
    : textToInsert;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (setter) {
    setter.call(textarea, nextVal);
  } else {
    textarea.value = nextVal;
  }
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
  const nextPos = nextVal.length;
  textarea.setSelectionRange(nextPos, nextPos);
}

function VoiceDictationButton({
  inputRef,
  disabled = false,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
}) {
  const t = useMessages(uiMessages);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const isSupported =
    typeof window !== "undefined" &&
    Boolean(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition,
    );

  const toggleListening = useCallback(() => {
    if (!isSupported) {
      toast.error(t("Voice dictation is not supported in this browser"));
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    const SpeechRecClass =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecClass();
    recognitionRef.current = recognition;
    recognition.lang = "es-ES";
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result && result[0]?.transcript) {
          const text = result[0].transcript.trim();
          if (text && inputRef.current) {
            injectTextIntoInput(inputRef.current, text);
          }
        }
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== "aborted") {
        console.error("Speech recognition error:", event.error);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    try {
      recognition.start();
    } catch {
      setIsListening(false);
    }
  }, [isSupported, isListening, inputRef]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  if (!isSupported) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            type="button"
            variant="ghost"
            disabled
            data-testid="composer-voice-dictation"
            aria-label={t("Voice dictation is not supported in this browser")}
            className="size-9 shrink-0 rounded-lg text-muted-foreground/30 cursor-not-allowed"
          >
            <Mic className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">
            {t(
              "Your browser does not support voice dictation (use Chrome, Edge, or Safari)",
            )}
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={toggleListening}
          data-testid="composer-voice-dictation"
          aria-label={t(
            isListening ? "Stop voice dictation" : "Voice dictation",
          )}
          title={t(isListening ? "Stop voice dictation" : "Voice dictation")}
          className={cn(
            "size-9 shrink-0 rounded-lg transition-colors active:scale-95",
            isListening
              ? "bg-red-500/15 text-red-600 hover:bg-red-500/25 dark:text-red-400 animate-pulse border border-red-500/30"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          {isListening ? (
            <MicOff className="size-4 text-red-600 dark:text-red-400" />
          ) : (
            <Mic className="size-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="font-semibold text-xs">
          {isListening ? t("Listening… Click to stop") : t("Voice dictation")}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {isListening
            ? t("Transcribing in real time")
            : t("Speak to write your message")}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function ComposerAttachmentButton({
  canUpload,
  activeModelName,
}: {
  canUpload: boolean;
  activeModelName?: string;
}) {
  const t = useMessages(uiMessages);
  if (!canUpload) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            type="button"
            variant="ghost"
            disabled
            data-testid="composer-attachment-button"
            aria-label={t("Attachments are not supported")}
            className="size-9 shrink-0 rounded-lg text-muted-foreground/30 cursor-not-allowed opacity-50"
          >
            <Paperclip className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p className="font-semibold text-amber-600 dark:text-amber-400">
            {t("Attachments are not supported")}
          </p>
          <p className="text-muted-foreground">
            {t(
              "The current model (%{model}) does not support vision or files. Mention an employee or select a multimodal model with vision to attach files.",
              { model: activeModelName || t("plain text") },
            )}
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ComposerPrimitive.AddAttachment asChild>
          <Button
            size="icon"
            type="button"
            variant="ghost"
            data-testid="composer-attachment-button"
            aria-label={t("Attach file or image")}
            title={t("Attach file or image")}
            className="size-9 shrink-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95"
          >
            <Paperclip className="size-4" />
          </Button>
        </ComposerPrimitive.AddAttachment>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="font-semibold text-xs">{t("Attach file or image")}</p>
        <p className="text-[11px] text-muted-foreground">
          {t("Supports images, documents, and data files")}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function ComposerActiveContext({
  activeEmployee,
  model,
  modelId,
}: {
  activeEmployee: VirtualEmployee | null;
  model: AssistantModel | null;
  modelId?: string;
}) {
  const Icon = getEmployeeAvatarIcon(activeEmployee?.avatar);

  return (
    <div
      className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5 px-1 text-[11px] text-muted-foreground"
      data-testid="composer-active-context"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {activeEmployee ? (
          <>
            <div className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary">
              <Icon className="size-3" />
            </div>
            <span className="font-medium text-foreground truncate">
              {activeEmployee.name}
            </span>
            <span className="font-mono text-primary font-medium">
              @{activeEmployee.handle}
            </span>
            {activeEmployee.model ? (
              <span
                className="text-muted-foreground/60 text-[10px] truncate max-w-[110px]"
                title={activeEmployee.model}
              >
                ({activeEmployee.model})
              </span>
            ) : null}
          </>
        ) : (
          <>
            <Cpu className="size-3 text-muted-foreground shrink-0" />
            <span className="truncate font-medium text-foreground/80">
              {model?.name || modelId || "Modelo predeterminado"}
            </span>
          </>
        )}
      </div>

      <ModelCapabilityBadges model={model} size="xs" />
    </div>
  );
}

function ComposerTextInput({
  employees = [],
  inputRef: externalInputRef,
  placeholder,
}: {
  employees?: VirtualEmployee[];
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
}) {
  const t = useMessages(uiMessages);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const localInputRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = externalInputRef ?? localInputRef;
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredEmployees = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return employees.filter(
      (e) =>
        e.status === "active" &&
        (e.handle.toLowerCase().includes(q) ||
          e.name.toLowerCase().includes(q) ||
          (e.position && e.position.toLowerCase().includes(q))),
    );
  }, [mentionQuery, employees]);

  const showMenu = mentionQuery !== null && filteredEmployees.length > 0;

  const insertEmployeeMention = useCallback((employee: VirtualEmployee) => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const val = textarea.value;
    const cursor = textarea.selectionStart ?? val.length;
    const beforeCursor = val.slice(0, cursor);
    const afterCursor = val.slice(cursor);

    const atIndex = beforeCursor.lastIndexOf("@");
    if (atIndex !== -1) {
      const newBefore = beforeCursor.slice(0, atIndex) + `@${employee.handle} `;
      const nextVal = newBefore + afterCursor;

      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (setter) {
        setter.call(textarea, nextVal);
      } else {
        textarea.value = nextVal;
      }
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
      const nextPos = newBefore.length;
      textarea.setSelectionRange(nextPos, nextPos);
    }
    setMentionQuery(null);
  }, []);

  const handleInputOrSelection = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    const val = textarea.value;
    const cursor = textarea.selectionStart ?? val.length;
    const beforeCursor = val.slice(0, cursor);

    const match = beforeCursor.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setSelectedIndex(0);
    } else {
      setMentionQuery(null);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showMenu || filteredEmployees.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredEmployees.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) =>
            (prev - 1 + filteredEmployees.length) % filteredEmployees.length,
        );
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (!e.shiftKey) {
          e.preventDefault();
          const target = filteredEmployees[selectedIndex];
          if (target) {
            insertEmployeeMention(target);
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
      }
    },
    [showMenu, filteredEmployees, selectedIndex, insertEmployeeMention],
  );

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      {showMenu ? (
        <div
          className="absolute bottom-full left-0 mb-2 max-h-56 w-72 overflow-y-auto rounded-xl border border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-md z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
          data-testid="assistant-mention-popover"
        >
          <div className="mb-1 flex items-center justify-between border-b border-border/40 px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            <span>Empleados Virtuales</span>
            <span className="text-[10px] text-muted-foreground/60">
              ↑↓ • Enter
            </span>
          </div>
          {filteredEmployees.map((emp, idx) => {
            const Icon = getEmployeeAvatarIcon(emp.avatar);
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={emp.id}
                type="button"
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted/80",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertEmployeeMention(emp);
                }}
              >
                <div
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md",
                    isSelected
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  <Icon className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold">{emp.name}</span>
                    <span
                      className={cn(
                        "font-mono text-[10px]",
                        isSelected
                          ? "text-primary-foreground/80"
                          : "font-medium text-primary",
                      )}
                    >
                      @{emp.handle}
                    </span>
                  </div>
                  {emp.position ? (
                    <p
                      className={cn(
                        "truncate text-[10px]",
                        isSelected
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground",
                      )}
                    >
                      {emp.position}
                    </p>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      <ComposerPrimitive.Input
        ref={inputRef}
        onInput={handleInputOrSelection}
        onClick={handleInputOrSelection}
        onKeyDown={handleKeyDown}
        className="min-h-10 max-h-32 flex-1 resize-none bg-transparent px-3 py-2 text-sm font-normal leading-normal outline-none placeholder:text-muted-foreground/70"
        placeholder={
          isRunning
            ? t("The assistant is responding…")
            : (placeholder ?? t("Write a request or mention @employee…"))
        }
        aria-label={t("Message for the assistant")}
        rows={1}
      />
    </div>
  );
}

function ComposerActionButton() {
  const t = useMessages(uiMessages);
  const isRunning = useAuiState((s) => s.thread.isRunning);

  if (isRunning) {
    return (
      <ComposerPrimitive.Cancel asChild>
        <Button
          size="icon"
          type="button"
          variant="outline"
          aria-label={t("Stop response")}
          title={t("Stop response")}
          className="size-9 shrink-0 rounded-lg border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive active:scale-95"
        >
          <Square className="size-3.5 fill-current" />
        </Button>
      </ComposerPrimitive.Cancel>
    );
  }

  return (
    <ComposerPrimitive.Send asChild>
      <Button
        size="icon"
        type="submit"
        aria-label={t("Send message")}
        className="size-9 shrink-0 rounded-lg bg-primary text-primary-foreground transition-transform hover:bg-primary/90 active:scale-95 disabled:opacity-40"
      >
        <SendHorizontal className="size-4" />
      </Button>
    </ComposerPrimitive.Send>
  );
}

function ComposerFooterInfo() {
  const t = useMessages(uiMessages);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  return isRunning ? null : (
    <p className="mt-2 hidden px-1 text-right text-xs text-muted-foreground sm:block">
      {t("Enter to send • Shift + Enter for a new line")}
    </p>
  );
}

function ComposerSection({
  employees = [],
  models = [],
  summary,
  placeholder,
}: {
  employees: VirtualEmployee[];
  models: AssistantModel[];
  summary: AssistantConfigurationSummary | null;
  placeholder?: string;
}) {
  const t = useMessages(uiMessages);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const threadMessages = useAuiState((s) => s.thread.messages);

  let activeEmployee: VirtualEmployee | null = null;
  if (employees.length > 0 && Array.isArray(threadMessages)) {
    for (let i = threadMessages.length - 1; i >= 0; i--) {
      const item = threadMessages[i];
      if (item?.role === "user") {
        const text = extractUserText(item);
        const found = findMentionedEmployee(text, employees);
        if (found) {
          activeEmployee = found;
          break;
        }
      }
    }
  }

  const fallbackModelId =
    summary?.tenants?.[0]?.model ||
    summary?.global?.model ||
    summary?.deployment?.model ||
    "";
  const activeModelId = activeEmployee?.model || fallbackModelId;
  const resolvedModel = models.find((m) => m.id === activeModelId) ?? null;

  const canUpload = resolvedModel
    ? Boolean(resolvedModel.modalities?.image || resolvedModel.modalities?.file)
    : true;

  return (
    <div className="border-t border-border/60 bg-background/95 p-3.5 backdrop-blur-xs sm:p-4">
      <details className="mb-2 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-ring">
          {t("Assistant options")}
        </summary>
        <ComposerActiveContext
          activeEmployee={activeEmployee}
          model={resolvedModel}
          modelId={activeModelId}
        />
      </details>
      <ComposerPrimitive.Root className="relative flex flex-col gap-1.5 rounded-xl border border-input bg-card p-1.5 shadow-2xs transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring/30">
        <div className="flex flex-wrap gap-1 px-1 empty:hidden">
          <ComposerPrimitive.Attachments
            components={{
              Attachment: ComposerAttachment,
            }}
          />
        </div>
        <div className="flex items-end gap-1.5">
          <ComposerAttachmentButton
            canUpload={canUpload}
            activeModelName={resolvedModel?.name || activeModelId}
          />
          <VoiceDictationButton inputRef={composerInputRef} />
          <ComposerTextInput
            employees={employees}
            inputRef={composerInputRef}
            placeholder={placeholder}
          />
          <ComposerActionButton />
        </div>
      </ComposerPrimitive.Root>
      <ComposerFooterInfo />
    </div>
  );
}

export function AssistantConversation({
  threadId,
  initialMessages,
  onSaveThread,
  onOpenHistory,
  threadTitle,
  onRunningChange,
  recordingContext,
  disabled = false,
}: {
  threadId: string;
  initialMessages: StoredUIMessage[];
  onSaveThread: (
    threadId: string,
    messages: StoredUIMessage[],
  ) => Promise<void>;
  onOpenHistory: () => void;
  threadTitle?: string;
  onRunningChange?: (isRunning: boolean) => void;
  recordingContext?: RecordingContext;
  disabled?: boolean;
}) {
  const t = useMessages(uiMessages);
  const syncText = useMessages(assistantSyncMessages);
  const saveRef = useRef(onSaveThread);
  saveRef.current = onSaveThread;
  const { authSession, assistantConfiguration, virtualEmployees } =
    useAppServices();
  const [employees, setEmployees] = useState<VirtualEmployee[]>([]);
  const [models, setModels] = useState<AssistantModel[]>([]);
  const [summary, setSummary] = useState<AssistantConfigurationSummary | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    if (assistantConfiguration) {
      if (typeof assistantConfiguration.models === "function") {
        assistantConfiguration
          .models()
          .then((m) => {
            if (active) setModels(m);
          })
          .catch(() => {});
      }
      if (typeof assistantConfiguration.summary === "function") {
        assistantConfiguration
          .summary()
          .then((s) => {
            if (active) setSummary(s);
          })
          .catch(() => {});
      }
    }
    return () => {
      active = false;
    };
  }, [assistantConfiguration]);

  useEffect(() => {
    let active = true;
    if (virtualEmployees && typeof virtualEmployees.list === "function") {
      virtualEmployees
        .list()
        .then((data) => {
          if (active) {
            setEmployees(data.filter((e) => e.status === "active"));
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [virtualEmployees]);

  const apiUrl = import.meta.env.VITE_SAVIA_API_URL ?? window.location.origin;
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: assistantApiUrl(apiUrl),
        credentials: "include",
        body: { threadId },
        fetch: async (input, init) => {
          const body = JSON.parse(String(init?.body ?? "{}"));
          if (Array.isArray(body.messages)) {
            await saveRef.current(threadId, body.messages);
          }
          return fetch(input, init);
        },
        headers: async (): Promise<Headers> => {
          const accessToken = await authSession.getAccessToken();
          const headers = new Headers();
          if (accessToken) {
            headers.set("Authorization", `Bearer ${accessToken}`);
          }
          return headers;
        },
      }),
    [apiUrl, authSession, threadId],
  );
  const runtime = useChatRuntime({
    transport,
    messages: initialMessages as any,
    onFinish: ({ messages }) => {
      void saveRef
        .current(threadId, messages as unknown as StoredUIMessage[])
        .catch(() => {});
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RuntimeStatusSync onStatusChange={onRunningChange} />
      <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
        {recordingContext ? (
          <div className="border-b px-4 py-3 text-sm">
            <p className="text-xs text-muted-foreground">
              {syncText("Recording context")}
            </p>
            <p className="mt-1 break-words font-medium">
              {recordingContext.title}
            </p>
          </div>
        ) : (
          <ActiveTenantSelector client={assistantConfiguration} />
        )}
        <ThreadPrimitive.Viewport
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5"
          autoScroll
        >
          <ThreadPrimitive.Empty>
            {recordingContext ? (
              <div className="my-auto py-8">
                <h3 className="text-base font-medium">
                  {syncText("Chat about these notes")}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {syncText(
                    "Ask about decisions, tasks, or details in this recording.",
                  )}
                </p>
                <div className="mt-6 flex flex-col items-start gap-2">
                  {(
                    [
                      "Summarize the decisions",
                      "What tasks are still pending?",
                    ] as const
                  ).map((prompt) => (
                    <ThreadPrimitive.Suggestion
                      key={prompt}
                      prompt={syncText(prompt)}
                      send={false}
                      asChild
                    >
                      <Button
                        variant="outline"
                        className="h-auto min-h-11 whitespace-normal text-left"
                        disabled={disabled}
                      >
                        {syncText(prompt)}
                      </Button>
                    </ThreadPrimitive.Suggestion>
                  ))}
                </div>
              </div>
            ) : (
              <div className="my-auto flex flex-1 flex-col items-center justify-center p-4 text-center">
                <div className="relative mb-3 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 via-primary/10 to-transparent p-0.5 shadow-inner">
                  <div className="flex size-full items-center justify-center rounded-[14px] border border-primary/20 bg-card">
                    <Sparkles className="size-5 text-primary" />
                  </div>
                </div>
                <h3 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
                  {t("How can I help today?")}
                </h3>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  {t(
                    "Browse collections, search for customers, analyze metrics, and create interactive charts from your Studio data.",
                  )}
                </p>

                {employees.length > 0 ? (
                  <div className="mt-4 w-full max-w-sm space-y-2">
                    <p className="px-1 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                      {t("Virtual employees (@mention)")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {employees.map((emp) => {
                        const Icon = getEmployeeAvatarIcon(emp.avatar);
                        return (
                          <ThreadPrimitive.Suggestion
                            key={emp.id}
                            prompt={`@${emp.handle} `}
                            send={false}
                            asChild
                          >
                            <button
                              type="button"
                              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary/20 bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-all hover:border-primary/40 hover:bg-muted/60"
                              title={emp.position ?? emp.name}
                            >
                              <Icon className="size-3 text-primary shrink-0" />
                              <span>{emp.name}</span>
                              <span className="font-mono text-[10px] font-medium text-primary">
                                @{emp.handle}
                              </span>
                            </button>
                          </ThreadPrimitive.Suggestion>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 w-full max-w-sm space-y-2">
                  <p className="px-1 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    {t("Suggested queries")}
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {quickPrompts.map((item) => (
                      <ThreadPrimitive.Suggestion
                        key={item.label}
                        prompt={t(item.prompt as keyof typeof uiMessages)}
                        send
                        asChild
                      >
                        <button
                          type="button"
                          className="group flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-border/60 bg-card/60 px-3.5 py-2.5 text-left text-xs font-medium text-foreground shadow-2xs transition-all hover:border-primary/40 hover:bg-muted/50"
                        >
                          <item.icon className="size-4 shrink-0 text-primary/70 transition-colors group-hover:text-primary" />
                          <span className="flex-1 truncate">
                            {t(item.label as keyof typeof uiMessages)}
                          </span>
                        </button>
                      </ThreadPrimitive.Suggestion>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages>
            {({ message }) => (
              <ChatMessage
                isUser={message.role === "user"}
                message={message}
                employees={employees}
              />
            )}
          </ThreadPrimitive.Messages>

          <AssistantRunningIndicator employees={employees} />
        </ThreadPrimitive.Viewport>
        <fieldset disabled={disabled} className="min-w-0" aria-busy={disabled}>
          <ComposerSection
            employees={employees}
            models={models}
            summary={summary}
            placeholder={
              recordingContext ? syncText("Ask about these notes…") : undefined
            }
          />
        </fieldset>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export function AssistantBar() {
  const t = useMessages(uiMessages);
  const txExternal = useMessages(assistantExternalMessages);
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"chat" | "history">("chat");
  const externalProvider = useSyncExternalStore(
    subscribePluginAssistantProvider,
    getPluginAssistantProvider,
    () => null,
  );
  const history = useAssistantThreads(open);
  const { threads, activeThread } = history;
  const activeThreadId = activeThread?.id ?? null;
  const [isAssistantBusy, setIsAssistantBusy] = useState(false);
  const handleRunning = useCallback(
    (busy: boolean) => {
      setIsAssistantBusy(busy);
      history.setRunning(busy);
    },
    [history.setRunning],
  );
  const handleOpenHistory = () => {
    void history.refresh();
    setViewMode("history");
  };
  const handleSelectThread = (id: string) => {
    history.select(id);
    setViewMode("chat");
  };
  const handleNewThread = () => {
    void history.create();
    setViewMode("chat");
  };
  const handleDeleteThread = (id: string) => {
    void history.remove(id);
  };
  useEffect(() => {
    if (externalProvider) {
      setViewMode("chat");
      setOpen(true);
    }
  }, [externalProvider]);
  const returnToGeneralAssistant = () => externalProvider?.close();

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) externalProvider?.close();
        setOpen(next);
      }}
    >
      <SheetTrigger asChild>
        <Button
          className="size-11 shrink-0 gap-2.5 rounded-full border border-primary/20 bg-primary p-0 font-medium text-primary-foreground transition-all hover:bg-primary/90 sm:fixed sm:right-6 sm:bottom-6 sm:z-40 sm:h-12 sm:w-auto sm:px-4.5 sm:shadow-xl sm:hover:scale-[1.02] sm:active:scale-[0.98]"
          aria-label={t("Abrir asistente")}
        >
          <Sparkles className="size-4" />
          <span className="hidden sm:inline">{t("Asistente")}</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border/60 bg-card/60 px-4 py-3 backdrop-blur-xs">
          <div className="flex items-center justify-between gap-2 pr-8">
            {externalProvider ? (
              <div>
                <SheetTitle className="text-sm font-semibold tracking-tight text-foreground">
                  {externalProvider.title}
                </SheetTitle>
                <p className="text-[11px] text-muted-foreground">
                  {txExternal("Connected assistant")}
                </p>
              </div>
            ) : viewMode === "history" ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                  onClick={() => setViewMode("chat")}
                  aria-label={t("Back to chat")}
                >
                  <ArrowLeft className="size-4" />
                </Button>
                <div>
                  <SheetTitle className="text-sm font-semibold tracking-tight text-foreground">
                    {t("History")}
                  </SheetTitle>
                  <p className="text-[11px] text-muted-foreground">
                    {t("Previous conversations")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-2xs">
                  <Sparkles className="size-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <SheetTitle className="text-sm font-semibold tracking-tight text-foreground">
                      {t("Savia assistant")}
                    </SheetTitle>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {t("Answers to help you decide and act")}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-1">
              {!externalProvider && viewMode === "chat" ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenHistory}
                    disabled={isAssistantBusy || history.saving}
                    className="relative h-8 gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/70"
                    aria-label={t("Show history")}
                    title={t("Conversation history")}
                  >
                    <History className="size-3.5" />
                    <span className="hidden sm:inline">{t("History")}</span>
                    {threads.length > 0 ? (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold text-primary">
                        {threads.length}
                      </span>
                    ) : null}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleNewThread}
                    disabled={isAssistantBusy || history.saving}
                    className="size-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/70"
                    aria-label={t("New conversation")}
                    title={t("New conversation")}
                  >
                    <SquarePen className="size-4" />
                  </Button>
                </>
              ) : !externalProvider ? (
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleNewThread}
                  disabled={isAssistantBusy || history.saving}
                  className="h-8 gap-1.5 rounded-lg text-xs font-medium"
                >
                  <Plus className="size-3.5" />
                  <span>{t("New")}</span>
                </Button>
              ) : null}
            </div>
          </div>
        </SheetHeader>

        {!externalProvider && <AssistantSyncStatus history={history} />}
        {externalProvider ? (
          <ExternalAssistantConversation
            key={externalProvider.sessionId}
            provider={externalProvider}
            onReturn={returnToGeneralAssistant}
          />
        ) : null}
        {viewMode === "chat" && activeThread ? (
          <div
            className={cn(
              "min-h-0 flex-1 flex-col",
              externalProvider ? "hidden" : "flex",
            )}
            hidden={Boolean(externalProvider)}
            aria-hidden={externalProvider ? true : undefined}
            inert={Boolean(externalProvider)}
          >
            <AssistantConversation
              key={`${activeThreadId}:${history.epoch}`}
              threadId={activeThreadId ?? "fresh"}
              initialMessages={activeThread?.messages ?? []}
              onSaveThread={history.save}
              onOpenHistory={handleOpenHistory}
              threadTitle={activeThread?.title}
              onRunningChange={handleRunning}
              recordingContext={activeThread.context}
              disabled={Boolean(history.error)}
            />
          </div>
        ) : history.loading ? null : viewMode === "history" ? (
          <AssistantThreadList
            threads={threads}
            activeThreadId={activeThreadId}
            onSelectThread={handleSelectThread}
            onNewThread={handleNewThread}
            onDeleteThread={handleDeleteThread}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
