/** Covers token acquisition, network, and response decoding even if a transport ignores abort. */
export const PLUGIN_AUTHORING_CLIENT_TIMEOUT_MS = 100_000;

export async function requestPluginAuthoring<T>(
  request: (signal: AbortSignal) => Promise<T>,
  controller: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(
        controller.signal.reason ?? new DOMException("Cancelled", "AbortError"),
      );
    if (controller.signal.aborted) onAbort();
    else {
      controller.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(
        () =>
          controller.abort(
            new DOMException(
              "Plugin authoring deadline exceeded",
              "TimeoutError",
            ),
          ),
        PLUGIN_AUTHORING_CLIENT_TIMEOUT_MS,
      );
    }
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return request(controller.signal);
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
