import { useLayoutEffect, useRef, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { officeEditorUrl } from "@/features/office/office-api";
import { useMessages, type MessageCatalog } from "@/i18n/core";
import { useOfficeAvailability } from "@/features/office-settings/office-availability";
import {
  safeSourceUrl,
  type PluginAssistantProvider,
} from "@savia/studio-shared/plugin-assistant";
import { OFFICE_MAX_SIZE } from "@savia/studio-shared/office";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const messages = {
  "Could not generate or save the document.": [
    "No se pudo generar o guardar el documento.",
    "Could not generate or save the document.",
    "Não foi possível gerar ou salvar o documento.",
  ],
  "Preparing the document…": [
    "Preparando el documento…",
    "Preparing the document…",
    "Preparando o documento…",
  ],
  "Saving to Office suite…": [
    "Guardando en la suite de ofimática…",
    "Saving to Office suite…",
    "Salvando na suíte de escritório…",
  ],
  "Saved in Office suite.": [
    "Guardado en la suite de ofimática.",
    "Saved in Office suite.",
    "Salvo na suíte de escritório.",
  ],
  "Open document": ["Abrir documento", "Open document", "Abrir documento"],
  Retry: ["Reintentar", "Retry", "Tentar novamente"],
} satisfies MessageCatalog;

export type AssistantDocumentActionDefinition = {
  id: string;
  label: string;
  format: "docx";
  fileName?: string;
};

export function isAssistantDocumentAction(
  value: unknown,
): value is AssistantDocumentActionDefinition {
  if (!value || typeof value !== "object") return false;
  const action = value as Record<string, unknown>;
  return (
    typeof action.id === "string" &&
    action.id.length > 0 &&
    action.id.length <= 256 &&
    typeof action.label === "string" &&
    action.label.trim().length > 0 &&
    action.label.length <= 200 &&
    action.format === "docx" &&
    (action.fileName === undefined ||
      (typeof action.fileName === "string" &&
        action.fileName.length <= 200 &&
        /^[^\\/]+\.docx$/.test(action.fileName)))
  );
}

function contextKey(provider: PluginAssistantProvider) {
  return JSON.stringify([
    provider.sessionId,
    provider.connectionId ?? "",
    provider.actionId,
    provider.context,
  ]);
}

export function savedDocumentName(title: string, fileName: string) {
  const safePart = (value: string) =>
    value
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
      .replace(/[ ._-]+$/g, "")
      .slice(0, 128);
  const safeTitle = safePart(title).slice(0, 50) || "proposal";
  const basename =
    fileName
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.docx$/i, "") ?? "";
  const safeName = safePart(basename).slice(0, 128) || "proposal";
  return `${safeTitle}-${safeName}.docx`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export async function documentSourceKey(
  provider: PluginAssistantProvider,
  actionId: string,
) {
  const input = canonical([
    provider.connectionId ?? "",
    provider.actionId,
    actionId,
    provider.context,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return `assistant:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function readBoundedDocument(response: Response, signal: AbortSignal) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > OFFICE_MAX_SIZE) {
    await response.body?.cancel();
    throw new Error("Document exceeds the upload limit");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > OFFICE_MAX_SIZE)
      throw new Error("Document exceeds the upload limit");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > OFFICE_MAX_SIZE) {
        await reader.cancel();
        throw new Error("Document exceeds the upload limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function AssistantDocumentAction({
  provider,
  action,
  apiClient,
  disabled = false,
}: {
  provider: PluginAssistantProvider;
  action: AssistantDocumentActionDefinition;
  apiClient: Pick<ApiClient, "postForm" | "get" | "post">;
  disabled?: boolean;
}) {
  const t = useMessages(messages);
  const {
    enabled: officeEnabled,
    loading: officeLoading,
    error: officeError,
  } = useOfficeAvailability();
  const officeAvailable = officeEnabled && !officeLoading && !officeError;
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"prepare" | "save">("prepare");
  const [error, setError] = useState(false);
  const [savedHref, setSavedHref] = useState<string | null>(null);
  const attempt = useRef(0);
  const activePopup = useRef<Window | null>(null);
  const controller = useRef<AbortController | null>(null);
  const running = useRef(false);
  const key = contextKey(provider);

  useLayoutEffect(() => {
    attempt.current += 1;
    controller.current?.abort();
    controller.current = null;
    running.current = false;
    setBusy(false);
    setError(false);
    setSavedHref(null);
    activePopup.current?.close();
    activePopup.current = null;
    return () => {
      attempt.current += 1;
      controller.current?.abort();
      controller.current = null;
      running.current = false;
      activePopup.current?.close();
      activePopup.current = null;
    };
  }, [key, action.id, officeAvailable]);

  async function generate() {
    if (!officeAvailable || running.current || disabled) return;
    running.current = true;
    const currentAttempt = ++attempt.current;
    const abortController = new AbortController();
    controller.current = abortController;
    const { signal } = abortController;

    // Reserve a tab while the click gesture is active. If blocked, generation
    // still proceeds and the saved link remains available in this surface.
    const popup = window.open("about:blank", "_blank");
    if (popup) {
      popup.opener = null;
      try {
        const referrer = popup.document.createElement("meta");
        referrer.name = "referrer";
        referrer.content = "no-referrer";
        popup.document.head.append(referrer);
      } catch {
        // The initial blank page has no referrer; the meta covers its navigation.
      }
      activePopup.current = popup;
    }
    setBusy(true);
    setStage("prepare");
    setError(false);
    setSavedHref(null);

    const isCurrent = () =>
      currentAttempt === attempt.current && !signal.aborted;
    try {
      const sourceKey = await documentSourceKey(provider, action.id);
      if (!isCurrent()) return;
      type Saved = {
        id: string;
        name?: string;
        role?: string;
        updatedAt?: string;
      };
      let existing = (
        await apiClient.get<{ data: Saved | null }>(
          `/v1/office-documents/source?key=${encodeURIComponent(sourceKey)}`,
          { signal },
        )
      ).data;
      if (!isCurrent()) return;
      // Adopt a pre-binding draft only by its complete legacy filename and
      // current ownership. The server checks ownership again and never rebinds.
      if (!existing && action.fileName) {
        const expectedName = savedDocumentName(provider.title, action.fileName);
        const candidates = (
          await apiClient.get<{ data: Saved[] }>("/v1/office-documents", {
            signal,
          })
        ).data
          .filter((item) => item.role === "owner" && item.name === expectedName)
          .sort(
            (a, b) =>
              (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
              b.id.localeCompare(a.id),
          );
        if (!isCurrent()) return;
        if (candidates[0])
          existing = (
            await apiClient.post<{ data: Saved }>(
              `/v1/office-documents/${encodeURIComponent(candidates[0].id)}/source`,
              { key: sourceKey },
              { signal },
            )
          ).data;
      }
      if (!isCurrent()) return;
      if (existing) {
        const href = officeEditorUrl("/v1/office-documents", existing.id);
        if (!href) throw new Error("Invalid saved document id");
        setSavedHref(href);
        popup?.location.replace(href);
        if (activePopup.current === popup) activePopup.current = null;
        return;
      }
      const response = await provider.invoke({
        method: "generate-document",
        actionId: action.id,
      });
      if (!isCurrent()) return;
      const document = response.document;
      if (
        !document ||
        document.format !== "docx" ||
        typeof document.fileName !== "string" ||
        !document.fileName.trim() ||
        !safeSourceUrl(document.url)
      )
        throw new Error("Invalid document response");

      const fetchSignal = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
      const source = await fetch(document.url, {
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: fetchSignal,
      });
      if (!source.ok) throw new Error("Could not fetch generated document");
      const bytes = await readBoundedDocument(source, fetchSignal);
      if (!isCurrent()) return;

      setStage("save");
      const form = new FormData();
      form.set("sourceKey", sourceKey);
      form.set(
        "file",
        new File(
          [bytes],
          savedDocumentName(provider.title, document.fileName),
          {
            type: DOCX_MIME,
          },
        ),
      );
      const result = await apiClient.postForm<{ data?: { id?: unknown } }>(
        "/v1/office-documents",
        form,
        { signal },
      );
      if (!isCurrent()) return;
      const id = result?.data?.id;
      if (typeof id !== "string") throw new Error("Invalid saved document");
      const href = officeEditorUrl("/v1/office-documents", id);
      if (!href) throw new Error("Invalid saved document id");
      setSavedHref(href);
      if (popup) {
        popup.location.replace(href);
        if (activePopup.current === popup) activePopup.current = null;
      }
    } catch {
      popup?.close();
      if (activePopup.current === popup) activePopup.current = null;
      if (isCurrent()) setError(true);
    } finally {
      if (isCurrent()) {
        setBusy(false);
        running.current = false;
        controller.current = null;
      }
    }
  }

  if (!officeAvailable) return null;

  return (
    <div className="min-w-0 max-w-full">
      <Tooltip>
        <TooltipTrigger asChild>
          {savedHref && !busy ? (
            <a
              href={savedHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("Open document")}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FileText className="size-4" aria-hidden="true" />
            </a>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              disabled={disabled || busy}
              aria-label={action.label}
              aria-busy={busy}
              onClick={() => void generate()}
            >
              {busy ? (
                <LoaderCircle
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <FileText className="size-4" aria-hidden="true" />
              )}
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent side="top">
          {savedHref ? t("Open document") : action.label}
        </TooltipContent>
      </Tooltip>
      {busy && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {t(
            stage === "prepare"
              ? "Preparing the document…"
              : "Saving to Office suite…",
          )}
        </p>
      )}
      {savedHref && !busy && (
        <span role="status" className="sr-only">
          {t("Saved in Office suite.")}
        </span>
      )}
      {error && (
        <div className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-destructive">
          <p role="alert">{t("Could not generate or save the document.")}</p>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto min-h-8 px-1 text-xs"
            disabled={disabled || busy}
            onClick={() => void generate()}
          >
            {t("Retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
