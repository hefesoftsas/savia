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
