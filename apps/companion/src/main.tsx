import React, {
  useCallback,
  useEffect,
  useRef,
  useId,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import {
  apiOrigin as validateApiOrigin,
  companionRequest,
  canUploadRecording,
  native,
  type Capabilities,
  type CaptureStatus,
  type LocalMeeting,
  type Source,
} from "./client";
import {
  captureErrorMessage,
  localizedOperationError,
  operationErrorMessage,
  type LocalizedMessage,
} from "./capture-errors";
import {
  loadLocale,
  translate,
  defaultSessionName,
  isValidSessionName,
  type Locale,
  type MessageKey,
} from "./i18n";
import { ActionIcon } from "./action-icon";
import { MeetingPreview } from "./meeting-preview";
import { loadCredential, saveCredential } from "./credentials";
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

function HelpTooltip({ label, children }: { label: string; children: string }) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    above: boolean;
  } | null>(null);
  const show = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(270, window.innerWidth - 32);
    const above = window.innerHeight - rect.bottom < 120;
    setPosition({
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      top: above ? rect.top - 7 : rect.bottom + 7,
      above,
    });
  };
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
    };
  }, [position]);
  return (
    <span
      className="help-tooltip"
      onMouseEnter={show}
      onMouseLeave={() => setPosition(null)}
    >
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-describedby={position ? id : undefined}
        onFocus={show}
        onBlur={() => setPosition(null)}
        onClick={show}
      >
        <span aria-hidden="true">?</span>
      </button>
      {position &&
        createPortal(
          <span
            id={id}
            className="help-tooltip__content"
            role="tooltip"
            style={{
              left: position.left,
              top: position.top,
              transform: position.above ? "translateY(-100%)" : undefined,
            }}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}

function App() {
  const [status, setStatus] = useState(empty);
  const [meetings, setMeetings] = useState<LocalMeeting[]>([]);
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [apiOrigin, setApiOrigin] = useState(DEFAULT_API_ORIGIN);
  const [appOrigin, setAppOrigin] = useState(DEFAULT_APP_ORIGIN);
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [hasStored, setHasStored] = useState(false);
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
  const [diagnosticsFile, setDiagnosticsFile] = useState<string | null>(null);
  const [diagnosticsExportFailed, setDiagnosticsExportFailed] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [permissionLoaded, setPermissionLoaded] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [notice, setNotice] = useState<{
    message: LocalizedMessage;
    isError: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<LocalizedMessage | null>(null);
  const [locale, setLocale] = useState<Locale>(() => loadLocale());
  const [sessionName, setSessionName] = useState("");
  const sessionNameDirty = useRef(false);
  const meetingsRevision = useRef("");
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
  const message = (key: MessageKey, vars?: Record<string, string | number>) =>
    ({ key, vars }) satisfies LocalizedMessage;
  const changeLocale = (next: Locale) => setLocale(next);
  useEffect(() => {
    document.documentElement.lang = locale === "pt" ? "pt-BR" : locale;
  }, [locale]);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const mergeMeetings = useCallback((next: LocalMeeting[]) => {
    setMeetings((previous) =>
      next.map((meeting) => {
        const old = previous.find(
          (item) => item.sessionId === meeting.sessionId,
        );
        if (!old) return meeting;
        const sameChunks =
          old.chunks.length === meeting.chunks.length &&
          old.chunks.every((chunk, index) => {
            const other = meeting.chunks[index];
            return (
              chunk.source === other.source &&
              chunk.sequence === other.sequence &&
              chunk.startSeconds === other.startSeconds &&
              chunk.durationSeconds === other.durationSeconds &&
              chunk.bytes === other.bytes &&
              chunk.sampleRate === other.sampleRate
            );
          });
        return sameChunks ? { ...meeting, chunks: old.chunks } : meeting;
      }),
    );
  }, []);
  const refreshMeetings = useCallback(async () => {
    const next = await native<LocalMeeting[]>("meeting_list");
    if (!mounted.current) return;
    mergeMeetings(next);
  }, [mergeMeetings]);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let pollInFlight = false;
    const poll = async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const next = await native<CaptureStatus>("capture_status");
        if (!mounted.current) return;
        setStatus((previous) => {
          const sameChunks =
            previous.sessionId === next.sessionId &&
            (previous.chunks?.length ?? 0) === (next.chunks?.length ?? 0) &&
            (previous.chunks ?? []).every((chunk, index) => {
              const other = next.chunks?.[index];
              return (
                other !== undefined &&
                chunk.source === other.source &&
                chunk.sequence === other.sequence &&
                chunk.startSeconds === other.startSeconds &&
                chunk.durationSeconds === other.durationSeconds &&
                chunk.bytes === other.bytes &&
                chunk.sampleRate === other.sampleRate
              );
            });
          return sameChunks ? { ...next, chunks: previous.chunks } : next;
        });
        const revision = `${next.sessionId ?? ""}:${next.state}:${next.chunks?.length ?? 0}`;
        if (revision !== meetingsRevision.current) {
          meetingsRevision.current = revision;
          await refreshMeetings();
        }
      } catch (error) {
        if (mounted.current)
          setNotice({ message: operationErrorMessage(error), isError: true });
      } finally {
        pollInFlight = false;
      }
    };
    if (isTauri()) {
      void poll();
      timer = setInterval(() => void poll(), 1500);
    }
    return () => {
      mounted.current = false;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [refreshMeetings]);

  const selectedMeeting = meetings.find(
    (meeting) => meeting.sessionId === status.sessionId,
  );

  useEffect(() => {
    if (!status.sessionId) {
      setSessionName("");
      sessionNameDirty.current = false;
      return;
    }
    if (selectedMeeting && !sessionNameDirty.current) {
      setSessionName(selectedMeeting.name);
    } else if (!selectedMeeting && !sessionNameDirty.current) {
      setSessionName(defaultSessionName(locale));
    }
  }, [status.sessionId, selectedMeeting?.name, locale]);

  const run = async (label: LocalizedMessage, action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice({ message: operationErrorMessage(error), isError: true });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const start = () =>
    run(message("Starting recording"), async () => {
      const name = defaultSessionName(locale);
      const next = await native<CaptureStatus>("start_capture", {
        sessionId: crypto.randomUUID(),
        name,
        sources: { microphone: true, system: true },
      });
      setStatus(next);

      setConfirmRemoveId(null);
      sessionNameDirty.current = false;
      setSessionName(name);
      await refreshMeetings();
    });

  const stop = () =>
    run(message("Finalizing audio"), async () => {
      const next = await native<CaptureStatus>("stop_capture");
      setStatus(next);

      await refreshMeetings();
    });

  const pause = () =>
    run(message("Pause"), async () => {
      const next = await native<CaptureStatus>("pause_capture");
      setStatus(next);
    });

  const resume = () =>
    run(message("Resume recording"), async () => {
      const next = await native<CaptureStatus>("resume_capture");
      setStatus(next);
    });

  const selectMeeting = (meeting: LocalMeeting) =>
    run(message("Opening meeting"), async () => {
      if (isRecording || isPaused)
        throw new Error("Finish the active meeting before selecting another.");
      const next = await native<CaptureStatus>("meeting_select", {
        sessionId: meeting.sessionId,
      });
      setStatus(next);

      setConfirmRemoveId(null);
      sessionNameDirty.current = false;
      setSessionName(meeting.name);
    });

  const editMeeting = (meeting: LocalMeeting) =>
    run(message("Opening meeting"), async () => {
      if (meeting.sessionId !== status.sessionId) {
        setStatus(
          await native<CaptureStatus>("meeting_select", {
            sessionId: meeting.sessionId,
          }),
        );
      }
      sessionNameDirty.current = true;
      setSessionName(meeting.name);
      setEditingMeetingId(meeting.sessionId);
      setConfirmRemoveId(null);
    });
  const cancelNameEdit = () => {
    sessionNameDirty.current = false;
    setSessionName(selectedMeeting?.name ?? "");
    setEditingMeetingId(null);
  };
  const saveMeetingName = () =>
    run(message("Saving meeting name"), async () => {
      if (!editingMeetingId || !isValidSessionName(sessionName)) return;
      await native<void>("meeting_rename", {
        sessionId: editingMeetingId,
        name: sessionName.trim(),
      });
      setSessionName(sessionName.trim());
      sessionNameDirty.current = false;
      setEditingMeetingId(null);
      await refreshMeetings();
    });

  const removeMeeting = (meeting: LocalMeeting) =>
    run(message("Deleting meeting"), async () => {
      const next = await native<CaptureStatus>("meeting_remove", {
        sessionId: meeting.sessionId,
      });
      if (meeting.sessionId === status.sessionId) {
        setStatus(next);

        setSessionName("");
        sessionNameDirty.current = false;
      }
      setConfirmRemoveId(null);
      await refreshMeetings();
    });

  const connectWith = (origin: string, tok: string, save?: boolean) =>
    run(message("Checking connection"), async () => {
      // Normalize once so the stored credential matches what connected.
      const cleanOrigin = origin.trim();
      const cleanToken = tok.trim();
      setApiOrigin(cleanOrigin);
      setToken(cleanToken);
      const result = await companionRequest<Capabilities>(
        cleanOrigin,
        cleanToken,
        "capabilities",
      );
      setCapabilities(result);
      setNotice({
        message: message(
          result.storageAvailable
            ? "Connected to Savia."
            : "Connected, but private audio storage is unavailable on this server.",
        ),
        isError: false,
      });
      if (save === true) {
        try {
          await saveCredential({
            origin: cleanOrigin,
            token: cleanToken,
          });
          if (mounted.current) setHasStored(true);
        } catch {
          if (mounted.current) {
            setSettingsOpen(true);
            setNotice({
              message: message("Unable to save the credential on this device."),
              isError: true,
            });
          }
          return;
        }
      } else if (save === false) {
        try {
          await native<void>("credential_clear");
          if (mounted.current) setHasStored(false);
        } catch {
          // Keep the Forget action visible so a locked keychain can be
          // retried; the stored credential may still auto-reconnect.
          if (mounted.current) {
            setSettingsOpen(true);
            setNotice({
              message: message("Unable to forget the saved credential."),
              isError: true,
            });
          }
          return;
        }
      }
      if (mounted.current && result.storageAvailable) setSettingsOpen(false);
    });

  const connect = (event: FormEvent) => {
    event.preventDefault();
    void connectWith(apiOrigin, token, remember);
  };

  const forget = () =>
    run(message("Forget saved credential"), async () => {
      await native<void>("credential_clear");
      if (!mounted.current) return;
      setHasStored(false);
      setRemember(false);
    });

  // Saved OS-keychain credential: prefill and reconnect automatically.
  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const saved = await loadCredential();
        if (!mounted.current || !saved) return;
        setApiOrigin(saved.origin);
        setToken(saved.token);
        setRemember(true);
        setHasStored(true);
        // Reconnecting must not rewrite or delete the saved keychain entry.
        await connectWith(saved.origin, saved.token);
      } catch (error) {
        if (!mounted.current) return;
        // A locked or inaccessible keychain is not an empty keychain. Keep
        // remembering enabled so a manual reconnect cannot silently erase it.
        setRemember(true);
        setSettingsOpen(true);
        setNotice({ message: operationErrorMessage(error), isError: true });
      }
    })();
    // connectWith is stable for this bootstrap; run once on launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Export has its own state so it stays available during a stalled capture
  // or connection. Do not route it through the shared operation/busy gate.
  const exportDiagnostics = async () => {
    if (exportingDiagnostics) return;
    setExportingDiagnostics(true);
    setDiagnosticsExportFailed(false);
    setDiagnosticsFile(null);
    try {
      const path = await native<string>("diagnostics_export");
      if (mounted.current)
        setDiagnosticsFile(path.split(/[\\/]/).pop() ?? path);
    } catch {
      if (mounted.current) setDiagnosticsExportFailed(true);
    } finally {
      if (mounted.current) setExportingDiagnostics(false);
    }
  };

  const openSavia = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isTauri()) return;
    event.preventDefault();
    void run(message("Opening Savia"), async () => {
      const origin = validateApiOrigin(appOrigin);
      await native<void>("open_savia", { origin });
    });
  };

  const upload = (meeting: LocalMeeting) => {
    if (!consent) {
      setPermissionOpen(true);
      return;
    }
    return run(message("Uploading to Savia"), async () => {
      if (!canUploadRecording(capabilities) || !consent)
        throw localizedOperationError(
          "Connect storage and confirm permission before upload.",
        );
      if (!meeting.chunks.length)
        throw localizedOperationError(
          "No recoverable audio is available to upload.",
        );
      const meetingId = meeting.sessionId;
      const trimmedName = (
        meetingId === status.sessionId ? sessionName : meeting.name
      ).trim();
      if (meetingId !== status.sessionId) {
        const selected = await native<CaptureStatus>("meeting_select", {
          sessionId: meetingId,
        });
        setStatus(selected);
        setSessionName(meeting.name);
        sessionNameDirty.current = false;
      }
      if (!isValidSessionName(trimmedName))
        throw localizedOperationError(
          "No recoverable audio is available to upload.",
        );
      if (trimmedName !== meeting.name) {
        await native<void>("meeting_rename", {
          sessionId: meetingId,
          name: trimmedName,
        });
        sessionNameDirty.current = false;
      }
      const session = await companionRequest<{
        state: string;
        chunks: { source: string; sequence: number }[];
      }>(apiOrigin, token, "sessioncreate", {
        id: meetingId,
        name: trimmedName,
        sources: [...new Set(meeting.chunks.map((chunk) => chunk.source))],
        consent: true,
      });
      let uploaded = 0;
      for (const chunk of meeting.chunks) {
        if (
          !session.chunks.some(
            (saved) =>
              saved.source === chunk.source &&
              saved.sequence === chunk.sequence,
          )
        ) {
          const audio = await native<{ base64: string; format: "ogg" }>(
            "read_capture_chunk",
            {
              sessionId: meetingId,
              source: chunk.source,
              sequence: chunk.sequence,
            },
          );
          await companionRequest(apiOrigin, token, "sessionchunk", {
            sessionId: meetingId,
            payload: {
              source: chunk.source,
              sequence: chunk.sequence,
              startSeconds: chunk.startSeconds,
              audio: { data: audio.base64, format: audio.format },
            },
          });
        }
        uploaded++;
        setBusy(
          message("Upload progress", {
            uploaded,
            total: meeting.chunks.length,
          }),
        );
      }
      await companionRequest(apiOrigin, token, "sessionfinalize", {
        sessionId: meetingId,
        payload: {
          expectedChunks: meeting.chunks.length,
          durationSeconds: Math.min(
            3600,
            Math.max(
              ...meeting.chunks.map(
                (chunk) => chunk.startSeconds + chunk.durationSeconds,
              ),
            ),
          ),
        },
      });
      await native<void>("meeting_mark_uploaded", {
        sessionId: meetingId,
        origin: validateApiOrigin(apiOrigin),
      });
      await refreshMeetings();
      setNotice({
        message: message("Audio saved privately in Savia."),
        isError: false,
      });
    });
  };
  const changeConnection = (change: () => void) => {
    change();
    setCapabilities(null);

    setNotice(null);
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
  const currentApiOrigin = (() => {
    try {
      return validateApiOrigin(apiOrigin);
    } catch {
      return "";
    }
  })();
  const uploadedForCurrentOrigin = Boolean(
    selectedMeeting?.uploadedOrigin &&
    currentApiOrigin &&
    selectedMeeting.uploadedOrigin === currentApiOrigin,
  );
  const complete = ready && uploadedForCurrentOrigin;
  const selectedChunks = selectedMeeting?.chunks ?? status.chunks ?? [];
  const previewSources = [
    ...new Set(selectedChunks.map((chunk) => chunk.source)),
  ];
  const previewChunks = selectedChunks;
  const readPreviewChunk = useCallback(
    async (source: Source, sequence: number) => {
      if (!status.sessionId) throw new Error("Meeting is unavailable.");
      return native<{ base64Pcm: string; sampleRate: number }>(
        "read_preview_chunk",
        { sessionId: status.sessionId, source, sequence },
      );
    },
    [status.sessionId],
  );
  const reviewHref = recordingReviewHref(appOrigin);
  const trimmedSessionName = sessionName.trim();
  const sessionNameValid = isValidSessionName(trimmedSessionName);
  const actionDisabled = Boolean(busy);
  const primaryAction = () => (isRecording ? stop() : resume());
  const actionLabel = isRecording ? t("Stop recording") : t("Resume recording");
  useEffect(() => {
    if (!isTauri()) return;
    void native<boolean>("upload_permission_load")
      .then((accepted) => {
        if (!mounted.current) return;
        setConsent(accepted === true);
        setPermissionOpen(accepted !== true);
      })
      .catch(() => {
        if (mounted.current) setPermissionOpen(true);
      })
      .finally(() => {
        if (mounted.current) setPermissionLoaded(true);
      });
  }, []);
  const acceptPermission = () =>
    run(message("Accept and remember"), async () => {
      await native<void>("upload_permission_save", { accepted: true });
      setConsent(true);
      setPermissionOpen(false);
    });
  const reviewPermission = () =>
    run(message("Review permission notice"), async () => {
      await native<void>("upload_permission_save", { accepted: false });
      setConsent(false);
      setPermissionOpen(true);
    });

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
            {connected ? t("Connected") : t("Not connected")}
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
              {t("Open in Savia")} <span aria-hidden="true">↗</span>
            </a>
          )}
          <button
            className={`settings-toggle${settingsOpen ? " is-open" : ""}`}
            type="button"
            aria-expanded={settingsOpen}
            aria-controls="connection-settings"
            aria-label={
              settingsOpen
                ? t("Close connection settings")
                : t("Open connection settings")
            }
            title={t("Connection settings")}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M8.9 2.5h2.2l.45 1.75a6 6 0 0 1 1.18.69l1.73-.54 1.1 1.91-1.28 1.28c.14.5.2.98.2 1.46s-.06.97-.2 1.46l1.28 1.28-1.1 1.91-1.73-.54a6 6 0 0 1-1.18.69l-.45 1.75H8.9l-.45-1.75a6 6 0 0 1-1.18-.69l-1.73.54-1.1-1.91 1.28-1.28a5.4 5.4 0 0 1 0-2.92L4.44 6.31l1.1-1.91 1.73.54a6 6 0 0 1 1.18-.69L8.9 2.5Z" />
              <circle cx="10" cy="9.05" r="2.25" />
            </svg>
          </button>
        </div>
      </header>

      {permissionLoaded && permissionOpen && (
        <section
          className="permission-disclaimer"
          aria-labelledby="permission-title"
        >
          <h2 id="permission-title">{t("Recording and upload permission")}</h2>
          <p>{t("Permission disclaimer body")}</p>
          <div className="permission-actions">
            <button
              className="permission-accept"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void acceptPermission()}
            >
              {t("Accept and remember")}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => setPermissionOpen(false)}
            >
              {t("Not now")}
            </button>
          </div>
        </section>
      )}

      {settingsOpen && (
        <section
          className="settings-panel"
          id="connection-settings"
          aria-label={t("Connection settings")}
        >
          <div className="settings-heading">
            <div>
              <h2>{t("Connect to Savia")}</h2>
              <HelpTooltip label={t("More information")}>
                {t("Credentials stay in memory for this session.")}
              </HelpTooltip>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => setSettingsOpen(false)}
              aria-label={t("Close settings")}
            >
              <ActionIcon kind="close" />
            </button>
          </div>
          <form onSubmit={connect}>
            <fieldset className="settings-fields" disabled={Boolean(busy)}>
              <label>
                {t("Language")}
                <select
                  value={locale}
                  onChange={(event) =>
                    changeLocale(event.target.value as Locale)
                  }
                >
                  <option value="es">Español</option>
                  <option value="en">English</option>
                  <option value="pt">Português</option>
                </select>
              </label>
              <label>
                {t("API address")}
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
                {t("Savia API key or access token")}
                <input
                  type="password"
                  value={token}
                  onChange={(event) =>
                    changeConnection(() => setToken(event.target.value))
                  }
                  autoComplete="off"
                  placeholder={t("Paste your Savia credential")}
                />
              </label>
              <div className="settings-field">
                <div className="label-with-help">
                  <label htmlFor="savia-app-origin">
                    {t("Savia app address")}
                  </label>
                  <HelpTooltip label={t("Savia app address")}>
                    {t("Opens the private recording review page.")}
                  </HelpTooltip>
                </div>
                <input
                  id="savia-app-origin"
                  type="url"
                  value={appOrigin}
                  onChange={(event) => setAppOrigin(event.target.value)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="url"
                />
              </div>
              {isTauri() && (
                <>
                  <div className="remember-row">
                    <label className="remember-option">
                      <input
                        type="checkbox"
                        checked={remember}
                        disabled={Boolean(busy)}
                        onChange={(event) => setRemember(event.target.checked)}
                      />
                      <span>{t("Remember on this device")}</span>
                    </label>
                    <HelpTooltip label={t("More information")}>
                      {t("Stored in the system keychain.")}
                    </HelpTooltip>
                  </div>
                  {hasStored && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={Boolean(busy)}
                      onClick={() => void forget()}
                    >
                      {t("Forget saved credential")}
                    </button>
                  )}
                </>
              )}
              <button
                className="connect-button"
                type="submit"
                disabled={Boolean(busy) || !token.trim()}
              >
                {capabilities ? t("Reconnect") : t("Connect")}
              </button>
            </fieldset>
          </form>
          <button
            className="text-button permission-review"
            type="button"
            disabled={Boolean(busy) || !permissionLoaded}
            onClick={() => void reviewPermission()}
          >
            {t("Review permission notice")}
          </button>
          {isTauri() && (
            <div className="diagnostics-actions">
              <div className="label-with-help">
                <button
                  type="button"
                  className="text-button"
                  disabled={exportingDiagnostics}
                  onClick={() => void exportDiagnostics()}
                >
                  {t(
                    exportingDiagnostics
                      ? "Exporting diagnostics…"
                      : "Export diagnostic log",
                  )}
                </button>
                <HelpTooltip label={t("More information")}>
                  {t(
                    "Export a diagnostic log to Downloads to share with support. API keys and audio are excluded.",
                  )}
                </HelpTooltip>
              </div>
              {diagnosticsFile && (
                <p className="field-hint" role="status">
                  {t("Saved in Downloads: {filename}", {
                    filename: diagnosticsFile,
                  })}
                </p>
              )}
              {diagnosticsExportFailed && (
                <p className="notice is-error" role="alert">
                  {t("Unable to export diagnostics. Try again.")}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <main>
        <section
          className={`recording-stage${isRecording ? " is-recording" : ""}${isPaused ? " is-paused" : ""}`}
          aria-label={t("Recording status")}
        >
          <div className="stage-status" role="status" aria-live="polite">
            <span className="status-light" aria-hidden="true" />
            <span>
              {isRecording
                ? t("Recording")
                : isPaused
                  ? t("Paused")
                  : ready
                    ? complete
                      ? t("Uploaded to Savia")
                      : t("Ready to upload")
                    : status.state === "error" || status.state === "interrupted"
                      ? t("Capture needs attention")
                      : t("Ready to record")}
            </span>
          </div>
          {(isRecording || isPaused) && (
            <>
              <p
                className="timer"
                aria-label={t("Seconds recorded", { seconds })}
              >
                {duration}
                <span> / 01:00:00</span>
              </p>
              <div
                className="time-track"
                role="progressbar"
                aria-label={t("Recording time")}
                aria-valuemin={0}
                aria-valuemax={3600}
                aria-valuenow={Math.min(seconds, 3600)}
              >
                <span
                  style={{
                    transform: `scaleX(${Math.min(seconds / 3600, 1)})`,
                  }}
                />
              </div>
              <div className="stage-help">
                <HelpTooltip label={t("More information")}>
                  {isRecording
                    ? t("Recording stays on device")
                    : t(
                        "Recording is paused. Resume to keep adding to the same take.",
                      )}
                </HelpTooltip>
              </div>
            </>
          )}
          {(isRecording || isPaused) &&
            (status.activeSources?.length ?? 0) > 0 && (
              <ul
                className="captured-sources"
                aria-label={t("Active audio sources")}
              >
                {status.activeSources!.map((source) => (
                  <li key={source}>
                    <span>
                      {source === "microphone"
                        ? t("Microphone")
                        : t("System audio")}
                    </span>
                    <span>{t("Active")}</span>
                  </li>
                ))}
              </ul>
            )}
          {ready &&
            previewSources.length > 0 &&
            busy?.key !== "Starting recording" && (
              <ul className="captured-sources" aria-label={t("Captured audio")}>
                {previewSources.map((source) => (
                  <li key={source}>
                    <span>
                      {source === "microphone"
                        ? t("Microphone")
                        : t("System audio")}
                    </span>
                    <span>{t("Captured")}</span>
                  </li>
                ))}
              </ul>
            )}
          {ready && previewSources.length > 0 && (
            <div
              className="preview-panel"
              aria-label={t("Preview on this device before uploading")}
            >
              <div className="preview-panel__heading">
                <p className="preview-title">{t("Preview")}</p>
                <HelpTooltip label={t("More information")}>
                  {t("Preview on this device before uploading")}
                </HelpTooltip>
              </div>
              <MeetingPreview
                chunks={previewChunks}
                readChunk={readPreviewChunk}
                locale={locale}
              />
            </div>
          )}
          {status.recovered && (
            <p className="notice" role="status">
              {t("Recovered recording")}
            </p>
          )}
          {status.sourceWarnings?.map((warning) => (
            <p className="notice is-warning" role="status" key={warning.source}>
              {t(
                warning.source === "microphone"
                  ? "Microphone partial warning"
                  : "System audio partial warning",
              )}{" "}
              {t(captureErrorMessage(warning.errorCode).key)}
            </p>
          ))}
          {selectedMeeting?.error && (
            <p className="notice is-error" role="alert">
              {t("Meeting data unavailable")}
            </p>
          )}
          {status.error && (
            <p className="notice is-error" role="alert">
              {t(captureErrorMessage(status.errorCode).key)}
            </p>
          )}
          {notice && (
            <p
              className={`notice${notice.isError ? " is-error" : ""}`}
              role={notice.isError ? "alert" : "status"}
            >
              {t(notice.message.key, notice.message.vars)}
            </p>
          )}
          {!isTauri() && !notice && (
            <div className="stage-help preview-hint">
              <HelpTooltip label={t("More information")}>
                {t("Recording is available in the desktop app.")}
              </HelpTooltip>
            </div>
          )}
        </section>
      </main>

      <section className="meeting-library" aria-label={t("Local meetings")}>
        <div className="meeting-library__heading">
          <div>
            <h2>{t("Local meetings")}</h2>
            <HelpTooltip label={t("More information")}>
              {t("Local meetings help")}
            </HelpTooltip>
          </div>
          {!isRecording && !isPaused && (
            <button
              className="new-meeting-button icon-button"
              type="button"
              title={t("New meeting")}
              aria-label={t("New meeting")}
              disabled={
                !isTauri() || Boolean(busy) || Boolean(editingMeetingId)
              }
              onClick={() => void start()}
            >
              <ActionIcon kind="plus" />
            </button>
          )}
        </div>
        {meetings.length === 0 ? (
          <p className="meeting-library__empty">{t("No local meetings")}</p>
        ) : (
          <ul className="meeting-list">
            {meetings.map((meeting) => {
              const selected = meeting.sessionId === status.sessionId;
              const deleting = confirmRemoveId === meeting.sessionId;
              const originLabel = meeting.uploadedOrigin
                ? (() => {
                    try {
                      return new URL(meeting.uploadedOrigin).host;
                    } catch {
                      return meeting.uploadedOrigin;
                    }
                  })()
                : null;
              return (
                <li
                  key={meeting.sessionId}
                  className={`meeting-row${selected ? " is-selected" : ""}${meeting.state === "error" ? " has-error" : ""}`}
                >
                  <button
                    className="meeting-row__select"
                    type="button"
                    aria-label={`${t("Select meeting")}: ${meeting.name}`}
                    title={meeting.name}
                    aria-current={selected ? "true" : undefined}
                    disabled={
                      Boolean(busy) ||
                      Boolean(editingMeetingId) ||
                      isRecording ||
                      isPaused ||
                      meeting.state === "error" ||
                      selected
                    }
                    onClick={() => void selectMeeting(meeting)}
                  >
                    <span className="meeting-row__name">{meeting.name}</span>
                    <span className="meeting-row__meta">
                      {new Date(meeting.createdAtMs).toLocaleString(locale, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                      <span
                        className={`meeting-state meeting-state--${meeting.state}`}
                      >
                        {t(
                          meeting.state === "interrupted"
                            ? "Interrupted"
                            : meeting.state === "recording"
                              ? "Recording"
                              : meeting.state === "error"
                                ? "Unavailable"
                                : meeting.state === "ready"
                                  ? "Ready"
                                  : "Ready",
                        )}
                      </span>
                    </span>
                  </button>
                  {busy && selected && (
                    <span className="meeting-row__progress" role="status">
                      {t(busy.key, busy.vars)}
                    </span>
                  )}
                  {originLabel && (
                    <span
                      className="meeting-uploaded"
                      title={meeting.uploadedOrigin ?? undefined}
                    >
                      {t("Uploaded")} · {originLabel}
                    </span>
                  )}
                  {meeting.state === "error" && (
                    <span className="meeting-row__error">
                      {t("Meeting data unavailable")}
                    </span>
                  )}
                  {editingMeetingId === meeting.sessionId && (
                    <form
                      className="meeting-name-editor"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveMeetingName();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && !busy) {
                          event.preventDefault();
                          cancelNameEdit();
                        }
                      }}
                    >
                      <input
                        autoFocus
                        onFocus={(event) => event.currentTarget.select()}
                        aria-label={t("Session name")}
                        aria-invalid={!sessionNameValid}
                        value={sessionName}
                        onChange={(event) => setSessionName(event.target.value)}
                        maxLength={255}
                        disabled={Boolean(busy)}
                      />
                      <button
                        className="meeting-name-save icon-button"
                        type="submit"
                        title={t("Save name")}
                        aria-label={t("Save name")}
                        disabled={Boolean(busy) || !sessionNameValid}
                      >
                        <ActionIcon kind="check" />
                      </button>
                      <button
                        className="meeting-name-cancel icon-button"
                        type="button"
                        title={t("Cancel editing")}
                        aria-label={t("Cancel editing")}
                        disabled={Boolean(busy)}
                        onClick={cancelNameEdit}
                      >
                        <ActionIcon kind="close" />
                      </button>
                      {!sessionNameValid && (
                        <span className="meeting-name-error">
                          {t("Meeting name length")}
                        </span>
                      )}
                    </form>
                  )}
                  <div className="meeting-row__actions">
                    <button
                      className="meeting-row__edit icon-button"
                      type="button"
                      title={t("Edit meeting name")}
                      aria-label={`${t("Edit meeting name")}: ${meeting.name}`}
                      disabled={
                        Boolean(busy) ||
                        Boolean(editingMeetingId) ||
                        isRecording ||
                        isPaused ||
                        Boolean(meeting.error)
                      }
                      onClick={() => void editMeeting(meeting)}
                    >
                      <ActionIcon kind="edit" />
                    </button>
                    <button
                      className="meeting-row__upload icon-button"
                      type="button"
                      title={t(
                        meeting.uploadedOrigin === currentApiOrigin
                          ? "Uploaded"
                          : "Upload to Savia",
                      )}
                      aria-label={`${t(meeting.uploadedOrigin === currentApiOrigin ? "Uploaded" : "Upload to Savia")}: ${meeting.name}`}
                      disabled={
                        !permissionLoaded ||
                        Boolean(busy) ||
                        Boolean(editingMeetingId) ||
                        isRecording ||
                        isPaused ||
                        !canUploadRecording(capabilities) ||
                        Boolean(meeting.error) ||
                        !meeting.chunks.length ||
                        meeting.uploadedOrigin === currentApiOrigin ||
                        (selected && !sessionNameValid)
                      }
                      onClick={() => void upload(meeting)}
                    >
                      <ActionIcon
                        kind={
                          meeting.uploadedOrigin === currentApiOrigin
                            ? "check"
                            : "upload"
                        }
                      />
                    </button>
                    {!deleting ? (
                      <button
                        className="meeting-row__delete icon-button"
                        type="button"
                        title={t("Delete")}
                        aria-label={`${t("Delete")}: ${meeting.name}`}
                        disabled={
                          Boolean(busy) ||
                          Boolean(editingMeetingId) ||
                          (selected && (isRecording || isPaused))
                        }
                        onClick={() => setConfirmRemoveId(meeting.sessionId)}
                      >
                        <ActionIcon kind="delete" />
                      </button>
                    ) : (
                      <div
                        className="meeting-delete-confirm"
                        role="group"
                        aria-label={t("Confirm meeting deletion")}
                      >
                        <span>{t("Delete meeting consequence")}</span>
                        <button
                          type="button"
                          className="meeting-delete-confirm__confirm"
                          disabled={
                            Boolean(busy) ||
                            (selected && (isRecording || isPaused))
                          }
                          onClick={() => void removeMeeting(meeting)}
                        >
                          {t("Delete meeting")}
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          disabled={Boolean(busy)}
                          onClick={() => setConfirmRemoveId(null)}
                        >
                          {t("Keep meeting")}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="capture-dock">
        <div className="dock-actions">
          {(isRecording || isPaused) && (
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
                  {isRecording ? "■" : "●"}
                </span>
              )}
              {busy ? t(busy.key, busy.vars) : actionLabel}
            </button>
          )}
          {isRecording && (
            <button
              className="discard-action"
              type="button"
              disabled={Boolean(busy)}
              onClick={pause}
            >
              {t("Pause")}
            </button>
          )}
          {isPaused && (
            <button
              className="discard-action"
              type="button"
              disabled={Boolean(busy)}
              onClick={stop}
            >
              {t("Finish")}
            </button>
          )}
        </div>
        {ready && !complete && !capabilities?.storageAvailable && (
          <HelpTooltip label={t("More information")}>
            {t("Storage unavailable guidance")}
          </HelpTooltip>
        )}
        {connected &&
          capabilities?.storageAvailable &&
          !canUploadRecording(capabilities) && (
            <HelpTooltip label={t("More information")}>
              {t("Upload permission guidance")}
            </HelpTooltip>
          )}
        {ready && !complete && canUploadRecording(capabilities) && !consent && (
          <HelpTooltip label={t("More information")}>
            {t("Consent guidance")}
          </HelpTooltip>
        )}
        {connected && reviewHref && complete && (
          <a
            className="saved-link"
            href={reviewHref}
            target="_blank"
            rel="noreferrer"
            onClick={openSavia}
          >
            {t("Review recording in Savia")} <span aria-hidden="true">↗</span>
          </a>
        )}
        <p className="privacy-line">{t("Audio stays on device")}</p>
        <p className="attribution-line">{t("Attribution")}</p>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
