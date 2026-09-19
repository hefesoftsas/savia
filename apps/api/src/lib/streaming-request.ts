/** Preserve streaming proxy bodies in both Fetch runtimes. Node requires duplex; Workers ignore it. */
export function streamingRequest(
  input: string | URL | Request,
  init: RequestInit,
): Request {
  const options = { ...init, duplex: "half" as const };
  return new Request(input, options);
}
