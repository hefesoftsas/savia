export const REQUEST_TIMEOUT_MS = 15_000;

export class RequestTimeoutError extends Error {
  constructor(readonly timeoutMs = REQUEST_TIMEOUT_MS) {
    super(
      "La solicitud tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.",
    );
    this.name = "RequestTimeoutError";
  }
}

/** Ends a stalled operation and aborts its network request when the limit is reached. */
export async function withRequestTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = REQUEST_TIMEOUT_MS,
  externalSignal?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;

  const externalAbort = externalSignal
    ? new Promise<never>((_resolve, reject) => {
        const abort = () => {
          const reason =
            externalSignal.reason ?? new DOMException("Aborted", "AbortError");
          controller.abort(reason);
          reject(reason);
        };
        if (externalSignal.aborted) {
          abort();
        } else {
          externalSignal.addEventListener("abort", abort, { once: true });
          removeAbortListener = () =>
            externalSignal.removeEventListener("abort", abort);
        }
      })
    : undefined;

  const timedOut = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new RequestTimeoutError(timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      operation(controller.signal),
      timedOut,
      ...(externalAbort ? [externalAbort] : []),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    removeAbortListener?.();
  }
}
