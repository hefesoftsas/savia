export type ShlinkShortenerOptions = {
  serverUrl: string;
  apiKey: string;
  fetcher?: typeof fetch;
};

const MAX_RESPONSE_BYTES = 4096;
const TIMEOUT_MS = 5000;

async function readBounded(response: Response): Promise<string> {
  if (!response.body) throw new Error("Shlink returned an invalid response.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Shlink response is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function serverEndpoint(value: string): URL {
  let server: URL;
  try {
    server = new URL(value);
  } catch {
    throw new Error("Invalid Shlink server URL.");
  }
  if (
    server.protocol !== "https:" ||
    !server.hostname ||
    server.username ||
    server.password ||
    server.search ||
    server.hash
  )
    throw new Error("Invalid Shlink server URL.");
  server.pathname = `${server.pathname.replace(/\/+$/, "")}/rest/v3/short-urls`;
  return server;
}

function validateDestination(value: string): void {
  let destination: URL;
  try {
    destination = new URL(value);
  } catch {
    throw new Error("Invalid public destination.");
  }
  const hostname = destination.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    destination.protocol !== "https:" ||
    destination.username ||
    destination.password ||
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    /^127\./.test(hostname)
  )
    throw new Error("Invalid public destination.");
}

function isExpectedShortUrl(value: unknown, server: URL): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === server.hostname &&
      url.port === server.port &&
      !url.username &&
      !url.password &&
      url.pathname !== "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function createShlinkShortener({
  serverUrl,
  apiKey,
  fetcher = fetch,
}: ShlinkShortenerOptions) {
  const endpoint = serverEndpoint(serverUrl);
  const shortDomain = new URL(serverUrl);
  if (!apiKey.trim()) throw new Error("Shlink API key is required.");

  return {
    async shorten(destination: string): Promise<string> {
      validateDestination(destination);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetcher(endpoint.href, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Api-Key": apiKey,
          },
          body: JSON.stringify({ longUrl: destination }),
          // Workers rejects "error"; "manual" keeps the API key off redirects.
          redirect: "manual",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Shlink request failed.");

        let result: unknown;
        try {
          result = JSON.parse(await readBounded(response));
        } catch {
          throw new Error("Shlink returned invalid data.");
        }
        const shortUrl =
          result && typeof result === "object" && "shortUrl" in result
            ? result.shortUrl
            : undefined;
        if (!isExpectedShortUrl(shortUrl, shortDomain))
          throw new Error("Shlink returned an invalid URL.");
        return shortUrl;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
