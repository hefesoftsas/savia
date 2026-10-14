import { expect, it, vi } from "vitest";
import { ApiClient } from "@/api/api-client";
import { RequestTimeoutError } from "@/api/request-timeout";
import { CompanionSessionsClient } from "./sessions-client";

it("gives full audio requests a longer timeout than individual chunks", async () => {
  vi.useFakeTimers();
  try {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error("Expected a request abort signal");
          signals.push(signal);
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const api = new ApiClient({
      baseUrl: "https://savia.test",
      tokenSource: { getAccessToken: async () => "access-token" },
      fetcher,
    });
    const client = new CompanionSessionsClient(api);

    const fullAudio = client.fullAudio("session-1", "system").then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(fullAudio).resolves.toBeInstanceOf(RequestTimeoutError);

    const chunkAudio = client
      .audio("session-1", {
        source: "system",
        sequence: 0,
        startSeconds: 0,
        durationSeconds: 30,
        bytes: 100,
        format: "ogg",
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    await vi.advanceTimersByTimeAsync(14_999);
    expect(signals[1]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(chunkAudio).resolves.toBeInstanceOf(RequestTimeoutError);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps the full-audio timeout active while reading the response body", async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(init.signal?.reason),
                { once: true },
              );
            },
          }),
        ),
      ),
    );
    const api = new ApiClient({
      baseUrl: "https://savia.test",
      tokenSource: { getAccessToken: async () => "access-token" },
      fetcher,
    });
    const client = new CompanionSessionsClient(api);
    let settled = false;
    const fullAudio = client
      .fullAudio("session-1", "system")
      .then(
        () => null,
        (error: unknown) => error,
      )
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(settled).toBe(true);
    await expect(fullAudio).resolves.toBeInstanceOf(RequestTimeoutError);
  } finally {
    vi.useRealTimers();
  }
});

it("archives every original format and sequence without changing binary bytes", async () => {
  const client = new CompanionSessionsClient(
    new ApiClient({
      baseUrl: "https://savia.test",
      tokenSource: { getAccessToken: async () => "test" },
    }),
  );
  const chunk = {
    source: "microphone" as const,
    sequence: 0,
    startSeconds: 0,
    durationSeconds: 30,
    bytes: 4,
    format: "ogg" as const,
  };
  const chunks = [
    { ...chunk, source: "system" as const, format: "m4a" as const },
    { ...chunk, sequence: 1 },
    chunk,
  ];
  const bytes = new Uint8Array([0, 128, 255, 42]);
  const audio = vi.spyOn(client, "audio").mockResolvedValue({
    arrayBuffer: async () => bytes.buffer,
  } as Blob);
  const archive = await client.originalAudioZip({
    id: "original",
    chunks,
  } as import("./sessions-client").RecordingSession);
  expect(archive.type).toBe("application/zip");
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(archive);
  });
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const names: string[] = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const length = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + nameLength;
    names.push(new TextDecoder().decode(data.slice(offset + 30, start)));
    expect(data.slice(start, start + length)).toEqual(bytes);
    offset = start + length;
  }
  expect(names).toEqual([
    "microphone/000000.ogg",
    "microphone/000001.ogg",
    "system/000000.m4a",
  ]);
  expect(audio).toHaveBeenCalledTimes(3);
});

it("rejects failed or cancelled original downloads without returning a partial archive", async () => {
  const client = new CompanionSessionsClient(
    new ApiClient({
      baseUrl: "https://savia.test",
      tokenSource: { getAccessToken: async () => "test" },
    }),
  );
  const audio = vi
    .spyOn(client, "audio")
    .mockRejectedValue(new Error("Audio unavailable"));
  const session = {
    id: "broken",
    chunks: [{ source: "system", sequence: 0, format: "ogg" }],
  } as import("./sessions-client").RecordingSession;
  await expect(client.originalAudioZip(session)).rejects.toThrow(
    "Audio unavailable",
  );
  const abort = new AbortController();
  abort.abort();
  await expect(
    client.originalAudioZip(session, abort.signal),
  ).rejects.toThrow();
  expect(audio).toHaveBeenCalledTimes(1);
});
