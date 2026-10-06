import { encodeWavMono16 } from "./wav-encoder";

export const MAX_CAPTURE_SECONDS = 600;

export type CapturedTake = {
  blob: Blob;
  durationSeconds: number;
};

export type MicCaptureHandle = {
  stop: () => Promise<CapturedTake>;
  cancel: () => void;
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
    onTick?: (elapsedSeconds: number) => void;
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
  const context = new AudioContextCtor();
  const chunks: Float32Array[] = [];
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  let stopped = false;
  let elapsed = 0;
  const startedAt = Date.now();
  const finish = async (keep: boolean): Promise<CapturedTake | null> => {
    if (stopped) return null;
    stopped = true;
    clearInterval(timer);
    try {
      processor.disconnect();
      source.disconnect();
    } catch {
      // Nodes may already be disconnected; teardown continues below.
    }
    stream.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => {});
    if (!keep) return null;
    const durationSeconds = Math.max(
      0.1,
      Math.min(maxSeconds, (Date.now() - startedAt) / 1000),
    );
    return {
      blob: new Blob([encodeWavMono16(chunks, context.sampleRate)], {
        type: "audio/wav",
      }),
      durationSeconds,
    };
  };
  processor.onaudioprocess = (event) => {
    if (stopped) return;
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(context.destination);
  const timer = setInterval(() => {
    elapsed += 1;
    onTick?.(elapsed);
    if (elapsed >= maxSeconds)
      void finish(true).then((take) => {
        if (take) onAutoStop?.(take);
      });
  }, 1000);
  return {
    stop: async () =>
      (await finish(true)) ?? { blob: new Blob(), durationSeconds: 0 },
    cancel: () => void finish(false),
  };
}

export function captureErrorKey(error: unknown): "denied" | "unsupported" {
  return error instanceof Error && error.message === "denied"
    ? "denied"
    : "unsupported";
}
