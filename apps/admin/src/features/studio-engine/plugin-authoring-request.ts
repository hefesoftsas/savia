/** Covers token acquisition, network, and response decoding even if a transport ignores abort. */
export const PLUGIN_AUTHORING_CLIENT_TIMEOUT_MS = 100_000;

export type AuthoringStreamEvent =
  | { type: "message"; delta: string }
  | { type: "usage"; input: number; output: number }
  | { type: "result"; message: string; files: Record<string, string> }
  | {
      type: "error";
      code?: string;
      message: string;
      details?: Array<{
        file: string;
        path: string;
        message: string;
      }>;
    };

/** Incrementally parses SSE `data:` frames from a streaming response. */
export async function readAuthoringStream(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: AuthoringStreamEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("Empty response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const dispatch = (frame: string) => {
    for (const line of frame.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as AuthoringStreamEvent);
      } catch {
        // A malformed frame never invalidates the frames around it.
      }
    }
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) dispatch(buffer);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The reader may already be released after cancellation.
    }
  }
}

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
