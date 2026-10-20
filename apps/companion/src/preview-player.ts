export type PreviewSource = "microphone" | "system";

export type PreviewChunk = {
  source: PreviewSource;
  sequence: number;
  startSeconds: number;
  durationSeconds: number;
  /** Compressed Ogg bytes from the bounded native manifest. */
  bytes: number;
};

export type PreviewPcmData = { base64Pcm: string; sampleRate: number };
export type ReadPreviewChunk = (
  source: PreviewSource,
  sequence: number,
) => Promise<PreviewPcmData>;

export type PreviewScheduleItem = {
  source: PreviewSource;
  sequence: number;
  timelineStart: number;
  sourceOffset: number;
  duration: number;
  gain: number;
};

export type PreviewAudioBuffer = {
  duration: number;
  getChannelData(channel: number): Float32Array;
};

export type PreviewGainNode = {
  gain: { value: number };
  connect(destination: unknown): void;
  disconnect(): void;
};

export type PreviewBufferSource = {
  buffer: PreviewAudioBuffer | null;
  onended: (() => void) | null;
  connect(destination: unknown): void;
  disconnect(): void;
  start(when?: number, offset?: number, duration?: number): void;
  stop(): void;
};

export type PreviewAudioContext = {
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createBuffer(
    channels: number,
    length: number,
    sampleRate: number,
  ): PreviewAudioBuffer;
  createBufferSource(): PreviewBufferSource;
  createGain(): PreviewGainNode;
};

export type PreviewSnapshot = {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  error: boolean;
};

export type PreviewPlayer = {
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): Promise<void>;
  dispose(): void;
  getSnapshot(): PreviewSnapshot;
  subscribe(listener: (snapshot: PreviewSnapshot) => void): () => void;
};

export const PREVIEW_LOOKAHEAD_SECONDS = 20;
const RATE = 48_000;
const MAX_CHUNK_SECONDS = 60.001;
const MAX_OGG_BYTES = 512 * 1024;
const PCM_DURATION_TOLERANCE_SECONDS = 0.05;

const invalidManifest = () => new Error("Captured audio manifest is invalid.");
const invalidPcm = () =>
  new Error("Captured audio is unavailable for preview.");

function isBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  let padding = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 61) {
      padding++;
      if (padding > 2 || index < value.length - 2) return false;
    } else if (
      padding ||
      !(
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        code === 43 ||
        code === 47
      )
    ) {
      return false;
    }
  }
  return value.length > 0;
}

function validateChunks(chunks: readonly PreviewChunk[]): number {
  if (!chunks.length)
    throw new Error("There is no captured audio to preview yet.");
  const nextSequence: Record<PreviewSource, number> = {
    microphone: 0,
    system: 0,
  };
  const sourceEnds: Record<PreviewSource, number> = {
    microphone: 0,
    system: 0,
  };
  let duration = 0;
  for (const chunk of chunks) {
    if (
      (chunk.source !== "microphone" && chunk.source !== "system") ||
      !Number.isSafeInteger(chunk.sequence) ||
      chunk.sequence !== nextSequence[chunk.source] ||
      !Number.isFinite(chunk.startSeconds) ||
      chunk.startSeconds < 0 ||
      !Number.isFinite(chunk.durationSeconds) ||
      chunk.durationSeconds <= 0 ||
      chunk.durationSeconds > MAX_CHUNK_SECONDS ||
      !Number.isSafeInteger(chunk.bytes) ||
      chunk.bytes <= 0 ||
      chunk.bytes > MAX_OGG_BYTES ||
      chunk.startSeconds < sourceEnds[chunk.source] - 0.001
    )
      throw invalidManifest();
    const end = chunk.startSeconds + chunk.durationSeconds;
    if (!Number.isFinite(end) || end > 3_600.001) throw invalidManifest();
    nextSequence[chunk.source]++;
    sourceEnds[chunk.source] = end;
    duration = Math.max(duration, end);
  }
  return duration;
}

/** Build clipped items for one timeline window without loading PCM. */
export function buildPreviewSchedule(
  chunks: readonly PreviewChunk[],
  windowStart: number,
  windowEnd: number,
): PreviewScheduleItem[] {
  if (
    !Number.isFinite(windowStart) ||
    !Number.isFinite(windowEnd) ||
    windowStart < 0 ||
    windowEnd < windowStart
  )
    throw invalidManifest();
  const duration = validateChunks(chunks);
  const mixed = new Set(chunks.map((chunk) => chunk.source)).size > 1;
  const end = Math.min(windowEnd, duration);
  return chunks.flatMap((chunk) => {
    const chunkEnd = chunk.startSeconds + chunk.durationSeconds;
    const timelineStart = Math.max(windowStart, chunk.startSeconds);
    const clippedEnd = Math.min(end, chunkEnd);
    if (timelineStart >= clippedEnd) return [];
    return [
      {
        source: chunk.source,
        sequence: chunk.sequence,
        timelineStart,
        sourceOffset: timelineStart - chunk.startSeconds,
        duration: clippedEnd - timelineStart,
        gain: mixed ? 0.5 : 1,
      },
    ];
  });
}

function decodePcm(data: PreviewPcmData, durationSeconds: number): Int16Array {
  if (data?.sampleRate !== RATE || typeof data.base64Pcm !== "string")
    throw invalidPcm();
  const encoded = data.base64Pcm;
  if (
    encoded.length === 0 ||
    encoded.length > Math.ceil((RATE * MAX_CHUNK_SECONDS * 2) / 3) * 4 ||
    !isBase64(encoded)
  )
    throw invalidPcm();
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw invalidPcm();
  }
  if (binary.length === 0 || binary.length % 2 !== 0) throw invalidPcm();
  const pcm = new Int16Array(binary.length / 2);
  const view = new DataView(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer,
  );
  for (let index = 0; index < pcm.length; index++)
    pcm[index] = view.getInt16(index * 2, true);
  if (
    Math.abs(pcm.length / RATE - durationSeconds) >
    PCM_DURATION_TOLERANCE_SECONDS
  )
    throw invalidPcm();
  return pcm;
}

function defaultAudioContext(): PreviewAudioContext {
  if (typeof AudioContext === "undefined") throw new Error("audio-unavailable");
  return new AudioContext() as unknown as PreviewAudioContext;
}

export function createPreviewPlayer(
  chunks: readonly PreviewChunk[],
  readChunk: ReadPreviewChunk,
  options: {
    createAudioContext?: () => PreviewAudioContext;
    lookaheadSeconds?: number;
  } = {},
): PreviewPlayer {
  const duration = validateChunks(chunks);
  const lookahead = Math.max(
    1,
    Math.min(60, options.lookaheadSeconds ?? PREVIEW_LOOKAHEAD_SECONDS),
  );
  const createContext = options.createAudioContext ?? defaultAudioContext;
  const listeners = new Set<(snapshot: PreviewSnapshot) => void>();
  const nodes = new Set<PreviewBufferSource>();
  let position = 0;
  let context: PreviewAudioContext | undefined;
  let baseContextTime = 0;
  let playing = false;
  let disposed = false;
  let failed = false;
  let scheduledUntil = 0;
  let generation = 0;
  let loading = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const getPosition = () =>
    context && playing
      ? Math.min(duration, Math.max(0, context.currentTime - baseContextTime))
      : position;
  const snapshot = (): PreviewSnapshot => ({
    currentTime: getPosition(),
    duration,
    isPlaying: playing,
    error: failed,
  });
  const emit = () => {
    const value = snapshot();
    for (const listener of listeners) listener(value);
  };
  const clearNodes = () => {
    for (const node of nodes) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        // Nodes which already ended cannot be stopped again.
      }
      try {
        node.disconnect();
      } catch {
        // A disconnected node has no remaining audio resources.
      }
      node.buffer = null;
    }
    nodes.clear();
  };
  const stop = (keepPosition: boolean) => {
    generation++;
    if (keepPosition) position = getPosition();
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    playing = false;
    loading = false;
    scheduledUntil = position;
    clearNodes();
    const oldContext = context;
    context = undefined;
    if (oldContext) void oldContext.close().catch(() => undefined);
    emit();
  };
  const fail = () => {
    failed = true;
    stop(true);
    emit();
  };

  const scheduleWindow = async (
    targetEnd: number,
    token: number,
    anchorAfterLoad = false,
  ) => {
    if (!context || !playing || loading || token !== generation) return;
    const ctx = context;
    const start = scheduledUntil;
    const end = Math.min(duration, targetEnd);
    if (end <= start) return;
    loading = true;
    try {
      const items = buildPreviewSchedule(chunks, start, end);
      const prepared: { item: PreviewScheduleItem; pcm: Int16Array }[] = [];
      for (const item of items) {
        const data = await readChunk(item.source, item.sequence);
        if (token !== generation || !playing || context !== ctx) return;
        const pcm = decodePcm(
          data,
          chunks.find(
            (chunk) =>
              chunk.source === item.source && chunk.sequence === item.sequence,
          )!.durationSeconds,
        );
        prepared.push({ item, pcm });
      }
      // The first window is read from native storage before its clock origin is
      // fixed. This keeps slow bounded decoding from consuming the recording's
      // first samples or shifting its timeline.
      if (anchorAfterLoad) baseContextTime = ctx.currentTime - position;

      for (const { item, pcm } of prepared) {
        const frames = Math.round(item.duration * RATE);
        const sourceOffsetFrames = Math.round(item.sourceOffset * RATE);
        if (
          frames <= 0 ||
          sourceOffsetFrames + frames >
            pcm.length + Math.round(RATE * PCM_DURATION_TOLERANCE_SECONDS)
        )
          throw invalidPcm();
        const intendedStart = baseContextTime + item.timelineStart;
        const lateBy = Math.max(0, ctx.currentTime - intendedStart);
        if (lateBy >= item.duration) continue;
        const buffer = ctx.createBuffer(1, frames, RATE);
        const samples = buffer.getChannelData(0);
        const viewLength = Math.min(frames, pcm.length - sourceOffsetFrames);
        for (let frame = 0; frame < viewLength; frame++)
          samples[frame] = pcm[sourceOffsetFrames + frame] / 32768;
        const gain = ctx.createGain();
        gain.gain.value = item.gain;
        gain.connect(ctx.destination);
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(gain);
        nodes.add(node);
        node.onended = () => {
          nodes.delete(node);
          node.disconnect();
          gain.disconnect();
          node.buffer = null;
        };
        const offset = lateBy;
        const remaining = Math.max(0, item.duration - lateBy);
        if (remaining > 0)
          node.start(
            Math.max(ctx.currentTime, intendedStart),
            offset,
            remaining,
          );
      }
      scheduledUntil = end;
    } catch {
      if (token === generation) fail();
    } finally {
      if (token === generation) loading = false;
    }
  };

  const tick = () => {
    if (!playing || !context) return;
    position = getPosition();
    if (position >= duration) {
      position = duration;
      stop(false);
      emit();
      return;
    }
    if (scheduledUntil < Math.min(duration, position + lookahead / 2))
      void scheduleWindow(position + lookahead, generation);
    emit();
  };

  const play = async () => {
    if (disposed || playing || duration <= 0) return;
    if (position >= duration) {
      position = 0;
      emit();
    }
    failed = false;
    const token = ++generation;
    try {
      const ctx = createContext();
      context = ctx;
      await ctx.resume();
      if (disposed || token !== generation || context !== ctx) {
        await ctx.close();
        return;
      }
      playing = true;
      baseContextTime = ctx.currentTime - position;
      scheduledUntil = position;
      await scheduleWindow(position + lookahead, token, true);
      if (disposed || token !== generation || !playing) return;
      timer = setInterval(tick, 100);
      emit();
    } catch {
      if (token === generation) fail();
    }
  };

  return {
    play,
    pause() {
      if (playing || context) stop(true);
    },
    async seek(seconds) {
      if (disposed || !Number.isFinite(seconds)) return;
      const wasPlaying = playing;
      if (wasPlaying || context) stop(true);
      position = Math.max(0, Math.min(duration, seconds));
      failed = false;
      emit();
      if (wasPlaying && position < duration) await play();
    },
    dispose() {
      if (disposed) return;
      stop(true);
      disposed = true;
      listeners.clear();
    },
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
