import { describe, expect, it } from "vitest";
import {
  buildPreviewSchedule,
  createPreviewPlayer,
  type PreviewAudioContext,
  type PreviewChunk,
} from "./preview-player";

class FakeAudioContext implements PreviewAudioContext {
  currentTime = 0;
  destination = {};
  closed = false;
  buffers: { frames: number; data: Float32Array }[] = [];
  sources: { starts: number[][]; stopped: boolean; buffer: unknown }[] = [];
  gains: number[] = [];

  async resume() {}
  async close() {
    this.closed = true;
  }
  createBuffer(_channels: number, frames: number, _rate: number) {
    const entry = { frames, data: new Float32Array(frames) };
    this.buffers.push(entry);
    return {
      duration: frames / 48_000,
      getChannelData: () => entry.data,
    };
  }
  createGain() {
    const gain = { value: 1 };
    this.gains.push(gain.value);
    return {
      gain,
      connect() {},
      disconnect() {},
    };
  }
  createBufferSource() {
    const entry = {
      starts: [] as number[][],
      stopped: false,
      buffer: null as null | ReturnType<FakeAudioContext["createBuffer"]>,
    };
    this.sources.push(entry);
    return {
      set buffer(value: ReturnType<FakeAudioContext["createBuffer"]> | null) {
        entry.buffer = value;
      },
      get buffer(): ReturnType<FakeAudioContext["createBuffer"]> | null {
        return entry.buffer;
      },
      onended: null as (() => void) | null,
      connect() {},
      disconnect() {},
      start(...args: number[]) {
        entry.starts.push(args);
      },
      stop() {
        entry.stopped = true;
      },
    };
  }
}

const chunk = (
  source: PreviewChunk["source"],
  sequence: number,
  startSeconds: number,
  durationSeconds: number,
): PreviewChunk => ({
  source,
  sequence,
  startSeconds,
  durationSeconds,
  bytes: 1_000,
});

const pcm = (frames: number) => {
  const bytes = new Uint8Array(frames * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < frames; i++)
    view.setInt16(i * 2, (i % 30_000) - 15_000, true);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
};

describe("combined meeting preview", () => {
  it("keeps non-zero and non-aligned source starts on one timeline", () => {
    expect(
      buildPreviewSchedule(
        [chunk("microphone", 0, 0.25, 2), chunk("system", 0, 1.125, 1)],
        0,
        4,
      ),
    ).toEqual([
      {
        source: "microphone",
        sequence: 0,
        timelineStart: 0.25,
        sourceOffset: 0,
        duration: 2,
        gain: 0.5,
      },
      {
        source: "system",
        sequence: 0,
        timelineStart: 1.125,
        sourceOffset: 0,
        duration: 1,
        gain: 0.5,
      },
    ]);
  });

  it("uses full gain for one source and half gain for mixed sources", () => {
    expect(
      buildPreviewSchedule([chunk("microphone", 0, 0, 2)], 0, 2)[0].gain,
    ).toBe(1);
    expect(
      buildPreviewSchedule(
        [chunk("microphone", 0, 0, 2), chunk("system", 0, 0, 2)],
        0,
        2,
      ).map((item) => item.gain),
    ).toEqual([0.5, 0.5]);
  });

  it("clips scheduled PCM to the bounded lookahead and seeks within a chunk", () => {
    const [scheduled] = buildPreviewSchedule(
      [chunk("microphone", 0, 0, 60)],
      12.5,
      32.5,
    );
    expect(scheduled).toMatchObject({
      timelineStart: 12.5,
      sourceOffset: 12.5,
      duration: 20,
    });
  });

  it("does not create audio from a read that finishes after pause", async () => {
    let resolveRead!: (value: {
      base64Pcm: string;
      sampleRate: number;
    }) => void;
    const context = new FakeAudioContext();
    const player = createPreviewPlayer(
      [chunk("microphone", 0, 0, 1)],
      () => new Promise((resolve) => (resolveRead = resolve)),
      { createAudioContext: () => context, lookaheadSeconds: 1 },
    );
    const pending = player.play();
    await Promise.resolve();
    player.pause();
    resolveRead({ base64Pcm: pcm(48_000), sampleRate: 48_000 });
    await pending;
    expect(context.sources).toHaveLength(0);
    expect(context.closed).toBe(true);
  });

  it("restarts on seek at the chosen offset and closes the previous context", async () => {
    const contexts: FakeAudioContext[] = [];
    const player = createPreviewPlayer(
      [chunk("microphone", 0, 0, 2)],
      async () => ({ base64Pcm: pcm(2 * 48_000), sampleRate: 48_000 }),
      {
        createAudioContext: () => {
          const context = new FakeAudioContext();
          contexts.push(context);
          return context;
        },
        lookaheadSeconds: 1,
      },
    );
    await player.play();
    await player.seek(1);
    expect(contexts[0].closed).toBe(true);
    expect(contexts[0].sources[0].stopped).toBe(true);
    expect(contexts[1].sources[0].starts[0]).toEqual([0, 0, 1]);
    expect(contexts[1].buffers[0].data[0]).toBeCloseTo(3_000 / 32_768);
    expect(player.getSnapshot()).toMatchObject({
      currentTime: 1,
      isPlaying: true,
    });
    player.dispose();
  });

  it("anchors playback after loading initial PCM so decoding latency does not trim the start", async () => {
    const context = new FakeAudioContext();
    const player = createPreviewPlayer(
      [chunk("microphone", 0, 0, 2)],
      async () => {
        context.currentTime = 1;
        return { base64Pcm: pcm(2 * 48_000), sampleRate: 48_000 };
      },
      { createAudioContext: () => context, lookaheadSeconds: 2 },
    );
    await player.play();
    expect(context.sources[0].starts[0]).toEqual([1, 0, 2]);
    expect(context.buffers[0].data[0]).toBeCloseTo(-15_000 / 32_768);
    player.dispose();
  });

  it("restarts playback from the beginning after seeking to the end", async () => {
    const context = new FakeAudioContext();
    const reads: number[] = [];
    const player = createPreviewPlayer(
      [chunk("microphone", 0, 0, 2)],
      async (_source, sequence) => {
        reads.push(sequence);
        return { base64Pcm: pcm(2 * 48_000), sampleRate: 48_000 };
      },
      { createAudioContext: () => context, lookaheadSeconds: 1 },
    );
    await player.seek(2);
    expect(player.getSnapshot().currentTime).toBe(2);
    await player.play();
    expect(reads).toEqual([0]);
    expect(player.getSnapshot()).toMatchObject({
      currentTime: 0,
      isPlaying: true,
    });
    player.dispose();
  });

  it("loads only the first lookahead instead of decoding the full meeting", async () => {
    const context = new FakeAudioContext();
    const chunks = Array.from({ length: 3 }, (_, sequence) =>
      chunk("microphone", sequence, sequence * 40, 40),
    );
    const reads: number[] = [];
    const player = createPreviewPlayer(
      chunks,
      async (_source, sequence) => {
        reads.push(sequence);
        return { base64Pcm: pcm(40 * 48_000), sampleRate: 48_000 };
      },
      { createAudioContext: () => context, lookaheadSeconds: 20 },
    );
    await player.play();
    expect(reads).toEqual([0]);
    expect(player.getSnapshot().error).toBe(false);
    expect(
      context.buffers.reduce((sum, buffer) => sum + buffer.frames, 0),
    ).toBe(20 * 48_000);
    player.dispose();
  });
});
