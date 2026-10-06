import { encodeWavMono16 } from "./wav-encoder";
import { MAX_RECORDING_BYTES } from "./client";

export const MAX_CAPTURE_SECONDS = 600;

export type CapturedTake = {
  blob: Blob;
  durationSeconds: number;
};

export type MicCaptureHandle = {
  stop: () => Promise<CapturedTake>;
  cancel: () => void;
  maximumSeconds: number;
};

type CaptureDeps = {
  mediaDevices?: MediaDevices;
  AudioContextCtor?: typeof AudioContext;
};

/**
 * Records the microphone into a WAV/PCM16 blob the Companion recordings API
 * accepts. Browser MediaRecorder outputs (WebM/Opus, MP4) are rejected by the
 * backend, so PCM is collected through the Web Audio graph and encoded here.
 */
export async function startMicCapture(
  options: {
    maxSeconds?: number;
    onTick?: (elapsedSeconds: number, maximumSeconds: number) => void;
    onAutoStop?: (take: CapturedTake) => void;
  } & CaptureDeps = {},
): Promise<MicCaptureHandle> {
  const {
    maxSeconds = MAX_CAPTURE_SECONDS,
    onTick,
    onAutoStop,
    mediaDevices = navigator.mediaDevices,
    AudioContextCtor = AudioContext,
  } = options;
  if (!mediaDevices?.getUserMedia || !AudioContextCtor)
    throw new Error("unsupported");
  let stream: MediaStream;
  try {
    stream = await mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    throw new Error("denied");
  }
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  const chunks: Float32Array[] = [];
  let stopped = false;
  let elapsed = 0;
  let frames = 0;
  let maxFrames = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let maximumSeconds = maxSeconds;
  let finish: (keep: boolean) => Promise<CapturedTake | null>;
  try {
    context = new AudioContextCtor();
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    const sampleRate = Math.floor(context.sampleRate);
    maximumSeconds = Math.min(
      maxSeconds,
      Math.floor((MAX_RECORDING_BYTES - 44) / (sampleRate * 2)),
    );
    maxFrames = maximumSeconds * sampleRate;
    const startedAt = Date.now();
    finish = async (keep: boolean): Promise<CapturedTake | null> => {
      if (stopped) return null;
      stopped = true;
      if (timer) clearInterval(timer);
      try {
        processor?.disconnect();
        source?.disconnect();
      } catch {
        // Nodes may already be disconnected; teardown continues below.
      }
      stream.getTracks().forEach((track) => track.stop());
      await context?.close().catch(() => {});
      if (!keep) return null;
      const durationSeconds = Math.max(
        0.1,
        Math.min(maximumSeconds, (Date.now() - startedAt) / 1000),
      );
      return {
        blob: new Blob([encodeWavMono16(chunks, sampleRate)], {
          type: "audio/wav",
        }),
        durationSeconds,
      };
    };
    processor.onaudioprocess = (event) => {
      if (stopped) return;
      const availableFrames = maxFrames - frames;
      const input = event.inputBuffer.getChannelData(0);
      const takeFrames = Math.min(availableFrames, input.length);
      if (takeFrames > 0) {
        chunks.push(new Float32Array(input.subarray(0, takeFrames)));
        frames += takeFrames;
      }
      if (frames >= maxFrames)
        void finish(true).then((take) => {
          if (take) onAutoStop?.(take);
        });
    };
    source.connect(processor);
    processor.connect(context.destination);
    timer = setInterval(() => {
      elapsed += 1;
      onTick?.(elapsed, maximumSeconds);
      if (elapsed >= maximumSeconds)
        void finish(true).then((take) => {
          if (take) onAutoStop?.(take);
        });
    }, 1000);
  } catch (error) {
    try {
      processor?.disconnect();
      source?.disconnect();
    } catch {
      // A partially connected audio graph still needs its tracks stopped.
    }
    stream.getTracks().forEach((track) => track.stop());
    await context?.close().catch(() => {});
    throw error;
  }
  return {
    stop: async () =>
      (await finish(true)) ?? { blob: new Blob(), durationSeconds: 0 },
    cancel: () => void finish(false),
    maximumSeconds,
  };
}

export function captureErrorKey(error: unknown): "denied" | "unsupported" {
  return error instanceof Error && error.message === "denied"
    ? "denied"
    : "unsupported";
}
