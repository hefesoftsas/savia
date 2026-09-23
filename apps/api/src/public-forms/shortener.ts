const IS_GD_ENDPOINT = "https://is.gd/create.php?format=json";
const MAX_RESPONSE_BYTES = 8192;

async function readBoundedBody(response: Response): Promise<string> {
  if (!response.body) return "";
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
        throw new Error("Short URL provider response too large.");
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
  return new TextDecoder().decode(bytes);
}

function isIsGdUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "is.gd" &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

export function createIsGdShortener(fetcher: typeof fetch = fetch) {
  return {
    async shorten(destination: string): Promise<string> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetcher(IS_GD_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ url: destination }),
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Short URL provider failed.");
        const body = await readBoundedBody(response);
        let result: unknown;
        try {
          result = JSON.parse(body);
        } catch {
          throw new Error("Short URL provider returned invalid data.");
        }
        const shortUrl =
          result && typeof result === "object" && "shorturl" in result
            ? result.shorturl
            : undefined;
        if (!isIsGdUrl(shortUrl))
          throw new Error("Short URL provider returned an invalid URL.");
        return shortUrl;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
