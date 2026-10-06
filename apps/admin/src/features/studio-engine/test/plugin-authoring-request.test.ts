import { afterEach, expect, it, vi } from "vitest";
import {
  PLUGIN_AUTHORING_CLIENT_TIMEOUT_MS,
  readAuthoringStream,
  requestPluginAuthoring,
} from "../plugin-authoring-request";
afterEach(() => vi.useRealTimers());
it("bounds token acquisition or transport that ignores cancellation", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const result = requestPluginAuthoring(
    () => new Promise(() => {}),
    controller,
  );
  const rejected = expect(result).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(PLUGIN_AUTHORING_CLIENT_TIMEOUT_MS);
  await rejected;
  expect(controller.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("cancels without waiting for an uncooperative response and ignores its late completion", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let complete!: (value: string) => void;
  const result = requestPluginAuthoring(
    () =>
      new Promise<string>((resolve) => {
        complete = resolve;
      }),
    controller,
  );
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  controller.abort();
  await rejected;
  complete("late proposal");
  expect(vi.getTimerCount()).toBe(0);
});
it("parses SSE frames split across chunks and skips malformed frames", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"type":"message","delta":"Hel',
    'lo"}\n\ndata: not-json\n\ndata: {"type":"usage","input":1,"output":2}\n',
    '\nignored: yes\ndata: {"type":"result","message":"Hello","files":{}}\n\n',
  ];
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
  const events: unknown[] = [];
  await readAuthoringStream(response, new AbortController().signal, (event) =>
    events.push(event),
  );
  expect(events).toEqual([
    { type: "message", delta: "Hello" },
    { type: "usage", input: 1, output: 2 },
    { type: "result", message: "Hello", files: {} },
  ]);
});
it("cleans up its deadline on success and failure", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  await expect(
    requestPluginAuthoring(async () => "proposal", controller),
  ).resolves.toBe("proposal");
  await expect(
    requestPluginAuthoring(async () => {
      throw new Error("Unavailable");
    }, controller),
  ).rejects.toThrow("Unavailable");
  expect(vi.getTimerCount()).toBe(0);
  expect(controller.signal.aborted).toBe(false);
});
