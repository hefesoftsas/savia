import {
  AssistantQuoteResult,
  parseQuoteResult,
  quoteFieldLabels,
  formatQuoteField,
} from "./assistant-quote-result";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ActiveAgencySelector } from "./active-agency-selector";
import {
  AssistantMarkdown,
  AssistantPresentationCard,
  presentationFrom,
} from "./assistant-response-ui";
import {
  createNewThread,
  deleteStoredThread,
  generateThreadTitle,
  loadActiveThreadId,
  loadStoredThreads,
  saveActiveThreadId,
  saveStoredThread,
  type AssistantThreadRecord,
  type StoredUIMessage,
} from "./assistant-thread-storage";
import { AssistantThreadList } from "./assistant-thread-list";

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

  const isCrm =
    action.domain === "crm" ||
    action.command.includes("record") ||
    action.command.includes("create") ||
    action.command.includes("update") ||
    action.command.includes("delete");

  const crmCollection = String(
    action.input.collection ??
      action.input.object ??
      (action.domain !== "crm" ? action.domain : ""),
  ).trim();

  let actionTitle = isQuote
    ? "consultar las aseguradoras habilitadas"
    : `${action.domain}.${action.command}`;
  if (isCrm && crmCollection) {
    const cmd = action.command.toLowerCase();
    if (cmd.includes("create")) {
      actionTitle = `Crear registro en "${crmCollection}"`;
    } else if (cmd.includes("update") || cmd.includes("edit")) {
      actionTitle = `Actualizar registro en "${crmCollection}"`;
    } else if (cmd.includes("delete") || cmd.includes("remove")) {
      actionTitle = `Eliminar registro en "${crmCollection}"`;
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
                  {isQuote ? formatQuoteField(value,name) : inputValue(value, name)}
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
  savia_list_crm_collections: {
    inProgress: "Explorando colecciones del CRM…",
    done: "Colecciones del CRM consultadas",
  },
  savia_list_crm_records: {
    inProgress: "Consultando registros del CRM…",
    done: "Registros del CRM obtenidos",
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
          {respondingEmployee ? respondingEmployee.name : "Asistente Savia"}
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
            <span>La respuesta se interrumpió. Intenta de nuevo.</span>
          </div>
        </MessagePrimitive.Error>
      </MessagePrimitive.Root>
    </div>
  );
}

const quickPrompts = [
  {
    icon: Users,
    label: "¿Cuántos clientes tenemos por ciudad?",
    prompt:
      "¿Cuántos clientes tenemos por ciudad? Muéstramelo en un gráfico de barras.",
  },
  {
    icon: Database,
    label: "¿Qué colecciones hay en el CRM?",
    prompt:
      "¿Qué colecciones de datos tenemos disponibles en el CRM y cuántos registros hay?",
  },
  {
    icon: BarChart3,
    label: "Cotizaciones agrupadas por estado",
    prompt:
      "Genera un informe con las cotizaciones agrupadas por su estado en un gráfico y tabla.",
  },
  {
    icon: FileSpreadsheet,
    label: "Clientes activos con correo y ciudad",
    prompt:
      "Muestra la lista de clientes activos indicando su correo, teléfono y ciudad.",
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
      toast.error("El dictado por voz no es compatible con este navegador.");
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
            aria-label="Dictado por voz (no compatible con este navegador)"
            className="size-9 shrink-0 rounded-lg text-muted-foreground/30 cursor-not-allowed"
          >
            <Mic className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">
            Tu navegador no soporta dictado por voz (usa Chrome, Edge o Safari)
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
          aria-label={
            isListening ? "Detener dictado por voz" : "Dictar por voz"
          }
          title={isListening ? "Detener dictado por voz" : "Dictar por voz"}
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
          {isListening
            ? "Escuchando... Haz clic para detener"
            : "Dictado por voz"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {isListening
            ? "Transcribiendo en tiempo real"
            : "Habla para escribir tu mensaje"}
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
            aria-label="Adjuntar archivo (no disponible para el modelo actual)"
            className="size-9 shrink-0 rounded-lg text-muted-foreground/30 cursor-not-allowed opacity-50"
          >
            <Paperclip className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p className="font-semibold text-amber-600 dark:text-amber-400">
            Adjuntos no soportados
          </p>
          <p className="text-muted-foreground">
            El modelo actual ({activeModelName || "texto plano"}) no admite
            visión ni archivos. Menciona a un empleado o selecciona un modelo
            multimodal con visión para adjuntar archivos.
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
            aria-label="Adjuntar archivo o imagen"
            title="Adjuntar archivo o imagen"
            className="size-9 shrink-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95"
          >
            <Paperclip className="size-4" />
          </Button>
        </ComposerPrimitive.AddAttachment>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="font-semibold text-xs">Adjuntar archivo o imagen</p>
        <p className="text-[11px] text-muted-foreground">
          Soporta imágenes, documentos y archivos de datos
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
}: {
  employees?: VirtualEmployee[];
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
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
            ? "El asistente está respondiendo…"
            : "Escribe una solicitud o menciona a @empleado…"
        }
        aria-label="Mensaje para el asistente"
        rows={1}
      />
    </div>
  );
}

function ComposerActionButton() {
  const isRunning = useAuiState((s) => s.thread.isRunning);

  if (isRunning) {
    return (
      <ComposerPrimitive.Cancel asChild>
        <Button
          size="icon"
          type="button"
          variant="outline"
          aria-label="Detener respuesta"
          title="Detener respuesta"
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
        aria-label="Enviar mensaje"
        className="size-9 shrink-0 rounded-lg bg-primary text-primary-foreground transition-transform hover:bg-primary/90 active:scale-95 disabled:opacity-40"
      >
        <SendHorizontal className="size-4" />
      </Button>
    </ComposerPrimitive.Send>
  );
}

function ComposerFooterInfo() {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  return isRunning ? null : (
    <p className="mt-2 hidden px-1 text-right text-xs text-muted-foreground sm:block">
      Enter para enviar • Shift + Enter para salto de línea
    </p>
  );
}

function ComposerSection({
  employees = [],
  models = [],
  summary,
}: {
  employees: VirtualEmployee[];
  models: AssistantModel[];
  summary: AssistantConfigurationSummary | null;
}) {
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
    summary?.agencies?.[0]?.model ||
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
          Opciones del asistente
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
          />
          <ComposerActionButton />
        </div>
      </ComposerPrimitive.Root>
      <ComposerFooterInfo />
    </div>
  );
}

function AssistantConversation({
  threadId,
  initialMessages,
  onSaveThread,
  onOpenHistory,
  threadTitle,
  onRunningChange,
}: {
  threadId: string;
  initialMessages: StoredUIMessage[];
  onSaveThread: (threadId: string, messages: StoredUIMessage[]) => void;
  onOpenHistory: () => void;
  threadTitle?: string;
  onRunningChange?: (isRunning: boolean) => void;
}) {
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
        headers: async (): Promise<Headers> => {
          const accessToken = await authSession.getAccessToken();
          const headers = new Headers();
          if (accessToken) {
            headers.set("Authorization", `Bearer ${accessToken}`);
          }
          return headers;
        },
      }),
    [apiUrl, authSession],
  );
  const runtime = useChatRuntime({
    transport,
    messages: initialMessages as any,
    onFinish: ({ messages }) => {
      onSaveThread(threadId, messages as unknown as StoredUIMessage[]);
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RuntimeStatusSync onStatusChange={onRunningChange} />
      <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
        <ActiveAgencySelector client={assistantConfiguration} />
        <ThreadPrimitive.Viewport
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5"
          autoScroll
        >
          <ThreadPrimitive.Empty>
            <div className="my-auto flex flex-1 flex-col items-center justify-center p-4 text-center">
              <div className="relative mb-3 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 via-primary/10 to-transparent p-0.5 shadow-inner">
                <div className="flex size-full items-center justify-center rounded-[14px] border border-primary/20 bg-card">
                  <Sparkles className="size-5 text-primary" />
                </div>
              </div>
              <h3 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
                ¿En qué puedo ayudarte hoy?
              </h3>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                Consulta colecciones, busca clientes, analiza métricas y genera
                gráficos interactivos sobre tus datos del CRM.
              </p>

              {employees.length > 0 ? (
                <div className="mt-4 w-full max-w-sm space-y-2">
                  <p className="px-1 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    Empleados Virtuales (@mención)
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
                  Consultas sugeridas
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {quickPrompts.map((item) => (
                    <ThreadPrimitive.Suggestion
                      key={item.label}
                      prompt={item.prompt}
                      send
                      asChild
                    >
                      <button
                        type="button"
                        className="group flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-border/60 bg-card/60 px-3.5 py-2.5 text-left text-xs font-medium text-foreground shadow-2xs transition-all hover:border-primary/40 hover:bg-muted/50"
                      >
                        <item.icon className="size-4 shrink-0 text-primary/70 transition-colors group-hover:text-primary" />
                        <span className="flex-1 truncate">{item.label}</span>
                      </button>
                    </ThreadPrimitive.Suggestion>
                  ))}
                </div>
              </div>
            </div>
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
        <ComposerSection
          employees={employees}
          models={models}
          summary={summary}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export function AssistantBar() {
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"chat" | "history">("chat");
  const { authProvider } = useAppServices();
  const [userId, setUserId] = useState<string>("default");
  const [threads, setThreads] = useState<AssistantThreadRecord[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isAssistantBusy, setIsAssistantBusy] = useState(false);

  useEffect(() => {
    setIsAssistantBusy(false);
  }, [activeThreadId, viewMode]);

  useEffect(() => {
    let active = true;
    authProvider
      .getIdentity?.()
      .then((identity) => {
        if (active && identity?.id) {
          setUserId(String(identity.id));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [authProvider]);

  useEffect(() => {
    const loaded = loadStoredThreads(userId);
    setThreads(loaded);

    const savedActiveId = loadActiveThreadId(userId);
    if (savedActiveId && loaded.some((t) => t.id === savedActiveId)) {
      setActiveThreadId(savedActiveId);
    } else if (loaded.length > 0) {
      setActiveThreadId(loaded[0].id);
      saveActiveThreadId(loaded[0].id, userId);
    } else {
      const fresh = createNewThread(userId);
      saveStoredThread(fresh, userId);
      setThreads([fresh]);
      setActiveThreadId(fresh.id);
      saveActiveThreadId(fresh.id, userId);
    }
  }, [userId, open]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  const handleOpenHistory = useCallback(() => {
    setThreads(loadStoredThreads(userId));
    setViewMode("history");
  }, [userId]);

  const handleSelectThread = (threadId: string) => {
    setActiveThreadId(threadId);
    saveActiveThreadId(threadId, userId);
    setViewMode("chat");
  };

  const handleNewThread = () => {
    const fresh = createNewThread(userId);
    saveStoredThread(fresh, userId);
    setThreads((prev) => [fresh, ...prev.filter((t) => t.id !== fresh.id)]);
    setActiveThreadId(fresh.id);
    saveActiveThreadId(fresh.id, userId);
    setViewMode("chat");
  };

  const handleDeleteThread = (threadId: string) => {
    deleteStoredThread(threadId, userId);
    const remaining = loadStoredThreads(userId);
    setThreads(remaining);

    if (activeThreadId === threadId) {
      if (remaining.length > 0) {
        setActiveThreadId(remaining[0].id);
        saveActiveThreadId(remaining[0].id, userId);
      } else {
        const fresh = createNewThread(userId);
        saveStoredThread(fresh, userId);
        setThreads([fresh]);
        setActiveThreadId(fresh.id);
        saveActiveThreadId(fresh.id, userId);
      }
    }
  };

  const handleSaveThread = useCallback(
    (threadId: string, messages: StoredUIMessage[]) => {
      if (!messages || messages.length === 0) return;
      const current = loadStoredThreads(userId);
      const target = current.find((t) => t.id === threadId) ?? {
        id: threadId,
        userId,
        title: "Nueva conversación",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };

      const updated: AssistantThreadRecord = {
        ...target,
        messages,
        updatedAt: new Date().toISOString(),
        title:
          target.title === "Nueva conversación"
            ? generateThreadTitle(messages)
            : target.title,
      };

      saveStoredThread(updated, userId);
      setTimeout(() => {
        setThreads(loadStoredThreads(userId));
      }, 50);
    },
    [userId],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          className="fixed right-4 bottom-4 z-40 h-12 gap-2.5 rounded-full border border-primary/20 bg-primary px-4.5 font-medium text-primary-foreground shadow-xl transition-all hover:scale-[1.02] hover:bg-primary/90 active:scale-[0.98] sm:right-6 sm:bottom-6"
          aria-label="Abrir asistente"
        >
          <Sparkles className="size-4" />
          <span>Asistente</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border/60 bg-card/60 px-4 py-3 backdrop-blur-xs">
          <div className="flex items-center justify-between gap-2 pr-8">
            {viewMode === "history" ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                  onClick={() => setViewMode("chat")}
                  aria-label="Volver al chat"
                >
                  <ArrowLeft className="size-4" />
                </Button>
                <div>
                  <SheetTitle className="text-sm font-semibold tracking-tight text-foreground">
                    Historial
                  </SheetTitle>
                  <p className="text-[11px] text-muted-foreground">
                    Tus conversaciones anteriores
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
                      Asistente Savia
                    </SheetTitle>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Respuestas para decidir y actuar
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-1">
              {viewMode === "chat" ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenHistory}
                    className="relative h-8 gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/70"
                    aria-label="Ver historial"
                    title="Ver historial de conversaciones"
                  >
                    <History className="size-3.5" />
                    <span className="hidden sm:inline">Historial</span>
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
                    className="size-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/70"
                    aria-label="Nueva conversación"
                    title="Nueva conversación"
                  >
                    <SquarePen className="size-4" />
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleNewThread}
                  className="h-8 gap-1.5 rounded-lg text-xs font-medium"
                >
                  <Plus className="size-3.5" />
                  <span>Nueva</span>
                </Button>
              )}
            </div>
          </div>
        </SheetHeader>

        {viewMode === "history" ? (
          <AssistantThreadList
            threads={threads}
            activeThreadId={activeThreadId}
            onSelectThread={handleSelectThread}
            onNewThread={handleNewThread}
            onDeleteThread={handleDeleteThread}
          />
        ) : (
          <AssistantConversation
            key={activeThreadId ?? "fresh"}
            threadId={activeThreadId ?? "fresh"}
            initialMessages={activeThread?.messages ?? []}
            onSaveThread={handleSaveThread}
            onOpenHistory={handleOpenHistory}
            threadTitle={activeThread?.title}
            onRunningChange={setIsAssistantBusy}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
