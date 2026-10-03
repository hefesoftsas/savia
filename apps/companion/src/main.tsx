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
  type SavedRecording,
  type Source,
} from "./client";
import "./styles.css";

const empty: CaptureStatus = {
  state: "idle",
  elapsedSeconds: 0,
  tracks: [],
  error: null,
};
const DEFAULT_API_ORIGIN = "http://127.0.0.1:8787";
const DEFAULT_APP_ORIGIN = "http://127.0.0.1:5173";

function recordingReviewHref(value: string): string | null {
  try {
    return `${validateApiOrigin(value)}/#/companion-recordings`;
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
  const [savedSources, setSavedSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const recordingIds = useRef<Partial<Record<Source, string>>>({});
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!isTauri()) return;
    const poll = async () => {
      try {
        const next = await native<CaptureStatus>("capture_status");
        if (mounted.current) setStatus(next);
      } catch (error) {
        if (mounted.current) setNotice(errorMessage(error));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
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
      const next = await native<CaptureStatus>("start_capture", {
        sources: { microphone, system },
      });
      setStatus(next);
      setConsent(false);
      setSavedSources([]);
      recordingIds.current = {};
    });

  const stop = () =>
    run("Finalizing audio", async () => {
      const next = await native<CaptureStatus>("stop_capture");
      setStatus(next);
      setConsent(false);
      setSavedSources([]);
    });

  const discard = () =>
    run("Discarding audio", async () => {
      setStatus(await native<CaptureStatus>("discard_capture"));
      setConsent(false);
      setSavedSources([]);
      setNotice("");
      setNoticeIsError(false);
      recordingIds.current = {};
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
      const completed = [...savedSources];
      for (const track of status.tracks) {
        if (completed.includes(track.source)) continue;
        const audio = await native<{ base64: string; format: "ogg" }>(
          "read_capture",
          { source: track.source },
        );
        const id = (recordingIds.current[track.source] ??= crypto.randomUUID());
        await companionRequest<SavedRecording>(apiOrigin, token, "save", {
          id,
          source: track.source,
          audio: { data: audio.base64, format: audio.format },
          consent: true,
        });
        completed.push(track.source);
        setSavedSources([...completed]);
      }
      setNotice("Audio saved privately in Savia.");
    });

  const changeConnection = (change: () => void) => {
    change();
    setCapabilities(null);
    setConsent(false);
    setSavedSources([]);
    setNotice("");
    setNoticeIsError(false);
  };

  const seconds = Math.floor(status.elapsedSeconds);
  const duration = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  const ready = status.state === "ready";
  const connected = Boolean(capabilities);
  const complete =
    ready &&
    status.tracks.length > 0 &&
    savedSources.length === status.tracks.length;
  const selectedSources = microphone || system;
  const reviewHref = recordingReviewHref(appOrigin);
  const locked = Boolean(busy) || status.state === "recording";
  const actionDisabled =
    Boolean(busy) ||
    (status.state === "recording"
      ? false
      : ready
        ? complete || !canUploadRecording(capabilities) || !consent
        : !isTauri() || !selectedSources);

  const primaryAction = () => {
    if (status.state === "recording") return stop();
    if (ready) return upload();
    return start();
  };

  const actionLabel =
    status.state === "recording"
      ? "Stop recording"
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
          className={`recording-stage${status.state === "recording" ? " is-recording" : ""}`}
          aria-label="Recording status"
        >
          <div className="stage-status" role="status" aria-live="polite">
            <span className="status-light" aria-hidden="true" />
            <span>
              {status.state === "recording"
                ? "Recording"
                : ready
                  ? complete
                    ? "Saved to Savia"
                    : "Ready to upload"
                  : status.state === "error"
                    ? "Capture needs attention"
                    : "Ready to record"}
            </span>
          </div>
          <p className="timer" aria-label={`${seconds} seconds recorded`}>
            {duration}
            <span> / 01:00</span>
          </p>
          <div
            className="time-track"
            role="progressbar"
            aria-label="Recording time"
            aria-valuemin={0}
            aria-valuemax={60}
            aria-valuenow={Math.min(seconds, 60)}
          >
            <span
              style={{ transform: `scaleX(${Math.min(seconds / 60, 1)})` }}
            />
          </div>
          <p className="stage-hint">
            {status.state === "recording"
              ? "Your audio stays on this device until you upload it."
              : ready
                ? "Check the captured sources, then upload when ready."
                : status.state === "error"
                  ? "Review the message below, then try another recording."
                  : "Capture up to 60 seconds from your selected sources."}
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
              I have permission to record and store this sample in Savia.
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
                {status.state === "recording" ? "■" : ready ? "↑" : "●"}
              </span>
            )}
            {busy ?? actionLabel}
          </button>
          {(status.state === "recording" ||
            ready ||
            status.state === "error") && (
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
