const OPEN_VSX_ORIGIN = "https://open-vsx.org";
export const EDITOR_EXTENSION_MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_MARKETPLACE_RESPONSE_BYTES = 1_048_576;

export type OpenVsxExtension = {
  publisher: string;
  name: string;
  version: string;
  displayName: string | null;
  description: string | null;
  license: string | null;
  downloadUrl: string;
};

export type MarketplaceSearchResult = Omit<OpenVsxExtension, "downloadUrl">;

function boundedString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, max)
    : null;
}

function safeCoordinate(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/.test(value);
}

async function fetchOpenVsx(
  url: URL,
  maxBytes = MAX_MARKETPLACE_RESPONSE_BYTES,
): Promise<Uint8Array> {
  if (url.origin !== OPEN_VSX_ORIGIN || url.username || url.password)
    throw new Error("Open VSX returned an untrusted URL.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let requestUrl = url;
    let response: Response;
    for (let redirects = 0; ; redirects++) {
      response = await fetch(requestUrl, {
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status < 300 || response.status >= 400) break;
      if (redirects >= 2)
        throw new Error("Open VSX returned too many redirects.");
      const location = response.headers.get("location");
      if (!location)
        throw new Error("Open VSX returned a redirect without a location.");
      let next: URL;
      try {
        next = new URL(location, requestUrl);
      } catch {
        throw new Error("Open VSX returned an invalid redirect.");
      }
      if (next.origin !== OPEN_VSX_ORIGIN || next.username || next.password)
        throw new Error("Open VSX redirected to an untrusted origin.");
      requestUrl = next;
    }
    if (!response.ok)
      throw new Error(`Open VSX request failed (${response.status}).`);
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes)
      throw new Error("Open VSX response exceeded the size limit.");
    if (!response.body) throw new Error("Open VSX returned an empty response.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error("Open VSX response exceeded the size limit.");
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
    return bytes;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("Open VSX request timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Open VSX returned invalid JSON.");
  }
}

function mapExtension(value: unknown): OpenVsxExtension | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const publisher = boundedString(item.namespace ?? item.publisher, 100);
  const name = boundedString(item.name, 100);
  const version = boundedString(item.version, 100);
  const files =
    item.files && typeof item.files === "object"
      ? (item.files as Record<string, unknown>)
      : {};
  const download = boundedString(files.download, 2048);
  if (
    !publisher ||
    !name ||
    !version ||
    !download ||
    !safeCoordinate(publisher) ||
    !safeCoordinate(name)
  )
    return null;
  let parsed: URL;
  try {
    parsed = new URL(download, OPEN_VSX_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== OPEN_VSX_ORIGIN || parsed.username || parsed.password)
    return null;
  return {
    publisher,
    name,
    version,
    displayName: boundedString(item.displayName, 200),
    description: boundedString(item.description, 2000),
    license: boundedString(item.license, 200),
    downloadUrl: parsed.href,
  };
}

export async function searchOpenVsx(
  query: string,
  offset = 0,
): Promise<{
  results: MarketplaceSearchResult[];
  offset: number;
  totalSize: number;
  nextOffset: number | null;
}> {
  const q = query.trim();
  if (!q || q.length > 200)
    throw new Error("Marketplace query must be 1–200 characters.");
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("Invalid marketplace offset.");
  const url = new URL("/api/-/search", OPEN_VSX_ORIGIN);
  url.searchParams.set("query", q);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("size", "20");
  const payload = parseJson(await fetchOpenVsx(url));
  if (!payload || typeof payload !== "object")
    throw new Error("Open VSX returned invalid search data.");
  const data = payload as Record<string, unknown>;
  const extensions = Array.isArray(data.extensions) ? data.extensions : [];
  const results = extensions
    .slice(0, 20)
    .map(mapExtension)
    .filter((x): x is OpenVsxExtension => !!x)
    .map(({ downloadUrl: _downloadUrl, ...item }) => item);
  const totalSize =
    Number.isSafeInteger(data.totalSize) && Number(data.totalSize) >= 0
      ? Number(data.totalSize)
      : results.length;
  const pageCount = Math.min(extensions.length, 20);
  const nextOffset =
    offset + pageCount < totalSize && pageCount > 0 ? offset + pageCount : null;
  return { results, offset, totalSize, nextOffset };
}

export async function getOpenVsxVersion(
  publisher: string,
  name: string,
  version: string,
): Promise<OpenVsxExtension> {
  if (![publisher, name, version].every(safeCoordinate))
    throw new Error("Invalid Open VSX extension coordinates.");
  const url = new URL(
    `/api/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    OPEN_VSX_ORIGIN,
  );
  const metadata = mapExtension(parseJson(await fetchOpenVsx(url)));
  if (
    !metadata ||
    metadata.publisher.toLowerCase() !== publisher.toLowerCase() ||
    metadata.name.toLowerCase() !== name.toLowerCase() ||
    metadata.version !== version
  )
    throw new Error(
      "Open VSX version metadata did not match the requested coordinates.",
    );
  return metadata;
}

export async function downloadOpenVsxVsix(
  metadata: OpenVsxExtension,
): Promise<Uint8Array> {
  const url = new URL(metadata.downloadUrl);
  if (url.origin !== OPEN_VSX_ORIGIN || url.username || url.password)
    throw new Error("Open VSX returned an untrusted download URL.");
  return fetchOpenVsx(url, EDITOR_EXTENSION_MAX_COMPRESSED_BYTES);
}
