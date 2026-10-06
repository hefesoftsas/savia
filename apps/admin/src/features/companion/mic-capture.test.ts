import { expect, it, vi } from "vitest";
import { MAX_RECORDING_BYTES } from "./client";
import { startMicCapture } from "./mic-capture";

function captureHarness(
  createMediaStreamSource: () => {
    connect: () => void;
    disconnect: () => void;
  },
) {
  const stop = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  const stream = { getTracks: () => [{ stop }] };
  class FakeAudioContext {
    sampleRate = 48_000;
    destination = {};
    close = close;
    createMediaStreamSource = createMediaStreamSource;
    createScriptProcessor = () => ({
      onaudioprocess: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  }
  const mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue(stream),
  };
  return {
    stop,
    close,
    mediaDevices: mediaDevices as unknown as MediaDevices,
    AudioContextCtor: FakeAudioContext as unknown as typeof AudioContext,
  };
}

it("limits PCM capture to the WAV upload byte cap at the actual sample rate", async () => {
  const harness = captureHarness(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  const capture = await startMicCapture(harness);

  expect(capture.maximumSeconds).toBe(
    Math.floor((MAX_RECORDING_BYTES - 44) / (48_000 * 2)),
  );
  expect(44 + capture.maximumSeconds * 48_000 * 2).toBeLessThanOrEqual(
    MAX_RECORDING_BYTES,
  );

  capture.cancel();
  await vi.waitFor(() => expect(harness.close).toHaveBeenCalledOnce());
});

it("stops tracks and closes the context when audio graph setup throws", async () => {
  const failure = new Error("audio graph setup failed");
  const harness = captureHarness(() => {
    throw failure;
  });

  await expect(startMicCapture(harness)).rejects.toBe(failure);
  expect(harness.stop).toHaveBeenCalledOnce();
  expect(harness.close).toHaveBeenCalledOnce();
});
