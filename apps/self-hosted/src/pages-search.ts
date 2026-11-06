import type { PagesSearchBindings } from "../../api/src/pages/cloudflare-search";
import { PagesError } from "../../api/src/pages/service";
import { createPagesVectorIndex } from "./pages-vector-index";
import { createRateLimiter } from "./rate-limit";

function origin(env: Record<string, string | undefined>, key: string) {
  try {
    const url = new URL(env[key]?.trim() ?? "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      `${key} must be an HTTP(S) origin without credentials or a path`,
    );
  }
}

/** Local bge-m3 embeddings implement the shared Pages search contract. */
export function createPagesSearchBindings(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): PagesSearchBindings {
  if (env.SAVIA_PAGES_SEARCH_ENABLED !== "true") return {};
  const ollama = origin(env, "SAVIA_PAGES_OLLAMA_URL");
  const qdrant = origin(env, "SAVIA_PAGES_QDRANT_URL");
  const timeoutMs = Number(env.SAVIA_PAGES_EMBEDDING_TIMEOUT_MS ?? 60_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000)
    throw new Error(
      "SAVIA_PAGES_EMBEDDING_TIMEOUT_MS must be an integer between 1000 and 60000",
    );
  return {
    AI: {
      async run(_model, { text }) {
        try {
          const response = await fetchImpl(`${ollama}/api/embed`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "bge-m3",
              input: text,
              truncate: false,
            }),
            signal: AbortSignal.any([
              AbortSignal.timeout(timeoutMs),
              ...(signal ? [signal] : []),
            ]),
            redirect: "error",
          });
          if (!response.ok) throw new Error();
          const { embeddings } = (await response.json()) as {
            embeddings?: unknown;
          };
          if (
            !Array.isArray(embeddings) ||
            embeddings.length !== text.length ||
            embeddings.some(
              (vector: unknown) =>
                !Array.isArray(vector) ||
                vector.length !== 1024 ||
                vector.some(
                  (value: unknown) =>
                    typeof value !== "number" || !Number.isFinite(value),
                ),
            )
          )
            throw new Error();
          return { data: embeddings as number[][] };
        } catch {
          throw new PagesError(
            503,
            "SEARCH_UNAVAILABLE",
            "Semantic search is unavailable",
          );
        }
      },
    },
    PAGES_VECTORIZE: createPagesVectorIndex(
      {
        url: qdrant,
        collection:
          env.SAVIA_PAGES_QDRANT_COLLECTION?.trim() || "savia-pages-bge-m3-v1",
        apiKey: env.SAVIA_PAGES_QDRANT_API_KEY,
        signal,
      },
      fetchImpl,
    ),
    PAGES_SEARCH_RATE_LIMITER: createRateLimiter({ limit: 30 }),
  };
}
