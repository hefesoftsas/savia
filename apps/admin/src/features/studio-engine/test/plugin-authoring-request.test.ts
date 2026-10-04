import { afterEach, expect, it, vi } from "vitest";
import {
  PLUGIN_AUTHORING_CLIENT_TIMEOUT_MS,
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
