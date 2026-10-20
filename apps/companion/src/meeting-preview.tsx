import { ActionIcon } from "./action-icon";
import { useEffect, useMemo, useState } from "react";
import {
  createPreviewPlayer,
  type PreviewChunk,
  type PreviewSnapshot,
  type ReadPreviewChunk,
} from "./preview-player";

type Locale = "en" | "es" | "pt";

const labels: Record<
  Locale,
  {
    play: string;
    pause: string;
    playAria: string;
    pauseAria: string;
    error: string;
    progress: string;
  }
> = {
  en: {
    play: "Play",
    pause: "Pause",
    playAria: "Play meeting preview",
    pauseAria: "Pause meeting preview",
    error: "Audio preview is unavailable.",
    progress: "Meeting preview position",
  },
  es: {
    play: "Reproducir",
    pause: "Pausar",
    playAria: "Reproducir vista previa de la reunión",
    pauseAria: "Pausar vista previa de la reunión",
    error: "La vista previa de audio no está disponible.",
    progress: "Posición de la vista previa",
  },
  pt: {
    play: "Reproduzir",
    pause: "Pausar",
    playAria: "Reproduzir prévia da reunião",
    pauseAria: "Pausar prévia da reunião",
    error: "A prévia de áudio não está disponível.",
    progress: "Posição da prévia",
  },
};

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function MeetingPreview({
  chunks,
  readChunk,
  locale,
}: {
  chunks: readonly PreviewChunk[];
  readChunk: ReadPreviewChunk;
  locale: string;
}) {
  const language: Locale = locale.startsWith("es")
    ? "es"
    : locale.startsWith("pt")
      ? "pt"
      : "en";
  const text = labels[language];
  const player = useMemo(
    () => createPreviewPlayer(chunks, readChunk),
    [chunks, readChunk],
  );
  const [state, setState] = useState<PreviewSnapshot>(() =>
    player.getSnapshot(),
  );
  const [pendingSeek, setPendingSeek] = useState<number | undefined>();

  useEffect(() => {
    setState(player.getSnapshot());
    const unsubscribe = player.subscribe(setState);
    return () => {
      unsubscribe();
      player.dispose();
    };
  }, [player]);

  const commitSeek = () => {
    if (pendingSeek === undefined) return;
    void player.seek(pendingSeek);
    setPendingSeek(undefined);
  };
  const displayTime = pendingSeek ?? state.currentTime;

  return (
    <div className="meeting-preview" aria-label={text.progress}>
      <button
        type="button"
        className="meeting-preview__toggle"
        aria-label={state.isPlaying ? text.pauseAria : text.playAria}
        title={state.isPlaying ? text.pause : text.play}
        onClick={() => {
          if (state.isPlaying) player.pause();
          else void player.play();
        }}
      >
        <ActionIcon kind={state.isPlaying ? "pause" : "play"} />
      </button>
      <span className="meeting-preview__time" aria-live="off">
        {formatTime(displayTime)}
      </span>
      <input
        className="meeting-preview__seek"
        type="range"
        min={0}
        max={Math.max(state.duration, 0.1)}
        step={0.1}
        value={Math.min(displayTime, state.duration)}
        aria-label={text.progress}
        disabled={state.duration <= 0}
        onChange={(event) => setPendingSeek(Number(event.currentTarget.value))}
        onPointerUp={commitSeek}
        onKeyUp={commitSeek}
        onBlur={commitSeek}
      />
      <span className="meeting-preview__time">
        {formatTime(state.duration)}
      </span>
      {state.error && (
        <span className="meeting-preview__error" role="status">
          {text.error}
        </span>
      )}
    </div>
  );
}
