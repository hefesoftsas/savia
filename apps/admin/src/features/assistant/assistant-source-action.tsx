import { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import {
  safeSourceUrl,
  type PluginAssistantProvider,
} from "@savia/studio-shared/plugin-assistant";
const messages = {
  "Open source": ["Abrir fuente", "Open source", "Abrir fonte"],
  "Opening source…": ["Abriendo fuente…", "Opening source…", "Abrindo fonte…"],
  "Could not open the PDF. Allow pop-ups and try again.": [
    "No se pudo abrir el PDF. Permite ventanas emergentes y vuelve a intentarlo.",
    "Could not open the PDF. Allow pop-ups and try again.",
    "Não foi possível abrir o PDF. Permita pop-ups e tente novamente.",
  ],
} as const;
export function AssistantSourceAction({
  provider,
  messageId,
  citationId,
}: {
  provider: PluginAssistantProvider;
  messageId: string;
  citationId: string;
}) {
  const tx = useMessages(messages);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setBusy(false);
    setError(false);
    return () => {
      generation.current++;
    };
  }, [provider.sessionId, messageId, citationId]);
  async function open() {
    const current = generation.current;
    // Reserve the tab during the click; waiting for the private API first would
    // cause browsers to block the PDF as an unsolicited popup.
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError(true);
      return;
    }
    popup.opener = null;
    setBusy(true);
    setError(false);
    try {
      const result = await provider.invoke({
        method: "open-source",
        messageId,
        citationId,
      });
      if (current !== generation.current) {
        popup.close();
        return;
      }
      if (!result.source || !safeSourceUrl(result.source.url))
        throw new Error("Source unavailable");
      const destination = new URL(result.source.url);
      if (result.source.page !== undefined) {
        const fragment = new URLSearchParams(destination.hash.slice(1));
        fragment.set("page", String(result.source.page));
        destination.hash = fragment.toString();
      }
      popup.location.replace(destination.href);
    } catch {
      popup.close();
      if (current === generation.current) setError(true);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void open()}
        className="gap-2"
      >
        {busy ? (
          <LoaderCircle
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <ExternalLink className="size-4" aria-hidden="true" />
        )}
        {tx(busy ? "Opening source…" : "Open source")}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {tx("Could not open the PDF. Allow pop-ups and try again.")}
        </p>
      )}
    </div>
  );
}
