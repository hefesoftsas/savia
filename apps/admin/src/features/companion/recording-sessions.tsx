import "./recording-sessions.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, RefreshCw } from "lucide-react";
import type { ApiClient } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { companionMessages } from "@/i18n/locales/companion";
import {
  CompanionSessionsClient,
  type RecordingSession,
  type SessionChunk,
  type SessionAnswer,
} from "./sessions-client";
export const sessionTime = (seconds: number) =>
  `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
const active = (session: RecordingSession) =>
  ["queued", "transcribing", "summarizing"].includes(session.job.status);
export function RecordingSessions({ api }: { api: ApiClient }) {
  const client = useMemo(() => new CompanionSessionsClient(api), [api]);
  const t = useMessages(companionMessages);
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  async function load(next?: string) {
    const version = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const result = await client.list(next);
      if (version !== generation.current) return;
      setSessions((previous) =>
        next
          ? [
              ...previous,
              ...result.sessions.filter(
                (item) => !previous.some((old) => old.id === item.id),
              ),
            ]
          : result.sessions,
      );
      setCursor(result.cursor);
      if (!next)
        setSelected((current) =>
          result.sessions.some((item) => item.id === current)
            ? current
            : (result.sessions[0]?.id ?? null),
        );
    } catch {
      if (version === generation.current) setError(true);
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [client]);
  const session = sessions.find((item) => item.id === selected);
  return (
    <div className="recording-session-container mx-auto max-w-6xl px-4 py-6 md:px-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Recording sessions")}
          </h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {t(
              "Up to one hour, with private audio and saved processing progress.",
            )}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          {t("Refresh")}
        </Button>
      </header>
      {error && (
        <p role="alert" className="mb-4 text-destructive">
          {t("Unable to load recordings.")}
        </p>
      )}
      {loading && !sessions.length ? (
        <p role="status">{t("Loading recordings…")}</p>
      ) : !sessions.length ? (
        <div className="border-t py-12">
          <AudioLines
            className="mb-4 size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="text-lg font-medium">
            {t("No recording sessions yet")}
          </h2>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            {t(
              "Record in Companion desktop and choose Upload to Savia. Your session will appear here.",
            )}
          </p>
        </div>
      ) : (
        <div className="recording-session-layout border-t pt-6">
          <nav aria-label={t("Recording sessions")}>
            <ul className="space-y-1">
              {sessions.map((item) => (
                <li key={item.id}>
                  <button
                    className={`w-full rounded-md px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-ring ${selected === item.id ? "bg-muted" : "hover:bg-muted/50"}`}
                    aria-current={selected === item.id ? "true" : undefined}
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="block break-words font-medium">
                      {item.name}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {sessionTime(item.durationSeconds ?? 0)} ·{" "}
                      {t(
                        item.state === "uploading"
                          ? "Upload incomplete"
                          : "Ready to review",
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {cursor && (
              <Button
                variant="ghost"
                disabled={loading}
                onClick={() => void load(cursor)}
              >
                {t("Load more")}
              </Button>
            )}
          </nav>
          {session && (
            <SessionDetail key={session.id} initial={session} client={client} />
          )}
        </div>
      )}
    </div>
  );
}
function SessionDetail({
  initial,
  client,
}: {
  initial: RecordingSession;
  client: CompanionSessionsClient;
}) {
  const t = useMessages(companionMessages);
  const [session, setSession] = useState(initial);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [consent, setConsent] = useState(false),
    [retry, setRetry] = useState(false);
  const inFlight = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setSession(initial);
    void client
      .get(initial.id, abort.signal)
      .then((next) => {
        if (!abort.signal.aborted) setSession(next);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [initial, client]);
  const running = active(session);
  useEffect(() => {
    if (!running) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await client.get(initial.id, abort.signal);
        if (!abort.signal.aborted) {
          setSession(next);
          setError(false);
        }
      } catch {
        if (!abort.signal.aborted) setError(true);
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 5000);
    };
    timer = setTimeout(() => void poll(), 3000);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, initial.id, running]);
  async function run(cancel: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const next = cancel
        ? await client.cancel(session.id)
        : await client.process(session.id, retry);
      if (mounted.current) {
        setSession(next);
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        setConsent(false);
        setRetry(false);
      }
    }
  }
  const attention =
    session.job.status === "needs_attention" ||
    session.job.status === "cancelled";
  const statusLabel = (
    {
      idle: "Not processed",
      queued: "Queued",
      transcribing: "Transcribing",
      summarizing: "Preparing summary",
      complete: "Complete",
      needs_attention: "Needs attention",
      cancelled: "Cancelled",
      failed: "Needs attention",
    } as const
  )[session.job.status];
  return (
    <article className="min-w-0">
      <h2 className="break-words text-xl font-semibold">{session.name}</h2>
      <SessionPlayer session={session} client={client} />
      <section className="mt-8 border-t pt-6">
        <h3 className="text-lg font-medium">{t("Transcript and summary")}</h3>
        <p className="mt-2 text-sm" role="status">
          {t(statusLabel)}
          {session.job.totalChunks > 0 &&
            ` · ${session.job.completedChunks}/${session.job.totalChunks}`}
        </p>
        {running && (
          <>
            <progress
              className="mt-3 h-2 w-full accent-primary"
              aria-label={t("Transcribing")}
              max={session.job.totalChunks || 1}
              value={session.job.completedChunks}
            />
            <p className="mt-2 text-sm text-muted-foreground">
              {t("You can close this page. Processing continues in Savia.")}
            </p>
            <Button
              className="mt-4"
              variant="outline"
              disabled={busy}
              onClick={() => void run(true)}
            >
              {t("Cancel processing")}
            </Button>
          </>
        )}
        {!running &&
          session.state === "ready" &&
          session.job.status !== "complete" && (
            <div className="mt-4 space-y-4">
              {attention && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "Processing stopped. Saved results are preserved. A previous provider request may have incurred charges.",
                  )}
                </p>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  disabled={busy}
                />
                <span>
                  {t(
                    "I agree to send audio and transcripts to OpenRouter. Processing may incur charges.",
                  )}
                </span>
              </label>
              {attention && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-primary"
                    checked={retry}
                    onChange={(event) => setRetry(event.target.checked)}
                    disabled={busy}
                  />
                  <span>
                    {t("I accept that retrying may incur another charge.")}
                  </span>
                </label>
              )}
              <Button
                disabled={busy || !consent || (attention && !retry)}
                onClick={() => void run(false)}
              >
                {t(
                  busy
                    ? "Starting processing…"
                    : "Generate transcript and summary",
                )}
              </Button>
            </div>
          )}
        {session.state === "uploading" && (
          <p className="mt-3 text-sm text-muted-foreground">
            {t(
              "Finish uploading this session from Companion before processing.",
            )}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {t("Unable to update this session. Refresh and try again.")}
          </p>
        )}
        {session.job.summary && (
          <div className="mt-6 max-w-prose space-y-5">
            <p className="whitespace-pre-wrap leading-relaxed">
              {session.job.summary.summary}
            </p>
            {[
              [t("Decisions"), session.job.summary.decisions],
              [t("Open questions"), session.job.summary.openQuestions],
            ].map(
              ([label, items]) =>
                (items as string[]).length > 0 && (
                  <div key={label as string}>
                    <h4 className="font-medium">{label as string}</h4>
                    <ul className="mt-2 list-disc space-y-2 pl-5">
                      {(items as string[]).map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ),
            )}
            {session.job.summary.actions.length > 0 && (
              <div>
                <h4 className="font-medium">{t("Action items")}</h4>
                <ul className="mt-2 list-disc space-y-2 pl-5">
                  {session.job.summary.actions.map((item, index) => (
                    <li key={index}>
                      {item.description}
                      {item.owner && ` — ${item.owner}`}
                      {item.dueDate && ` · ${item.dueDate}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {Object.keys(session.job.transcripts).length > 0 && (
          <>
            <details className="mt-6">
              <summary className="cursor-pointer font-medium">
                {t("Transcript")}
              </summary>
              <div className="mt-4 max-w-prose space-y-5">
                {session.chunks.map((chunk) => {
                  const transcript =
                    session.job.transcripts[
                      `${chunk.source}:${chunk.sequence}`
                    ];
                  return (
                    transcript && (
                      <div key={`${chunk.source}:${chunk.sequence}`}>
                        <p className="text-xs text-muted-foreground">
                          {sessionTime(chunk.startSeconds)} ·{" "}
                          {t(
                            chunk.source === "microphone"
                              ? "Microphone"
                              : "System audio",
                          )}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                          {transcript.text}
                        </p>
                      </div>
                    )
                  );
                })}
              </div>
            </details>
            <SessionQuestions id={session.id} client={client} />
          </>
        )}
      </section>
    </article>
  );
}
function SessionPlayer({
  session,
  client,
}: {
  session: RecordingSession;
  client: CompanionSessionsClient;
}) {
  const t = useMessages(companionMessages);
  const [chunk, setChunk] = useState<SessionChunk | undefined>(
    session.chunks[0],
  );
  const [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState(false);
  const [playNext, setPlayNext] = useState(false);
  const [audioRevision, setAudioRevision] = useState(0);
  useEffect(() => {
    if (!chunk) return;
    const abort = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null);
    setError(false);
    void client
      .audio(session.id, chunk, abort.signal)
      .then((blob) => {
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, session.id, chunk, audioRevision]);
  if (!chunk) return null;
  const ordered = session.chunks
    .filter((item) => item.source === chunk.source)
    .sort((a, b) => a.sequence - b.sequence);
  const previous = ordered.find((item) => item.sequence === chunk.sequence - 1);
  return (
    <div className="mt-5 space-y-3">
      <label className="block text-sm font-medium">
        {t("Listen from")}
        <select
          className="mt-2 block w-full rounded-md border bg-background p-2"
          value={`${chunk.source}:${chunk.sequence}`}
          onChange={(event) => {
            setPlayNext(false);
            setChunk(
              session.chunks.find(
                (item) =>
                  `${item.source}:${item.sequence}` === event.target.value,
              ),
            );
          }}
        >
          {session.chunks.map((item) => (
            <option
              key={`${item.source}:${item.sequence}`}
              value={`${item.source}:${item.sequence}`}
            >
              {sessionTime(item.startSeconds)} ·{" "}
              {t(item.source === "microphone" ? "Microphone" : "System audio")}
            </option>
          ))}
        </select>
      </label>
      {previous &&
        chunk.startSeconds - previous.startSeconds - previous.durationSeconds >
          0.1 && (
          <p className="text-sm text-muted-foreground">
            {t("There is a gap before this part of the recording.")}
          </p>
        )}
      {url ? (
        <audio
          className="w-full"
          src={url}
          controls
          autoPlay={playNext}
          onEnded={() => {
            const next = ordered.find(
              (item) => item.sequence === chunk.sequence + 1,
            );
            if (next) {
              setPlayNext(true);
              setChunk(next);
            }
          }}
        />
      ) : (
        <p className="text-sm" role={error ? "alert" : "status"}>
          {t(error ? "Audio unavailable" : "Loading audio…")}
          {error && (
            <Button
              className="ml-3"
              size="sm"
              variant="outline"
              onClick={() => setAudioRevision((value) => value + 1)}
            >
              {t("Retry audio")}
            </Button>
          )}
        </p>
      )}
    </div>
  );
}
function SessionQuestions({
  id,
  client,
}: {
  id: string;
  client: CompanionSessionsClient;
}) {
  const t = useMessages(companionMessages);
  const [question, setQuestion] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [answer, setAnswer] = useState<SessionAnswer | null>(null);
  const inFlight = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function ask() {
    if (inFlight.current || !consent || !question.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    setAnswer(null);
    try {
      const result = await client.answer(id, question.trim());
      if (mounted.current) setAnswer(result);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="mt-8 max-w-prose border-t pt-6">
      <h3 className="text-lg font-medium">{t("Ask about this recording")}</h3>
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
            className="mt-2 block min-h-24 w-full rounded-md border bg-background p-3"
            required
            maxLength={2000}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-primary"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            disabled={busy}
          />
          <span>
            {t(
              "I agree to send this transcript and question to OpenRouter. Processing may incur charges.",
            )}
          </span>
        </label>
        <Button type="submit" disabled={busy || !consent || !question.trim()}>
          {t(busy ? "Preparing answer…" : "Ask about recording")}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-4 text-destructive">
          {t("Unable to update this session. Refresh and try again.")}
        </p>
      )}
      {answer && (
        <div className="mt-5 space-y-3" role="status">
          {answer.insufficientEvidence && (
            <p className="font-medium">
              {t("Insufficient evidence in this recording.")}
            </p>
          )}
          <p className="whitespace-pre-wrap leading-relaxed">{answer.answer}</p>
          {answer.partial && (
            <p className="text-sm text-muted-foreground">
              {t(
                "This answer uses selected transcript excerpts, not the entire recording.",
              )}
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-sm">
              {t("Evidence used")}
            </summary>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {answer.evidence.map((item) => (
                <li key={`${item.source}:${item.sequence}`}>
                  {sessionTime(item.startSeconds)} ·{" "}
                  {t(
                    item.source === "microphone"
                      ? "Microphone"
                      : "System audio",
                  )}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
