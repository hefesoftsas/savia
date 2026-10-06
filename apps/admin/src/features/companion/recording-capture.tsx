import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { intlLocale, useAppLocale, useMessages } from "@/i18n/core";
import { companionMessages } from "@/i18n/locales/companion";
import type { CompanionRecordingsClient, Recording } from "./client";
import {
  captureErrorKey,
  MAX_CAPTURE_SECONDS,
  startMicCapture,
  type CapturedTake,
} from "./mic-capture";

const formatElapsed = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

const sanitizeFileName = (name: string, fallback: string) => {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 200);
  return cleaned || fallback;
};

export function RecordingCapture({
  client,
  onSaved,
  onClose,
  onBusy,
  startCapture = startMicCapture,
}: {
  client: CompanionRecordingsClient;
  onSaved: (recording: Recording) => void;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  startCapture?: typeof startMicCapture;
}) {
  const t = useMessages(companionMessages);
  const locale = useAppLocale();
  const defaultName = () =>
    new Date().toLocaleString(intlLocale(locale), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const [phase, setPhase] = useState<"consent" | "recording" | "review">(
    "consent",
  );
  const [consent, setConsent] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<CapturedTake | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"denied" | "unsupported" | "save" | null>(
    null,
  );
  const handle = useRef<Awaited<ReturnType<typeof startMicCapture>> | null>(
    null,
  );
  const preview = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      handle.current?.cancel();
      if (preview.current) URL.revokeObjectURL(preview.current);
    };
  }, []);
  const enterReview = (next: CapturedTake) => {
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = URL.createObjectURL(next.blob);
    setTake(next);
    setPreviewUrl(preview.current);
    setName(defaultName());
    setPhase("review");
  };
  const start = async () => {
    if (!consent || starting) return;
    setStarting(true);
    setError(null);
    try {
      const capture = await startCapture({
        maxSeconds: MAX_CAPTURE_SECONDS,
        onTick: (seconds) => {
          if (mounted.current) setElapsed(seconds);
        },
        onAutoStop: (auto) => {
          if (mounted.current) {
            handle.current = null;
            enterReview(auto);
          }
        },
      });
      if (!mounted.current) {
        capture.cancel();
        return;
      }
      handle.current = capture;
      setElapsed(0);
      setPhase("recording");
    } catch (e) {
      if (mounted.current) setError(captureErrorKey(e));
    } finally {
      if (mounted.current) setStarting(false);
    }
  };
  const stop = async () => {
    const capture = handle.current;
    if (!capture) return;
    handle.current = null;
    const next = await capture.stop();
    if (mounted.current && next.blob.size) enterReview(next);
  };
  const close = () => {
    handle.current?.cancel();
    handle.current = null;
    onClose();
  };
  const save = async () => {
    if (!take || saving) return;
    setSaving(true);
    onBusy(true);
    setError(null);
    try {
      const file = new File(
        [take.blob],
        `${sanitizeFileName(name, defaultName())}.wav`,
        { type: "audio/wav" },
      );
      const recording = await client.upload(file);
      if (mounted.current) onSaved(recording);
    } catch {
      if (mounted.current) setError("save");
    } finally {
      onBusy(false);
      if (mounted.current) setSaving(false);
    }
  };
  return (
    <section aria-label={t("Record audio")} className="mb-6 border-b pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Mic className="size-5" aria-hidden="true" />
          {t("Record audio")}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("Close")}
          disabled={starting || saving}
          onClick={close}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {t(
            error === "denied"
              ? "Microphone access was denied. Allow it in your browser and try again."
              : error === "unsupported"
                ? "This browser cannot record audio. Use a recent Chrome, Edge, Firefox or Safari."
                : "Unable to save the recording. Try again.",
          )}
        </p>
      )}
      {phase === "consent" && (
        <div className="mt-4 space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-primary"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>{t("I have permission to record this audio.")}</span>
          </label>
          <Button disabled={!consent || starting} onClick={() => void start()}>
            {starting && (
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
            )}
            {t(starting ? "Starting recording…" : "Start recording")}
          </Button>
        </div>
      )}
      {phase === "recording" && (
        <div className="mt-4 space-y-4">
          <p role="status" className="flex items-center gap-2 text-lg">
            <span
              className="inline-block size-3 animate-pulse rounded-full bg-destructive"
              aria-hidden="true"
            />
            {formatElapsed(elapsed)}
            <span className="text-sm text-muted-foreground">
              / {formatElapsed(MAX_CAPTURE_SECONDS)}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {t("Recording stops automatically after 10 minutes.")}
          </p>
          <Button variant="outline" onClick={() => void stop()}>
            <Square className="size-4" aria-hidden="true" />
            {t("Stop recording")}
          </Button>
        </div>
      )}
      {phase === "review" && take && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("Listen to your recording before saving.")} ·{" "}
            {formatElapsed(Math.round(take.durationSeconds))}
          </p>
          {previewUrl && (
            <audio
              controls
              preload="metadata"
              src={previewUrl}
              className="w-full"
            />
          )}
          <label className="block max-w-xs text-sm font-medium">
            {t("Recording name")}
            <input
              className="mt-2 block w-full rounded-md border bg-background p-2 font-normal"
              value={name}
              maxLength={200}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={saving || !name.trim()}
              onClick={() => void save()}
            >
              {saving && (
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
              )}
              {t(saving ? "Saving recording…" : "Save recording")}
            </Button>
            <Button variant="outline" disabled={saving} onClick={close}>
              {t("Discard recording")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
