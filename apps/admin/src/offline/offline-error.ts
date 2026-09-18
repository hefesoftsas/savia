type ErrorLike = {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  name?: unknown;
};

function asErrorLike(error: unknown): ErrorLike {
  if (typeof error !== "object" || error === null) return {};
  return error as ErrorLike;
}

/**
 * Whether a failure looks like "no usable network" rather than a real
 * server/auth answer. Used to serve cached reads and to keep the session
 * instead of logging the user out when the network drops.
 *
 * NOTE: HTTP 5xx counts as offline-ish on purpose: a crashing API must not
 * wipe the session nor hide cached data either.
 */
export function isOfflineError(error: unknown): boolean {
  const { code, status, message, name } = asErrorLike(error);
  if (code === "AUTHENTICATION_UNAVAILABLE") return true;
  if (typeof status === "number" && status >= 500) return true;
  const haystack = `${typeof name === "string" ? name : ""} ${
    typeof message === "string" ? message : ""
  }`;
  return /failed to fetch|networkerror|network request failed|load failed|sin conexi/i.test(
    haystack,
  );
}
