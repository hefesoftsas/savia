import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  Upload,
} from "lucide-react";
import type { AppServices } from "@/app-services";
import { Button } from "@/components/ui/button";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { companionMessages } from "@/i18n/locales/companion";
import {
  CompanionRecordingsClient,
  type Recording,
  type RecordingNotes,
} from "./client";

import { RecordingUpload } from "./recording-upload";

// Operate: an owner-private audio inbox, using Savia's neutral surfaces and
// emerald actions. The list leads to one listening/review workspace; generated
// notes are the content, with consent immediately beside the processing action.
export function CompanionRecordingsPage({
  services,
  client: supplied,
}: {
  services?: Pick<AppServices, "apiClient">;
  client?: CompanionRecordingsClient;
}) {
  const client = useMemo(
    () => supplied ?? new CompanionRecordingsClient(services!.apiClient),
    [services, supplied],
  );
  const t = useMessages(companionMessages),
    locale = useAppLocale();
  const [recordings, setRecordings] = useState<Recording[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Recording | null>(null),
    [notes, setNotes] = useState<RecordingNotes | null>(null);
  const [audio, setAudio] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [processing, setProcessing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false),
    [uploading, setUploading] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const mounted = useRef(true),
    inFlight = useRef(false);
  const source = (r: Recording) =>
    r.name ??
    t(
      r.source === "upload"
        ? "Uploaded audio"
        : r.source === "microphone"
          ? "Microphone"
          : "System audio",
    );
  const date = (r: Recording) =>
    new Date(r.createdAt).toLocaleString(intlLocale(locale), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const load = async (next?: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await client.list(next);
      if (!mounted.current) return;
      setRecordings((previous) =>
        next
          ? [
              ...previous,
              ...result.recordings.filter(
                (r) => !previous.some((p) => p.id === r.id),
              ),
            ]
          : result.recordings,
      );
      setCursor(result.cursor);
      if (!next) setDetailRevision((value) => value + 1);
      if (!next)
        setSelected(
          (current) =>
            result.recordings.find((r) => r.id === current?.id) ??
            result.recordings[0] ??
            null,
        );
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : t("Unable to load recordings."),
        );
    } finally {
      if (mounted.current) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [client]);
  useEffect(() => {
    setAudio(null);
    setNotes(null);
    setConsent(false);
    if (!selected) {
      setLoadingDetail(false);
      return;
    }
    const controller = new AbortController();
    let disposed = false,
      objectUrl: string | null = null;
    setLoadingDetail(true);
    setError("");
    void Promise.allSettled([
      client.audio(selected.id, controller.signal),
      client.notes(selected.id),
    ]).then((results) => {
      if (disposed) return;
      const [media, savedNotes] = results;
      if (media.status === "fulfilled") {
        objectUrl = URL.createObjectURL(media.value);
        setAudio(objectUrl);
      }
      if (savedNotes.status === "fulfilled") setNotes(savedNotes.value);
      const failure = results.find((r) => r.status === "rejected");
      if (failure?.status === "rejected")
        setError(
          failure.reason instanceof Error
            ? failure.reason.message
            : t("Unable to load this recording."),
        );
      setLoadingDetail(false);
    });
    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, selected?.id, detailRevision]);
  const generate = async () => {
    if (!selected || !consent || inFlight.current) return;
    inFlight.current = true;
    setProcessing(true);
    setError("");
    try {
      const result = await client.generate(selected.id);
      if (mounted.current) setNotes(result);
    } catch {
      if (mounted.current) {
        setError(
          t("Processing failed. Check provider usage before trying again."),
        );
        const partial = await client.notes(selected.id).catch(() => null);
        if (mounted.current && partial) setNotes(partial);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setProcessing(false);
    }
  };
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Recordings")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Your recordings from Companion, local disk and connected drives. Private to your account.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={loading || processing || uploading}
            onClick={() => setUploadOpen(true)}
          >
            <Upload className="size-4" aria-hidden="true" />
            {t("Upload recording")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || processing || uploading}
            onClick={() => void load()}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("Refresh")}
          </Button>
        </div>
      </header>
      {uploadOpen && (
        <RecordingUpload
          client={client}
          onBusy={setUploading}
          onClose={() => setUploadOpen(false)}
          onSaved={(recording) => {
            setRecordings((previous) => [
              recording,
              ...previous.filter((r) => r.id !== recording.id),
            ]);
            setSelected(recording);
            setUploadOpen(false);
            setError("");
          }}
        />
      )}
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {loading && !recordings.length ? (
        <p
          role="status"
          className="py-16 text-center text-sm text-muted-foreground"
        >
          {t("Loading recordings…")}
        </p>
      ) : !recordings.length ? (
        <section className="py-20 text-center">
          <AudioLines
            className="mx-auto mb-5 size-7 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="text-xl font-medium">{t("No recordings yet")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Upload an audio file or record in Companion to get started.")}
          </p>
        </section>
      ) : (
        <div className="grid gap-8 md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,1fr)]">
          <nav aria-label={t("Recordings")} className="md:border-r md:pr-6">
            <ul className="space-y-1">
              {recordings.map((r) => (
                <li key={r.id}>
                  <button
                    className={`flex w-full items-center justify-between gap-2 rounded-lg p-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${selected?.id === r.id ? "bg-muted" : ""}`}
                    disabled={processing || uploading}
                    aria-current={selected?.id === r.id ? "true" : undefined}
                    onClick={() => setSelected(r)}
                  >
                    <span className="min-w-0">
                      <span className="block break-words font-medium">
                        {source(r)}
                      </span>
                      <time
                        className="mt-1 block text-xs text-muted-foreground"
                        dateTime={r.createdAt}
                      >
                        {date(r)}
                      </time>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {r.durationSeconds != null
                          ? `${r.durationSeconds.toFixed(1)}s · `
                          : ""}
                        {Math.round(r.bytes / 1024)} KiB
                      </span>
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
            {cursor && (
              <Button
                className="mt-3 w-full"
                variant="ghost"
                size="sm"
                disabled={loading || processing || uploading}
                onClick={() => void load(cursor)}
              >
                {t("Load more")}
              </Button>
            )}
          </nav>
          <section className="min-w-0" aria-label={t("Meeting notes")}>
            {selected && (
              <>
                <h2 className="break-words text-lg font-medium">
                  {source(selected)}
                </h2>
                <p className="mb-5 mt-1 text-sm text-muted-foreground">
                  {date(selected)}
                </p>
                {loadingDetail && (
                  <p
                    role="status"
                    className="mb-4 text-sm text-muted-foreground"
                  >
                    {t("Loading recording…")}
                  </p>
                )}
                {audio && (
                  <>
                    <audio
                      key={selected.id}
                      aria-label={source(selected)}
                      controls
                      onError={() =>
                        setError(
                          t(
                            "Your browser cannot play this audio. Download it to listen in another application.",
                          ),
                        )
                      }
                      preload="metadata"
                      src={audio}
                      className="w-full"
                    />
                    <a
                      href={audio}
                      download={
                        selected.name ?? `${selected.id}.${selected.format}`
                      }
                      className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-4"
                    >
                      {t("Download audio")}
                    </a>
                  </>
                )}
                {!notes?.summary && (
                  <div className="mt-8 border-t pt-6">
                    <h3 className="text-base font-medium">
                      {t("Your meetings, ready to review")}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(
                        "Listen, then turn the conversation into meeting notes.",
                      )}
                    </p>
                    <label className="mt-5 flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-primary"
                        checked={consent}
                        disabled={processing || uploading}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <span>
                        {t(
                          "I have permission to send this recording through Savia to OpenRouter for transcription and a summary.",
                        )}
                      </span>
                    </label>
                    <Button
                      className="mt-4"
                      disabled={
                        !consent ||
                        loadingDetail ||
                        processing ||
                        uploading ||
                        !audio
                      }
                      onClick={() => void generate()}
                    >
                      {processing && (
                        <LoaderCircle
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                      )}
                      {t(
                        processing
                          ? "Preparing transcript and summary…"
                          : "Generate summary",
                      )}
                    </Button>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t(
                        "Provider processing may incur charges. No automatic retries.",
                      )}
                    </p>
                  </div>
                )}
                {notes?.summary && (
                  <article className="mt-8 max-w-prose border-t pt-6">
                    <h3 className="text-lg font-medium">
                      {t("Meeting notes")}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("AI draft. Verify facts and commitments.")}
                    </p>
                    <p className="mt-5 whitespace-pre-wrap text-sm leading-7">
                      {notes.summary.summary}
                    </p>
                    {notes.summary.decisions.length > 0 && (
                      <>
                        <h4 className="mb-2 mt-6 font-medium">
                          {t("Decisions")}
                        </h4>
                        <ul className="list-disc space-y-2 pl-5 text-sm">
                          {notes.summary.decisions.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {notes.summary.actions.length > 0 && (
                      <>
                        <h4 className="mb-2 mt-6 font-medium">
                          {t("Actions")}
                        </h4>
                        <ul className="list-disc space-y-2 pl-5 text-sm">
                          {notes.summary.actions.map((x, i) => (
                            <li key={i}>
                              {x.description}
                              {(x.owner || x.dueDate) && (
                                <span className="block text-xs text-muted-foreground">
                                  {[x.owner, x.dueDate]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {notes.summary.openQuestions.length > 0 && (
                      <>
                        <h4 className="mb-2 mt-6 font-medium">
                          {t("Open questions")}
                        </h4>
                        <ul className="list-disc space-y-2 pl-5 text-sm">
                          {notes.summary.openQuestions.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </article>
                )}
                {notes?.transcript && (
                  <details className="mt-8 border-t pt-5">
                    <summary className="cursor-pointer text-sm font-medium">
                      {t("Transcript")}
                    </summary>
                    <p className="mt-4 max-w-prose whitespace-pre-wrap text-sm leading-7">
                      {notes.transcript.text || t("No speech returned.")}
                    </p>
                  </details>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
