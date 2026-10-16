import { useLayoutEffect, useRef, useState } from "react";
import { Download, FileText, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages, type MessageCatalog } from "@/i18n/core";
import {
  safeSourceUrl,
  type PluginAssistantProvider,
} from "@savia/studio-shared/plugin-assistant";

const messages = {
  "Download started.": [
    "La descarga comenzó.",
    "Download started.",
    "O download começou.",
  ],
  "Could not generate the document.": [
    "No se pudo generar el documento.",
    "Could not generate the document.",
    "Não foi possível gerar o documento.",
  ],
  "Allow pop-ups and try again.": [
    "Permite ventanas emergentes para iniciar la descarga.",
    "Allow pop-ups to start the download.",
    "Permita pop-ups para iniciar o download.",
  ],
  Retry: ["Reintentar", "Retry", "Tentar novamente"],
  "Preparing the download…": [
    "Preparando la descarga…",
    "Preparing the download…",
    "Preparando o download…",
  ],
} satisfies MessageCatalog;

export type AssistantDocumentActionDefinition = {
  id: string;
  label: string;
  format: "docx";
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
    action.format === "docx"
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

export function AssistantDocumentAction({
  provider,
  action,
  disabled = false,
}: {
  provider: PluginAssistantProvider;
  action: AssistantDocumentActionDefinition;
  disabled?: boolean;
}) {
  const t = useMessages(messages);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<
    "success" | "error" | "popup-blocked" | null
  >(null);
  const attempt = useRef(0);
  const activePopup = useRef<Window | null>(null);
  const key = contextKey(provider);

  useLayoutEffect(() => {
    attempt.current += 1;
    setBusy(false);
    setFeedback(null);
    return () => {
      attempt.current += 1;
      activePopup.current?.close();
      activePopup.current = null;
    };
  }, [key, action.id]);

  async function generate() {
    if (busy || disabled) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setFeedback("popup-blocked");
      return;
    }
    popup.opener = null;
    try {
      const meta = popup.document.createElement("meta");
      meta.name = "referrer";
      meta.content = "no-referrer";
      popup.document.head.append(meta);
    } catch {
      // A new blank document normally permits this; its initial referrer is empty.
    }
    activePopup.current = popup;
    const currentAttempt = ++attempt.current;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await provider.invoke({
        method: "generate-document",
        actionId: action.id,
      });
      const document = response.document;
      if (currentAttempt !== attempt.current) {
        if (activePopup.current === popup) {
          popup.close();
          activePopup.current = null;
        }
        return;
      }
      if (
        !document ||
        document.format !== "docx" ||
        typeof document.fileName !== "string" ||
        !document.fileName.trim() ||
        !safeSourceUrl(document.url)
      )
        throw new Error("Invalid document response");

      // The provider serves this signed URL as an attachment. A reserved tab
      // keeps the navigation inside the user's click gesture and avoids losing
      // the download to popup blocking while the private API call is in flight.
      popup.location.replace(document.url);
      activePopup.current = null;
      setFeedback("success");
    } catch {
      popup.close();
      if (activePopup.current === popup) activePopup.current = null;
      if (currentAttempt === attempt.current) setFeedback("error");
    } finally {
      if (currentAttempt === attempt.current) setBusy(false);
    }
  }

  return (
    <div className="min-w-0 max-w-full">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-auto min-h-9 max-w-full gap-2 whitespace-normal text-left leading-snug"
        disabled={disabled || busy}
        aria-busy={busy}
        onClick={() => void generate()}
      >
        {busy ? (
          <LoaderCircle
            className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : feedback === "success" ? (
          <Download className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <FileText className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 break-words">{action.label}</span>
      </Button>
      {busy && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {t("Preparing the download…")}
        </p>
      )}
      {feedback === "success" && !busy && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {t("Download started.")}
        </p>
      )}
      {(feedback === "error" || feedback === "popup-blocked") && (
        <div className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-destructive">
          <p role="alert">
            {feedback === "error"
              ? t("Could not generate the document.")
              : t("Allow pop-ups and try again.")}
          </p>
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
