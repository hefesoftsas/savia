import { useSearchParams } from "react-router-dom";
import { RecordingSessions, TRANSCRIPT_LANGUAGES } from "./recording-sessions";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  ChevronDown,
  Download,
  LockKeyhole,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  Upload,
  Trash2,
} from "lucide-react";
import type { AppServices } from "@/app-services";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useMessages, useAppLocale, intlLocale } from "@/i18n/core";
import { companionMessages } from "@/i18n/locales/companion";
import {
  CompanionRecordingsClient,
  type Recording,
  type RecordingNotes,
} from "./client";

import { RecordingUpload } from "./recording-upload";
import {
  processingFailure,
  providerFailureMessage,
  readProviderFailure,
  type ProcessingFailure,
  type ProviderFailure,
} from "./provider-error";

const RecordingAssistant = lazy(() =>
  import("../assistant/recording-assistant").then((module) => ({
    default: module.RecordingAssistant,
  })),
);
function transcriptLanguageName(code: string, locale: string) {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(code);
    return name && name.toLowerCase() !== code.toLowerCase()
      ? `${name} (${code})`
      : code;
  } catch {
    return code;
  }
}

export function CompanionRecordingsPage(props: {
  services?: Pick<AppServices, "apiClient">;
  client?: CompanionRecordingsClient;
}) {
  return props.services ? (
    <RecordingsTabs {...props} />
  ) : (
    <AudioFilesPage {...props} />
  );
}

function RecordingsTabs(props: {
  services?: Pick<AppServices, "apiClient">;
  client?: CompanionRecordingsClient;
}) {
  const t = useMessages(companionMessages);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "sessions" ? "sessions" : "files";
  const setTab = (value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("tab", value);
      return next;
    });
  if (!props.services) return <AudioFilesPage {...props} />;
  return (
    <>
      <nav
        className="mx-auto flex max-w-6xl gap-2 border-b px-4 pt-6 md:px-8"
        aria-label={t("Recordings")}
      >
        <Button
          variant={tab === "files" ? "secondary" : "ghost"}
          aria-pressed={tab === "files"}
          onClick={() => setTab("files")}
        >
          {t("Audio files")}
        </Button>
        <Button
          variant={tab === "sessions" ? "secondary" : "ghost"}
          aria-pressed={tab === "sessions"}
          onClick={() => setTab("sessions")}
        >
          {t("Recording sessions")}
        </Button>
      </nav>
      {tab === "files" ? (
        <AudioFilesPage {...props} />
      ) : (
        <RecordingSessions api={props.services.apiClient} />
      )}
    </>
  );
}

// Operate: an owner-private audio inbox, using Savia's neutral surfaces and
// emerald actions. The list leads to one listening/review workspace; generated
// notes are the content, with transcript chat available after processing.
function AudioFilesPage({
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
  const [error, setError] = useState<
      string | ProviderFailure | ProcessingFailure | null
    >(null),
    [processing, setProcessing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false),
    [uploading, setUploading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false),
    [deleting, setDeleting] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const [recordingPickerOpen, setRecordingPickerOpen] = useState(false);
  const [language, setLanguage] = useState("auto");
  const [retranscribeAck, setRetranscribeAck] = useState(false);
  const recordingPickerTrigger = useRef<HTMLButtonElement>(null);
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
  const hasSavedNotes = Boolean(notes?.transcript || notes?.summary);
  const languageChanged =
    hasSavedNotes && language !== (notes?.language ?? "auto");
  const date = (r: Recording) =>
    new Date(r.createdAt).toLocaleString(intlLocale(locale), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const load = async (next?: string) => {
    setLoading(true);
    setError(null);
    try {
      let result = await client.list(next);
      const visited = new Set<string>();
      while (!result.recordings.length && result.cursor && visited.size < 20) {
        if (visited.has(result.cursor))
          throw new Error("Recording pagination did not advance");
        visited.add(result.cursor);
        result = await client.list(result.cursor);
      }
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
      if (next)
        setSelected((current) => current ?? result.recordings[0] ?? null);
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
    setLanguage("auto");
    setRetranscribeAck(false);
    if (!selected) {
      setLoadingDetail(false);
      return;
    }
    const controller = new AbortController();
    let disposed = false,
      objectUrl: string | null = null;
    setLoadingDetail(true);
    setError(null);
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
      if (savedNotes.status === "fulfilled")
        setLanguage(savedNotes.value.language ?? "auto");
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
  const remove = async () => {
    if (!selected || inFlight.current) return;
    const id = selected.id;
    inFlight.current = true;
    setDeleting(true);
    setError(null);
    try {
      await client.remove(id);
      if (!mounted.current) return;
      const remaining = recordings.filter((recording) => recording.id !== id);
      setRecordings(remaining);
      setSelected(remaining[0] ?? null);
      setDeleteOpen(false);
    } catch {
      if (mounted.current) {
        setDeleteOpen(false);
        setError(t("Unable to delete this recording. Try again."));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setDeleting(false);
    }
  };
  const generate = async () => {
    if (!selected || inFlight.current) return;
    inFlight.current = true;
    setProcessing(true);
    setError(null);
    try {
      const result = await client.generate(
        selected.id,
        language,
        hasSavedNotes && languageChanged && retranscribeAck,
      );
      if (mounted.current) {
        setNotes(result);
        setLanguage(result.language ?? language);
        setRetranscribeAck(false);
      }
    } catch (error) {
      if (mounted.current) {
        setError(readProviderFailure(error) ?? processingFailure);
        const partial = await client.notes(selected.id).catch(() => null);
        if (mounted.current && partial) {
          setNotes(partial);
          setLanguage(partial.language ?? language);
        }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setProcessing(false);
    }
  };
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Recordings")}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            {t("Private to your account.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="max-sm:size-11 max-sm:p-0 max-sm:has-[>svg]:px-0"
            disabled={loading || processing || uploading || deleting}
            onClick={() => setUploadOpen(true)}
          >
            <Upload className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">
              {t("Upload recording")}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="max-sm:size-11"
            aria-label={t("Refresh")}
            title={t("Refresh")}
            disabled={loading || processing || uploading || deleting}
            onClick={() => void load()}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
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
            setError(null);
          }}
        />
      )}
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {typeof error === "string"
            ? error
            : "kind" in error
              ? t(
                  "Processing failed. Check provider usage before trying again.",
                )
              : providerFailureMessage(error, t)}
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
          {cursor && (
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void load(cursor)}
            >
              {t("Load more")}
            </Button>
          )}
        </section>
      ) : (
        <div className="grid gap-5 md:grid-cols-[240px_minmax(0,1fr)] md:gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
          <nav
            aria-label={t("Recordings")}
            className={`${recordings.length === 1 && !cursor ? "hidden md:block" : ""} md:border-r md:pr-6`}
          >
            <Button
              variant="outline"
              ref={recordingPickerTrigger}
              className="w-full justify-between max-sm:h-11 md:hidden"
              aria-expanded={recordingPickerOpen}
              aria-controls="recordings-list"
              onClick={() => setRecordingPickerOpen((open) => !open)}
            >
              {t("Select a recording")}
              <ChevronDown className="size-4" aria-hidden="true" />
            </Button>
            <div
              id="recordings-list"
              className={`${recordingPickerOpen ? "mt-2" : "hidden"} md:mt-0 md:block`}
            >
              <ul className="space-y-1">
                {recordings.map((r) => (
                  <li key={r.id}>
                    <button
                      className={`flex w-full items-center justify-between gap-2 rounded-lg p-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${selected?.id === r.id ? "bg-muted" : ""}`}
                      disabled={processing || uploading || deleting}
                      aria-current={selected?.id === r.id ? "true" : undefined}
                      onClick={() => {
                        setSelected(r);
                        const trigger = recordingPickerTrigger.current;
                        if (trigger?.getClientRects().length) trigger.focus();
                        setRecordingPickerOpen(false);
                      }}
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
                  className="mt-3 w-full max-sm:h-11"
                  variant="ghost"
                  size="sm"
                  disabled={loading || processing || uploading || deleting}
                  onClick={() => void load(cursor)}
                >
                  {t("Load more")}
                </Button>
              )}
            </div>
          </nav>
          <section className="min-w-0" aria-label={t("Meeting notes")}>
            {selected && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="break-words text-lg font-medium">
                    {source(selected)}
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || processing || uploading || deleting}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    {t("Delete recording")}
                  </Button>
                </div>
                <Dialog
                  open={deleteOpen}
                  onOpenChange={(open) => {
                    if (!deleting) setDeleteOpen(open);
                  }}
                >
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("Delete recording")}</DialogTitle>
                      <DialogDescription>
                        {source(selected)}.{" "}
                        {t(
                          "This permanently deletes the saved audio, transcript, summary and associated chats from Savia. The original file stays on your device or connected drive.",
                        )}
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        disabled={deleting}
                        onClick={() => setDeleteOpen(false)}
                        autoFocus
                      >
                        {t("Cancel")}
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={deleting}
                        onClick={() => void remove()}
                      >
                        {deleting ? t("Deleting…") : t("Delete permanently")}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <div className="mb-4 mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <time dateTime={selected.createdAt}>{date(selected)}</time>
                  {audio && (
                    <a
                      href={audio}
                      download={
                        selected.name ?? `${selected.id}.${selected.format}`
                      }
                      className="inline-flex min-h-9 items-center gap-1.5 max-sm:min-h-11 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                      {t("Download audio")}
                    </a>
                  )}
                </div>
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
                  </>
                )}
                <div className="mt-8 grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
                  <div className="min-w-0">
                    <div className="mt-6 space-y-4 border-t pt-5">
                      <label className="block max-w-xs text-sm font-medium">
                        {t("Transcript language")}
                        <select
                          className="mt-2 block w-full rounded-md border bg-background p-2 font-normal"
                          value={language}
                          onChange={(event) => {
                            setLanguage(event.target.value);
                            setRetranscribeAck(false);
                          }}
                          disabled={processing || loadingDetail}
                        >
                          <option value="auto">{t("Automatic")}</option>
                          {language !== "auto" &&
                            !TRANSCRIPT_LANGUAGES.some(
                              (item) => item.code === language,
                            ) && (
                              <option value={language}>
                                {transcriptLanguageName(
                                  language,
                                  intlLocale(locale),
                                )}
                              </option>
                            )}
                          {TRANSCRIPT_LANGUAGES.map((item) => (
                            <option key={item.code} value={item.code}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {languageChanged && (
                        <>
                          <p className="text-sm text-muted-foreground">
                            {t(
                              "Switching language replaces the saved transcript and summary. Provider usage may be billed again.",
                            )}
                          </p>
                          <label className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="mt-1 size-4 accent-primary"
                              checked={retranscribeAck}
                              onChange={(event) =>
                                setRetranscribeAck(event.target.checked)
                              }
                              disabled={processing}
                            />
                            <span>
                              {t(
                                "I understand saved results will be replaced.",
                              )}
                            </span>
                          </label>
                        </>
                      )}
                      {(!notes?.summary || languageChanged) && (
                        <>
                          <Button
                            className="max-sm:h-11 max-sm:w-full"
                            disabled={
                              loadingDetail ||
                              processing ||
                              uploading ||
                              deleting ||
                              !audio ||
                              (languageChanged && !retranscribeAck)
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
                            {t("Processing may incur charges.")}
                          </p>
                        </>
                      )}
                    </div>
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
                  </div>
                  {notes?.transcript?.text.trim() && selected && (
                    <aside className="min-w-0 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-auto">
                      <Suspense
                        fallback={
                          <p
                            role="status"
                            className="text-sm text-muted-foreground"
                          >
                            {t("Loading assistant…")}
                          </p>
                        }
                      >
                        <RecordingAssistant
                          context={{
                            kind: "recording",
                            id: selected.id,
                            title: source(selected),
                          }}
                        />
                      </Suspense>
                    </aside>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
