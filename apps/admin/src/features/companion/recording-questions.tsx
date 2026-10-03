import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { companionMessages } from "@/i18n/locales/companion";
import type { CompanionRecordingsClient, RecordingAnswer } from "./client";
import { providerFailureMessage } from "./provider-error";

export function RecordingQuestions({
  id,
  client,
}: {
  id: string;
  client: Pick<CompanionRecordingsClient, "answer">;
}) {
  const t = useMessages(companionMessages);
  const [question, setQuestion] = useState("");
  const [consent, setConsent] = useState(false);
  const [answer, setAnswer] = useState<RecordingAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function ask() {
    if (!question.trim() || !consent || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      setAnswer(await client.answer(id, question.trim()));
    } catch (error) {
      setError(
        providerFailureMessage(error, t) ??
          t("Processing failed. Check provider usage before trying again."),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="mt-8 max-w-prose border-t pt-6"
      aria-labelledby="recording-questions-title"
    >
      <h3 id="recording-questions-title" className="text-lg font-medium">
        {t("Ask about this recording")}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("Answers use only this transcript. Verify them against the audio.")}
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <label className="block text-sm font-medium">
          {t("Your question")}
          <textarea
            className="mt-2 block min-h-24 w-full rounded-md border bg-background p-3 font-normal focus-visible:outline-2 focus-visible:outline-ring"
            value={question}
            maxLength={2000}
            required
            disabled={busy}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-primary"
            checked={consent}
            disabled={busy}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            {t(
              "I agree to send this transcript and question to OpenRouter. Processing may incur charges.",
            )}
          </span>
        </label>
        <Button disabled={!question.trim() || !consent || busy} type="submit">
          {t(busy ? "Preparing answer…" : "Ask about recording")}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {answer && (
        <div role="status" className="mt-5 text-sm leading-7">
          {answer.insufficientEvidence && (
            <p className="font-medium">
              {t("Insufficient evidence in this recording.")}
            </p>
          )}
          <p className="whitespace-pre-wrap">{answer.answer}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("AI draft. Verify facts and commitments.")}
          </p>
        </div>
      )}
    </section>
  );
}
