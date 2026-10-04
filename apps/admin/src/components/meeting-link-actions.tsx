import { useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { useMessages, type MessageCatalog } from "@/i18n/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const messages = {
  "Copy meeting link": [
    "Copiar enlace de llamada",
    "Copy meeting link",
    "Copiar link da chamada",
  ],
  "Share meeting link": [
    "Compartir enlace de llamada",
    "Share meeting link",
    "Compartilhar link da chamada",
  ],
  "Meeting link": ["Enlace de llamada", "Meeting link", "Link da chamada"],
  "Link copied.": ["Enlace copiado.", "Link copied.", "Link copiado."],
  "Link shared.": ["Enlace compartido.", "Link shared.", "Link compartilhado."],
  "Could not copy. Select the link and copy it manually.": [
    "No se pudo copiar. Selecciona el enlace y cópialo manualmente.",
    "Could not copy. Select the link and copy it manually.",
    "Não foi possível copiar. Selecione o link e copie-o manualmente.",
  ],
  "Could not share. Copy the link to share it.": [
    "No se pudo compartir. Copia el enlace para compartirlo.",
    "Could not share. Copy the link to share it.",
    "Não foi possível compartilhar. Copie o link para compartilhá-lo.",
  ],
} satisfies MessageCatalog;

/** Receives only participant URLs already validated by the conference renderer. */
export function MeetingLinkActions({
  url,
  compact = false,
}: {
  url: string;
  compact?: boolean;
}) {
  // Changing meetings discards pending feedback from the previous link.
  return <LinkActions key={url} url={url} compact={compact} />;
}

function LinkActions({ url, compact }: { url: string; compact: boolean }) {
  const t = useMessages(messages);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<keyof typeof messages>();
  const [error, setError] = useState<keyof typeof messages>();

  async function act(share: boolean) {
    setPending(true);
    setNotice(undefined);
    setError(undefined);
    const nativeShare = share && typeof navigator.share === "function";
    try {
      if (nativeShare) {
        await navigator.share({ url });
        setNotice("Link shared.");
      } else {
        await navigator.clipboard.writeText(url);
        setNotice("Link copied.");
      }
    } catch (cause) {
      if (!(
        nativeShare &&
        cause instanceof DOMException &&
        cause.name === "AbortError"
      )) {
        setError(
          nativeShare
            ? "Could not share. Copy the link to share it."
            : "Could not copy. Select the link and copy it manually.",
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          size={compact ? "icon" : "sm"}
          className={compact ? "size-11" : undefined}
          disabled={pending}
          onClick={() => void act(false)}
          aria-label={compact ? t("Copy meeting link") : undefined}
          title={compact ? t("Copy meeting link") : undefined}
        >
          <Copy aria-hidden="true" className="size-4" />
          {!compact && t("Copy meeting link")}
        </Button>
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          size={compact ? "icon" : "sm"}
          className={compact ? "size-11" : undefined}
          disabled={pending}
          onClick={() => void act(true)}
          aria-label={compact ? t("Share meeting link") : undefined}
          title={compact ? t("Share meeting link") : undefined}
        >
          <Share2 aria-hidden="true" className="size-4" />
          {!compact && t("Share meeting link")}
        </Button>
      </div>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {t(notice)}
        </p>
      )}
      {error && (
        <>
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
          <Input
            aria-label={t("Meeting link")}
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
          />
        </>
      )}
    </div>
  );
}
