import { editorManifestCompatibility } from "@savia/studio-shared/plugin-editor-vsix";
import { PLUGIN_EDITOR_VSCODE_VERSION } from "@savia/studio-shared/plugin-editor-extensions";

const OPEN_VSX_ORIGIN = "https://open-vsx.org";
const OPEN_VSX_DOWNLOAD_CDN_ORIGIN = "https://openvsx.eclipsecontent.org";
export const EDITOR_EXTENSION_MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_MARKETPLACE_RESPONSE_BYTES = 1_048_576;
const MAX_EXTENSION_MANIFEST_BYTES = 1_048_576;
const MARKETPLACE_PREFLIGHT_CONCURRENCY = 3;

export function openVsxRequestDeadline(): number {
  return Date.now() + REQUEST_TIMEOUT_MS;
}

export class OpenVsxPreflightError extends Error {
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = "OpenVsxPreflightError";
  }
}

class OpenVsxResponseTooLargeError extends Error {
  constructor() {
    super("Open VSX response exceeded the size limit.");
    this.name = "OpenVsxResponseTooLargeError";
  }
}

class OpenVsxDownloadTooLargeError extends Error {
  readonly status = 413;

  constructor() {
    super("Open VSX VSIX exceeded the 20 MiB size limit.");
    this.name = "OpenVsxDownloadTooLargeError";
  }
}

export type OpenVsxExtension = {
  publisher: string;
  name: string;
  version: string;
  displayName: string | null;
  description: string | null;
  license: string | null;
  downloadUrl: string;
  targetPlatform?: string | null;
};

export type MarketplaceSearchResult = Omit<
  OpenVsxExtension,
  "downloadUrl" | "targetPlatform"
>;

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
  allowOfficialDownloadCdnRedirect = false,
  deadline = openVsxRequestDeadline(),
): Promise<Uint8Array> {
  if (url.origin !== OPEN_VSX_ORIGIN || url.username || url.password)
    throw new Error("Open VSX returned an untrusted URL.");
  const allowedRedirectOrigins = new Set([OPEN_VSX_ORIGIN]);
  if (allowOfficialDownloadCdnRedirect)
    allowedRedirectOrigins.add(OPEN_VSX_DOWNLOAD_CDN_ORIGIN);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Open VSX request timed out.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remaining);
  try {
    let requestUrl = url;
    let response: Response;
    for (let redirects = 0; ; redirects++) {
      response = await fetch(requestUrl, {
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      try {
        await response.body?.cancel();
      } catch {
        // Redirect response bodies are discarded; cancellation failure is non-fatal.
      }
      if (redirects >= 2)
        throw new Error("Open VSX returned too many redirects.");
      if (!location)
        throw new Error("Open VSX returned a redirect without a location.");
      let next: URL;
      try {
        next = new URL(location, requestUrl);
      } catch {
        throw new Error("Open VSX returned an invalid redirect.");
      }
      if (
        !allowedRedirectOrigins.has(next.origin) ||
        next.username ||
        next.password
      )
        throw new Error("Open VSX redirected to an untrusted origin.");
      requestUrl = next;
    }
    if (!response.ok)
      throw new Error(`Open VSX request failed (${response.status}).`);
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > maxBytes) {
      try {
        await response.body?.cancel();
      } catch {
        // A declared oversized response is rejected even if cancellation fails.
      }
      throw new OpenVsxResponseTooLargeError();
    }
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
          throw new OpenVsxResponseTooLargeError();
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
  const targetPlatform =
    item.targetPlatform === undefined || item.targetPlatform === null
      ? null
      : typeof item.targetPlatform === "string"
        ? item.targetPlatform.trim()
        : null;
  if (
    item.targetPlatform !== undefined &&
    item.targetPlatform !== null &&
    typeof item.targetPlatform !== "string"
  )
    return null;
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
    targetPlatform,
  };
}

function assertWebTarget(metadata: OpenVsxExtension): void {
  const platform = metadata.targetPlatform?.toLowerCase();
  if (platform && platform !== "universal" && platform !== "web")
    throw new OpenVsxPreflightError(
      `This Open VSX build targets ${metadata.targetPlatform}; only universal or web extensions are supported in the browser editor.`,
    );
  if (metadata.targetPlatform === "")
    throw new OpenVsxPreflightError(
      "This Open VSX build has an unknown target platform; only universal or web extensions are supported in the browser editor.",
    );
}

function preflightMessage(reason: string, runtimeVersion: string): string {
  switch (reason) {
    case "incompatible-engine":
      return `This extension requires a different VS Code version than ${runtimeVersion}.`;
    case "invalid-engine-range":
      return "This extension has an invalid VS Code engine requirement.";
    case "desktop-only":
      return "This extension only provides a desktop entry point; the browser editor requires a web entry point.";
    case "unsupported-api":
      return "This extension requires proposed VS Code APIs that are unavailable in the browser editor.";
    case "unsupported-contributions":
      return "This extension declares contributions that the browser editor does not support.";
    default:
      return "This extension manifest is not supported by the browser editor.";
  }
}

function validateManifest(
  value: unknown,
  metadata: OpenVsxExtension,
  runtimeVersion: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new OpenVsxPreflightError(
      "Open VSX returned an invalid extension manifest.",
    );
  const manifest = value as Record<string, unknown>;
  if (
    typeof manifest.publisher !== "string" ||
    manifest.publisher.toLowerCase() !== metadata.publisher.toLowerCase() ||
    typeof manifest.name !== "string" ||
    manifest.name.toLowerCase() !== metadata.name.toLowerCase() ||
    manifest.version !== metadata.version
  )
    throw new OpenVsxPreflightError(
      "Open VSX extension manifest did not match the requested publisher, name, and version.",
    );
  for (const key of ["main", "browser"] as const) {
    if (
      manifest[key] !== undefined &&
      (typeof manifest[key] !== "string" || !manifest[key].trim())
    )
      throw new OpenVsxPreflightError(
        `Open VSX extension manifest has an invalid ${key} entry.`,
      );
  }
  const compatibility = editorManifestCompatibility(manifest, runtimeVersion);
  if (!compatibility.supported)
    throw new OpenVsxPreflightError(
      preflightMessage(compatibility.reason ?? "unsupported", runtimeVersion),
    );
  return manifest;
}

export async function searchOpenVsx(
  query: string,
  offset = 0,
  runtimeVersion = PLUGIN_EDITOR_VSCODE_VERSION,
): Promise<{
  results: MarketplaceSearchResult[];
  offset: number;
  totalSize: number;
  nextOffset: number | null;
}> {
  const q = query.trim();
  if (q.length > 200)
    throw new Error("Marketplace query must be at most 200 characters.");
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("Invalid marketplace offset.");
  const url = new URL("/api/-/search", OPEN_VSX_ORIGIN);
  if (q) {
    url.searchParams.set("query", q);
  } else {
    url.searchParams.set("sortBy", "downloadCount");
    url.searchParams.set("sortOrder", "desc");
  }
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("size", "20");
  const deadline = openVsxRequestDeadline();
  const payload = parseJson(
    await fetchOpenVsx(url, MAX_MARKETPLACE_RESPONSE_BYTES, false, deadline),
  );
  if (!payload || typeof payload !== "object")
    throw new Error("Open VSX returned invalid search data.");
  const data = payload as Record<string, unknown>;
  const extensions = Array.isArray(data.extensions) ? data.extensions : [];
  const candidates = extensions
    .slice(0, 20)
    .map(mapExtension)
    .filter((x): x is OpenVsxExtension => !!x);
  const compatibleResults: Array<MarketplaceSearchResult | undefined> =
    new Array(candidates.length);
  let nextCandidate = 0;
  const preflightWorker = async () => {
    while (true) {
      const index = nextCandidate++;
      const candidate = candidates[index];
      if (!candidate) return;
      try {
        assertWebTarget(candidate);
        const metadata = await getOpenVsxVersion(
          candidate.publisher,
          candidate.name,
          candidate.version,
          deadline,
        );
        await getOpenVsxManifest(metadata, runtimeVersion, deadline);
        const {
          downloadUrl: _downloadUrl,
          targetPlatform: _targetPlatform,
          ...result
        } = metadata;
        compatibleResults[index] = result;
      } catch {
        // Discovery is best effort per candidate; one registry failure should
        // not hide otherwise inspectable entries on the raw page.
      }
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(MARKETPLACE_PREFLIGHT_CONCURRENCY, candidates.length),
      },
      preflightWorker,
    ),
  );
  const results = compatibleResults.filter(
    (item): item is MarketplaceSearchResult => item !== undefined,
  );
  const totalSize =
    Number.isSafeInteger(data.totalSize) && Number(data.totalSize) >= 0
      ? Number(data.totalSize)
      : extensions.length;
  const pageCount = Math.min(extensions.length, 20);
  const nextOffset =
    offset + pageCount < totalSize && pageCount > 0 ? offset + pageCount : null;
  return { results, offset, totalSize, nextOffset };
}

export async function getOpenVsxVersion(
  publisher: string,
  name: string,
  version: string,
  deadline = openVsxRequestDeadline(),
): Promise<OpenVsxExtension> {
  if (![publisher, name, version].every(safeCoordinate))
    throw new Error("Invalid Open VSX extension coordinates.");
  const url = new URL(
    `/api/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    OPEN_VSX_ORIGIN,
  );
  const metadata = mapExtension(
    parseJson(
      await fetchOpenVsx(url, MAX_MARKETPLACE_RESPONSE_BYTES, false, deadline),
    ),
  );
  if (
    !metadata ||
    metadata.publisher.toLowerCase() !== publisher.toLowerCase() ||
    metadata.name.toLowerCase() !== name.toLowerCase() ||
    metadata.version !== version
  )
    throw new Error(
      "Open VSX version metadata did not match the requested coordinates.",
    );
  assertWebTarget(metadata);
  return metadata;
}

export async function getOpenVsxManifest(
  metadata: OpenVsxExtension,
  runtimeVersion = PLUGIN_EDITOR_VSCODE_VERSION,
  deadline = openVsxRequestDeadline(),
): Promise<Record<string, unknown>> {
  assertWebTarget(metadata);
  const platformPath = metadata.targetPlatform
    ? `${encodeURIComponent(metadata.targetPlatform)}/`
    : "";
  const url = new URL(
    `/api/${encodeURIComponent(metadata.publisher)}/${encodeURIComponent(metadata.name)}/${platformPath}${encodeURIComponent(metadata.version)}/file/package.json`,
    OPEN_VSX_ORIGIN,
  );
  const manifest = parseJson(
    await fetchOpenVsx(url, MAX_EXTENSION_MANIFEST_BYTES, true, deadline),
  );
  return validateManifest(manifest, metadata, runtimeVersion);
}

export async function downloadOpenVsxVsix(
  metadata: OpenVsxExtension,
  deadline = openVsxRequestDeadline(),
): Promise<Uint8Array> {
  const url = new URL(metadata.downloadUrl);
  if (url.origin !== OPEN_VSX_ORIGIN || url.username || url.password)
    throw new Error("Open VSX returned an untrusted download URL.");
  try {
    return await fetchOpenVsx(
      url,
      EDITOR_EXTENSION_MAX_COMPRESSED_BYTES,
      true,
      deadline,
    );
  } catch (error) {
    if (error instanceof OpenVsxResponseTooLargeError)
      throw new OpenVsxDownloadTooLargeError();
    throw error;
  }
}
