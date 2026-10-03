const catalogPath = "/companion-downloads.json";
const upstreamUrl =
  "https://api.github.com/repos/hefesoftsas/savia/releases?per_page=30";
const cacheTtlSeconds = 10 * 60;
const maxPayloadBytes = 1024 * 1024;
const maxReleases = 30;
const maxAssetsPerRelease = 100;
const requestTimeoutMs = 8000;

type CatalogAsset = {
  name: string;
  size: number;
  state: string;
  browser_download_url: string;
};

type CatalogRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: CatalogAsset[];
};

type DefaultCache = {
  match(request: Request): Promise<Response | null | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

type MemoryEntry = { expiresAt: number; body: string };

function defaultCache(): DefaultCache | undefined {
  // `caches.default` is supplied by Cloudflare Workers but is absent from the
  // browser-oriented DOM types used by the admin package and from self-hosted.
  return (
    globalThis as typeof globalThis & {
      caches?: { default?: DefaultCache };
    }
  ).caches?.default;
}

function cacheKeyFor(request: Request): Request {
  // Keep the cache key in the request's zone, but ignore cache-busting query
  // strings. The memory fallback below uses one shared key across hostnames.
  const url = new URL(request.url);
  url.pathname = catalogPath;
  url.search = "";
  url.hash = "";
  return new Request(url.toString(), { method: "GET" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCatalog(value: unknown): CatalogRelease[] {
  if (!Array.isArray(value) || value.length > maxReleases)
    throw new Error("Invalid release catalog");
  return value.map((candidate): CatalogRelease => {
    if (
      !isRecord(candidate) ||
      typeof candidate.tag_name !== "string" ||
      candidate.tag_name.length === 0 ||
      candidate.tag_name.length > 200 ||
      typeof candidate.draft !== "boolean" ||
      typeof candidate.prerelease !== "boolean" ||
      !(
        candidate.published_at === null ||
        (typeof candidate.published_at === "string" &&
          Number.isFinite(Date.parse(candidate.published_at)))
      ) ||
      !Array.isArray(candidate.assets) ||
      candidate.assets.length > maxAssetsPerRelease
    )
      throw new Error("Invalid release catalog entry");

    const assets = candidate.assets.map((asset): CatalogAsset => {
      if (
        !isRecord(asset) ||
        typeof asset.name !== "string" ||
        asset.name.length > 255 ||
        typeof asset.size !== "number" ||
        !Number.isSafeInteger(asset.size) ||
        asset.size < 0 ||
        typeof asset.state !== "string" ||
        asset.state.length > 32 ||
        typeof asset.browser_download_url !== "string" ||
        asset.browser_download_url.length > 2048
      )
        throw new Error("Invalid release asset");
      const url = new URL(asset.browser_download_url);
      if (url.protocol !== "https:" || url.hostname !== "github.com")
        throw new Error("Invalid release asset URL");
      return {
        name: asset.name,
        size: asset.size,
        state: asset.state,
        browser_download_url: url.toString(),
      };
    });
    return {
      tag_name: candidate.tag_name,
      draft: candidate.draft,
      prerelease: candidate.prerelease,
      published_at: candidate.published_at,
      assets,
    };
  });
}

async function readJsonBounded(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Missing catalog response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxPayloadBytes) {
        await reader.cancel();
        throw new Error("Catalog response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function clientResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function cacheResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Cache-Control": `public, max-age=${cacheTtlSeconds}`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readCached(
  cache: DefaultCache,
  key: Request,
): Promise<string | undefined> {
  const response = await cache.match(key);
  if (!response) return undefined;
  const catalog = validateCatalog(await readJsonBounded(response));
  return JSON.stringify(catalog);
}

async function fetchCatalog(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Savia-Companion-Downloads",
      },
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Release catalog unavailable");
    const catalog = validateCatalog(await readJsonBounded(response));
    const body = JSON.stringify(catalog);
    if (new TextEncoder().encode(body).byteLength > maxPayloadBytes)
      throw new Error("Release catalog too large");
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export function createCompanionDownloadsHandler() {
  const memoryCache = new Map<string, MemoryEntry>();
  const fills = new Map<string, Promise<string>>();

  async function loadCatalog(key: Request): Promise<string> {
    const cache = defaultCache();
    if (cache) {
      try {
        const body = await readCached(cache, key);
        if (body !== undefined) return body;
      } catch {
        // A corrupt or unavailable edge cache is a miss, not a public error.
      }
    }

    const memoryKey = catalogPath;
    const now = Date.now();
    const cached = memoryCache.get(memoryKey);
    if (cached && cached.expiresAt > now) return cached.body;
    if (cached) memoryCache.delete(memoryKey);

    const pending = fills.get(memoryKey);
    if (pending) return pending;

    const fill = fetchCatalog().then(async (body) => {
      const expiresAt = Date.now() + cacheTtlSeconds * 1000;
      memoryCache.set(memoryKey, { expiresAt, body });
      if (cache) {
        try {
          await cache.put(key, cacheResponse(body));
        } catch {
          // Keep the short-lived in-memory copy for self-hosted/edge cache errors.
        }
      }
      return body;
    });
    fills.set(memoryKey, fill);
    try {
      return await fill;
    } finally {
      if (fills.get(memoryKey) === fill) fills.delete(memoryKey);
    }
  }

  /** Return a public, short-cached catalog without forwarding request credentials. */
  return async function companionDownloadsResponse(
    request: Request,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== catalogPath) return clientResponse("{}", 404);
    if (request.method !== "GET")
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET", "Cache-Control": "no-store" },
      });
    try {
      const body = await loadCatalog(cacheKeyFor(request));
      return clientResponse(body);
    } catch {
      return clientResponse(
        JSON.stringify({ error: "Companion download catalog unavailable" }),
        503,
      );
    }
  };
}

export const companionDownloadsResponse = createCompanionDownloadsHandler();
