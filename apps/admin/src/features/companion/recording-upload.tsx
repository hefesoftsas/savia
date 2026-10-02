import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n/core";
import { companionMessages } from "@/i18n/locales/companion";
import {
  audioFormat,
  MAX_RECORDING_BYTES,
  type CompanionRecordingsClient,
  type ConnectedDrive,
  type DriveAudioFile,
  type DriveProvider,
  type Recording,
} from "./client";

export function RecordingUpload({
  client,
  onSaved,
  onClose,
  onBusy,
}: {
  client: CompanionRecordingsClient;
  onSaved: (recording: Recording) => void;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const t = useMessages(companionMessages);
  const [drives, setDrives] = useState<ConnectedDrive[]>([]);
  const [source, setSource] = useState<"local" | DriveProvider>("local");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<DriveAudioFile[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [driveError, setDriveError] = useState(false);
  const mounted = useRef(true),
    inFlight = useRef(false),
    searchVersion = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const loadDrives = async () => {
      try {
        const result = await client.connectedDrives();
        if (mounted.current) {
          setDrives(result);
          setDriveError(false);
        }
      } catch {
        if (mounted.current) setDriveError(true);
      }
    };
    void loadDrives();
    window.addEventListener("savia:personal-integrations-changed", loadDrives);
    return () => {
      mounted.current = false;
      searchVersion.current++;
      window.removeEventListener(
        "savia:personal-integrations-changed",
        loadDrives,
      );
    };
  }, [client]);
  const save = async (action: () => Promise<Recording>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const recording = await action();
      if (mounted.current) onSaved(recording);
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : t("Unable to upload the recording. Try again."),
        );
    } finally {
      inFlight.current = false;
      onBusy(false);
      if (mounted.current) setBusy(false);
    }
  };
  const search = async () => {
    if (source === "local" || !query.trim() || searching) return;
    const version = ++searchVersion.current;
    setSearching(true);
    setError("");
    setFiles([]);
    setSearched(false);
    try {
      const result = await client.searchFiles(source, query.trim());
      if (mounted.current && version === searchVersion.current) {
        setFiles(result);
        setSearched(true);
      }
    } catch (e) {
      if (mounted.current && version === searchVersion.current)
        setError(
          e instanceof Error
            ? e.message
            : t("Unable to search audio files. Try again."),
        );
    } finally {
      if (mounted.current && version === searchVersion.current)
        setSearching(false);
    }
  };
  return (
    <section aria-label={t("Upload recording")} className="mb-6 border-b pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">{t("Upload recording")}</h2>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          {t("Close")}
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("MP3, WAV, M4A or OGG/Opus · Up to 50 MB. Private to your account.")}
      </p>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-2 text-sm font-medium">
          {t("Source")}
          <select
            className="h-9 max-w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring sm:max-w-80"
            value={source}
            disabled={busy}
            onChange={(e) => {
              searchVersion.current++;
              setSource(e.target.value as typeof source);
              setFiles([]);
              setSearched(false);
              setSearching(false);
              setError("");
            }}
          >
            <option value="local">{t("Local disk")}</option>
            {drives.map((drive) => (
              <option key={drive.provider} value={drive.provider}>
                {drive.label}
              </option>
            ))}
          </select>
        </label>
        {source === "local" ? (
          <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
            {t("Audio file")}
            <input
              className="max-w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-secondary-foreground focus-visible:outline-2 focus-visible:outline-ring"
              type="file"
              accept=".mp3,.wav,.m4a,.ogg,.opus,.oga,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/opus"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (
                  !audioFormat(file.name) ||
                  !file.size ||
                  file.size > MAX_RECORDING_BYTES
                ) {
                  setError(t("Choose an audio file up to 50 MB."));
                  return;
                }
                void save(() => client.upload(file));
              }}
            />
          </label>
        ) : (
          <form
            className="flex min-w-0 flex-1 flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">
              {t("Search audio files")}
              <input
                className="h-9 rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                maxLength={100}
                value={query}
                disabled={busy || searching}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <Button
              type="submit"
              variant="outline"
              disabled={busy || searching || !query.trim()}
            >
              {t(searching ? "Searching…" : "Search")}
            </Button>
          </form>
        )}
      </div>
      {driveError && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("Cloud connections could not be loaded. Local disk is available.")}
        </p>
      )}
      {!driveError && !drives.length && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t(
            "Connect Google Drive or OneDrive in Personal integrations to import cloud audio.",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          {t("Uploading recording…")}
        </p>
      )}
      {searched && !files.length && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {t("No audio files found. Try another filename.")}
        </p>
      )}
      {files.length > 0 && (
        <ul className="mt-4 divide-y">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between gap-4 py-3 text-sm"
            >
              <span className="min-w-0 break-words">{file.name}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || searching}
                aria-label={`${t("Import")} ${file.name}`}
                onClick={() => {
                  if (source !== "local")
                    void save(() => client.importFile(source, file.id));
                }}
              >
                {t("Import")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
