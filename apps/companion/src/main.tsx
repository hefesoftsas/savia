import React, {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import {
  apiOrigin as validateApiOrigin,
  companionRequest,
  canUploadRecording,
  native,
  type Capabilities,
  type CaptureStatus,
  type Source,
} from "./client";
import { loadPreviewAudio } from "./preview-audio";
import "./styles.css";

const empty: CaptureStatus = {
  state: "idle",
  elapsedSeconds: 0,
  tracks: [],
  error: null,
};
const DEFAULT_API_ORIGIN = "https://savia-preview.hefesoft.com";
const DEFAULT_APP_ORIGIN = "https://savia-preview.hefesoft.com";

function recordingReviewHref(value: string): string | null {
  try {
    return `${validateApiOrigin(value)}/#/companion-recordings?tab=sessions`;
  } catch {
    return null;
  }
}

function App() {
  const [status, setStatus] = useState(empty);
  const [microphone, setMicrophone] = useState(true);
  const [system, setSystem] = useState(true);
  const [apiOrigin, setApiOrigin] = useState(DEFAULT_API_ORIGIN);
  const [appOrigin, setAppOrigin] = useState(DEFAULT_APP_ORIGIN);
  const [token, setToken] = useState("");
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<Source, string | null>>({
    microphone: null,
    system: null,
  });
  const previewUrls = useRef<Record<Source, string | null>>({
    microphone: null,
    system: null,
  });
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      try {
        const next = await native<CaptureStatus>("capture_status");
        if (mounted.current) setStatus(next);
      } catch (error) {
        if (mounted.current) setNotice(errorMessage(error));
      }
    };
    if (isTauri()) {
      void poll();
      timer = setInterval(() => void poll(), 1000);
    }
    return () => {
      mounted.current = false;
      if (timer !== undefined) clearInterval(timer);
      for (const url of Object.values(previewUrls.current))
        if (url) URL.revokeObjectURL(url);
      previewUrls.current = { microphone: null, system: null };
    };
  }, []);

  const run = async (label: string, action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setNotice("");
    setNoticeIsError(false);
    try {
      await action();
    } catch (error) {
      setNotice(errorMessage(error));
      setNoticeIsError(true);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const start = () =>
    run("Starting recording", async () => {
      revokePreviews();
      const next = await native<CaptureStatus>("start_capture", {
        sessionId: crypto.randomUUID(),
        sources: { microphone, system },
      });
      setStatus(next);
      setConsent(false);
      setSaved(false);
    });

  const stop = () =>
    run("Finalizing audio", async () => {
      const next = await native<CaptureStatus>("stop_capture");
      setStatus(next);
      setConsent(false);
      setSaved(false);
    });

  const pause = () =>
    run("Pausing recording", async () => {
      const next = await native<CaptureStatus>("pause_capture");
      setStatus(next);
    });

  const resume = () =>
    run("Resuming recording", async () => {
      const next = await native<CaptureStatus>("resume_capture");
      setStatus(next);
      setConsent(false);
      setSaved(false);
    });

  const discard = () =>
    run("Discarding audio", async () => {
      setStatus(await native<CaptureStatus>("discard_capture"));
      revokePreviews();
      setConsent(false);
      setSaved(false);
      setNotice("");
      setNoticeIsError(false);
    });

  function revokePreviewUrls() {
    for (const url of Object.values(previewUrls.current))
      if (url) URL.revokeObjectURL(url);
    previewUrls.current = { microphone: null, system: null };
  }

  const revokePreviews = () => {
    revokePreviewUrls();
    setPreviews({ microphone: null, system: null });
  };

  const loadPreview = (source: Source) =>
    run("Loading preview", async () => {
      const segments = (status.chunks ?? [])
        .filter((chunk) => chunk.source === source)
        .sort((a, b) => a.sequence - b.sequence);
      if (!segments.length) {
        throw new Error("There is no captured audio to preview yet.");
      }
      const bytes = await loadPreviewAudio(segments, (sequence) =>
        native<{ base64: string; format: string }>("read_capture_chunk", {
          source,
          sequence,
        }),
      );
      if (!mounted.current) return;
      const url = URL.createObjectURL(
        new Blob([bytes.buffer], { type: "audio/ogg" }),
      );
      if (!mounted.current) {
        URL.revokeObjectURL(url);
        return;
      }
      const previous = previewUrls.current[source];
      if (previous) URL.revokeObjectURL(previous);
      previewUrls.current = { ...previewUrls.current, [source]: url };
      setPreviews(previewUrls.current);
    });

  const connect = (event: FormEvent) => {
    event.preventDefault();
    void run("Checking connection", async () => {
      const result = await companionRequest<Capabilities>(
        apiOrigin,
        token,
        "capabilities",
      );
      setCapabilities(result);
      setNotice(
        result.storageAvailable
          ? "Connected to Savia."
          : "Connected, but private audio storage is unavailable on this server.",
      );
      setNoticeIsError(false);
      if (result.storageAvailable) setSettingsOpen(false);
    });
  };

  const openSavia = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isTauri()) return;
    event.preventDefault();
    void run("Opening Savia", async () => {
      const origin = validateApiOrigin(appOrigin);
      await native<void>("open_savia", { origin });
    });
  };

  const upload = () =>
    run("Uploading to Savia", async () => {
      if (!canUploadRecording(capabilities) || !consent)
        throw new Error(
          "Connect storage and confirm permission before upload.",
        );
      if (!status.sessionId || !status.chunks?.length)
        throw new Error("No recoverable audio is available to upload.");
      const session = await companionRequest<{
        state: string;
        chunks: { source: string; sequence: number }[];
      }>(apiOrigin, token, "sessioncreate", {
        id: status.sessionId,
        name: `Recording ${status.sessionId.slice(0, 8)}`,
        sources: [...new Set(status.chunks.map((chunk) => chunk.source))],
        consent: true,
      });
      let uploaded = 0;
      for (const chunk of status.chunks) {
        if (
          !session.chunks.some(
            (saved) =>
              saved.source === chunk.source &&
              saved.sequence === chunk.sequence,
          )
        ) {
          const audio = await native<{ base64: string; format: "ogg" }>(
            "read_capture_chunk",
            { source: chunk.source, sequence: chunk.sequence },
          );
          await companionRequest(apiOrigin, token, "sessionchunk", {
            sessionId: status.sessionId,
            payload: {
              source: chunk.source,
              sequence: chunk.sequence,
              startSeconds: chunk.startSeconds,
              audio: { data: audio.base64, format: audio.format },
            },
          });
        }
        uploaded++;
        setBusy(`Uploading ${uploaded} of ${status.chunks.length}`);
      }
      await companionRequest(apiOrigin, token, "sessionfinalize", {
        sessionId: status.sessionId,
        payload: {
          expectedChunks: status.chunks.length,
          durationSeconds: Math.min(
            3600,
            Math.max(
              ...status.chunks.map(
                (chunk) => chunk.startSeconds + chunk.durationSeconds,
              ),
            ),
          ),
        },
      });
      setSaved(true);
      setNotice("Audio saved privately in Savia.");
    });

  const changeConnection = (change: () => void) => {
    change();
    setCapabilities(null);
    setConsent(false);
    setSaved(false);
    setNotice("");
    setNoticeIsError(false);
  };

  const seconds = Math.floor(status.elapsedSeconds);
  const duration = `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  const isRecording = status.state === "recording";
  const isPaused = status.state === "paused";
  const ready =
    status.state === "ready" ||
    (["error", "interrupted"].includes(status.state) &&
      Boolean(status.chunks?.length));
  const connected = Boolean(capabilities);
  const complete = ready && saved;
  const selectedSources = microphone || system;
  const previewSources = [
    ...new Set((status.chunks ?? []).map((chunk) => chunk.source)),
  ];
  const reviewHref = recordingReviewHref(appOrigin);
  const locked = Boolean(busy) || isRecording || isPaused;
  const actionDisabled =
    Boolean(busy) ||
    (isRecording || isPaused
      ? false
      : ready
        ? complete || !canUploadRecording(capabilities) || !consent
        : !isTauri() || !selectedSources);

  const primaryAction = () => {
    if (isRecording) return stop();
    if (isPaused) return resume();
    if (ready) return upload();
    return start();
  };

  const actionLabel = isRecording
    ? "Stop recording"
    : isPaused
      ? "Resume recording"
      : ready
        ? complete
          ? "Saved to Savia"
          : "Upload to Savia"
        : "Start recording";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          S
        </div>
        <div className="brand-copy">
          <h1>Savia Companion</h1>
          <span
            className={`connection-state${connected ? " is-connected" : ""}`}
          >
            <i aria-hidden="true" />
            {connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <div className="header-actions">
          {connected && reviewHref && (
            <a
              className="open-savia"
              href={reviewHref}
              target="_blank"
              rel="noreferrer"
              onClick={openSavia}
            >
              Open in Savia <span aria-hidden="true">↗</span>
            </a>
          )}
          <button
            className={`settings-toggle${settingsOpen ? " is-open" : ""}`}
            type="button"
            aria-expanded={settingsOpen}
            aria-controls="connection-settings"
            aria-label={
              settingsOpen
                ? "Close connection settings"
                : "Open connection settings"
            }
            title="Connection settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M8.9 2.5h2.2l.45 1.75a6 6 0 0 1 1.18.69l1.73-.54 1.1 1.91-1.28 1.28c.14.5.2.98.2 1.46s-.06.97-.2 1.46l1.28 1.28-1.1 1.91-1.73-.54a6 6 0 0 1-1.18.69l-.45 1.75H8.9l-.45-1.75a6 6 0 0 1-1.18-.69l-1.73.54-1.1-1.91 1.28-1.28a5.4 5.4 0 0 1 0-2.92L4.44 6.31l1.1-1.91 1.73.54a6 6 0 0 1 1.18-.69L8.9 2.5Z" />
              <circle cx="10" cy="9.05" r="2.25" />
            </svg>
          </button>
        </div>
      </header>

      {!isTauri() && (
        <p className="preview-note" role="status">
          Preview only · Open the desktop app to record audio.
        </p>
      )}

      {settingsOpen && (
        <section
          className="settings-panel"
          id="connection-settings"
          aria-label="Connection settings"
        >
          <div className="settings-heading">
            <div>
              <h2>Connect to Savia</h2>
              <p>Credentials stay in memory for this session.</p>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => setSettingsOpen(false)}
              aria-label="Close settings"
            >
              Done
            </button>
          </div>
          <form onSubmit={connect}>
            <fieldset className="settings-fields" disabled={Boolean(busy)}>
              <label>
                API address
                <input
                  type="url"
                  value={apiOrigin}
                  onChange={(event) =>
                    changeConnection(() => setApiOrigin(event.target.value))
                  }
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="url"
                />
              </label>
              <label>
                Savia API key or access token
                <input
                  type="password"
                  value={token}
                  onChange={(event) =>
                    changeConnection(() => setToken(event.target.value))
                  }
                  autoComplete="off"
                  placeholder="Paste your Savia credential"
                />
              </label>
              <label>
                Savia app address
                <input
                  type="url"
                  value={appOrigin}
                  onChange={(event) => setAppOrigin(event.target.value)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="url"
                />
              </label>
              <p className="field-hint">
                Opens the private recording review page.
              </p>
              <button
                className="connect-button"
                type="submit"
                disabled={Boolean(busy) || !token.trim()}
              >
                {capabilities ? "Reconnect" : "Connect"}
              </button>
            </fieldset>
          </form>
        </section>
      )}

      <main>
        <section
          className={`recording-stage${isRecording ? " is-recording" : ""}${isPaused ? " is-paused" : ""}`}
          aria-label="Recording status"
        >
          <div className="stage-status" role="status" aria-live="polite">
            <span className="status-light" aria-hidden="true" />
            <span>
              {isRecording
                ? "Recording"
                : isPaused
                  ? "Paused"
                  : ready
                    ? complete
                      ? "Saved to Savia"
                      : "Ready to upload"
                    : status.state === "error" || status.state === "interrupted"
                      ? "Capture needs attention"
                      : "Ready to record"}
            </span>
          </div>
          <p className="timer" aria-label={`${seconds} seconds recorded`}>
            {duration}
            <span> / 01:00:00</span>
          </p>
          <div
            className="time-track"
            role="progressbar"
            aria-label="Recording time"
            aria-valuemin={0}
            aria-valuemax={3600}
            aria-valuenow={Math.min(seconds, 3600)}
          >
            <span
              style={{ transform: `scaleX(${Math.min(seconds / 3600, 1)})` }}
            />
          </div>
          <p className="stage-hint">
            {isRecording
              ? "Your audio stays on this device until you upload it."
              : isPaused
                ? "Recording is paused. Resume to keep adding to the same take."
                : ready
                  ? "Check the captured sources, then upload when ready."
                  : status.state === "error" || status.state === "interrupted"
                    ? "Review the message below, then try another recording."
                    : "Capture up to one hour from your selected sources."}
          </p>
          {ready && status.tracks.length > 0 && (
            <ul className="captured-sources" aria-label="Captured audio">
              {status.tracks.map((track) => (
                <li key={track.source}>
                  <span>
                    {track.source === "microphone"
                      ? "Microphone"
                      : "System audio"}
                  </span>
                  <span>
                    {track.durationSeconds.toFixed(1)} sec ·{" "}
                    {Math.ceil(track.bytes / 1024)} KB
                  </span>
                </li>
              ))}
            </ul>
          )}
          {ready && previewSources.length > 0 && (
            <div className="preview-panel" aria-label="Local audio preview">
              <p className="preview-title">
                Preview on this device before uploading
              </p>
              {previewSources.map((source) => {
                const url = previews[source];
                return (
                  <div key={source} className="preview-row">
                    <span>
                      {source === "microphone" ? "Microphone" : "System audio"}
                    </span>
                    {url ? (
                      <audio className="preview-audio" src={url} controls />
                    ) : (
                      <button
                        className="discard-action"
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void loadPreview(source)}
                      >
                        Preview{" "}
                        {source === "microphone"
                          ? "microphone"
                          : "system audio"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {status.recovered && (
            <p className="notice" role="status">
              Recovered a saved recording from this device. Review it and upload
              when ready.
            </p>
          )}
          {status.error && (
            <p className="notice is-error" role="alert">
              {status.error}
            </p>
          )}
          {notice && (
            <p
              className={`notice${noticeIsError ? " is-error" : ""}`}
              role={noticeIsError ? "alert" : "status"}
            >
              {notice}
            </p>
          )}
          {!isTauri() && !notice && (
            <p className="stage-hint preview-hint">
              Recording is available in the desktop app.
            </p>
          )}
        </section>
      </main>

      <footer className="capture-dock">
        <fieldset className="source-picker" disabled={locked}>
          <legend>Capture sources</legend>
          <label className="source-choice">
            <input
              type="checkbox"
              checked={microphone}
              onChange={(event) => setMicrophone(event.target.checked)}
            />
            <span className="switch" aria-hidden="true">
              <i />
            </span>
            <span>Microphone</span>
          </label>
          <label className="source-choice">
            <input
              type="checkbox"
              checked={system}
              onChange={(event) => setSystem(event.target.checked)}
            />
            <span className="switch" aria-hidden="true">
              <i />
            </span>
            <span>System audio</span>
          </label>
        </fieldset>

        {ready && (
          <label className="consent-row">
            <input
              type="checkbox"
              checked={consent}
              disabled={Boolean(busy)}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I have permission to record and store this recording in Savia.
            </span>
          </label>
        )}

        <div className="dock-actions">
          <button
            className="primary-action"
            type="button"
            disabled={actionDisabled}
            onClick={primaryAction}
          >
            {busy ? (
              <span className="button-spinner" aria-hidden="true" />
            ) : (
              <span className="action-glyph" aria-hidden="true">
                {isRecording ? "■" : isPaused ? "●" : ready ? "↑" : "●"}
              </span>
            )}
            {busy ?? actionLabel}
          </button>
          {isRecording && (
            <button
              className="discard-action"
              type="button"
              disabled={Boolean(busy)}
              onClick={pause}
            >
              Pause
            </button>
          )}
          {isPaused && (
            <button
              className="discard-action"
              type="button"
              disabled={Boolean(busy)}
              onClick={stop}
            >
              Finish
            </button>
          )}
          {(isRecording ||
            isPaused ||
            ready ||
            status.state === "error" ||
            status.state === "interrupted") && (
            <button
              className="discard-action"
              type="button"
              disabled={Boolean(busy)}
              onClick={discard}
            >
              Discard
            </button>
          )}
        </div>
        {ready && !complete && !capabilities?.storageAvailable && (
          <p className="action-guidance">
            Connect a Savia server with recording storage enabled.
          </p>
        )}
        {connected &&
          capabilities?.storageAvailable &&
          !canUploadRecording(capabilities) && (
            <p className="action-guidance">
              This key cannot upload recordings. Connect with recordings:upload
              permission.
            </p>
          )}
        {ready && !complete && canUploadRecording(capabilities) && !consent && (
          <p className="action-guidance">
            Confirm permission to enable upload.
          </p>
        )}
        {connected && reviewHref && complete && (
          <a
            className="saved-link"
            href={reviewHref}
            target="_blank"
            rel="noreferrer"
            onClick={openSavia}
          >
            Review recording in Savia <span aria-hidden="true">↗</span>
          </a>
        )}
        <p className="privacy-line">
          No audio leaves this device until you choose Upload.
        </p>
        <p className="attribution-line">
          Savia — Desarrollado por Hefesoft SAS, Colombia.
        </p>
      </footer>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return String(error);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
