import type { PagesSearchBindings } from "../../api/src/pages/cloudflare-search";
import { PagesError } from "../../api/src/pages/service";

type PagesVectorIndex = NonNullable<PagesSearchBindings["PAGES_VECTORIZE"]>;
type Config = {
  url: string;
  collection: string;
  apiKey?: string;
  signal?: AbortSignal;
};

const VECTOR_SIZE = 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const unavailable = () =>
  new PagesError(503, "SEARCH_UNAVAILABLE", "Semantic search is unavailable");

function serviceOrigin(value: string): URL {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw unavailable();
    return url;
  } catch {
    throw unavailable();
  }
}

async function qdrantId(id: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(id),
  );
  const hex = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isVector(values: unknown): values is number[] {
  return (
    Array.isArray(values) &&
    values.length === VECTOR_SIZE &&
    values.every((value) => typeof value === "number" && Number.isFinite(value))
  );
}

export function createPagesVectorIndex(
  config: Config,
  fetchImpl: typeof fetch = fetch,
): PagesVectorIndex {
  const origin = serviceOrigin(config.url);
  if (!config.collection || typeof config.collection !== "string")
    throw unavailable();
  const collectionPath = `/collections/${encodeURIComponent(config.collection)}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (config.apiKey) headers["api-key"] = config.apiKey;
  const endpoint = (path: string) => new URL(path, origin).toString();

  async function request(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<Response> {
    try {
      return await fetchImpl(endpoint(path), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          ...(config.signal ? [config.signal] : []),
        ]),
        redirect: "error",
      });
    } catch {
      throw unavailable();
    }
  }

  async function json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw unavailable();
    }
  }

  async function validateCollection(response: Response): Promise<void> {
    if (!response.ok) throw unavailable();
    const value = (await json(response)) as {
      result?: { config?: { params?: { vectors?: unknown } } };
    };
    const vectors = value?.result?.config?.params?.vectors;
    if (
      !vectors ||
      typeof vectors !== "object" ||
      Array.isArray(vectors) ||
      (vectors as { size?: unknown }).size !== VECTOR_SIZE ||
      (vectors as { distance?: unknown }).distance !== "Cosine"
    )
      throw unavailable();
  }

  let initialization: Promise<void> | undefined;
  function ensureCollection(): Promise<void> {
    if (!initialization) {
      initialization = (async () => {
        const current = await request(collectionPath, "GET");
        if (current.status !== 404) {
          await validateCollection(current);
          return;
        }

        const created = await request(collectionPath, "PUT", {
          vectors: { size: VECTOR_SIZE, distance: "Cosine" },
        });
        if (created.status === 409 || created.status === 400) {
          // Qdrant may report a conflict when another process creates the
          // collection between our GET and PUT. Validate the winner's config.
          const raced = await request(collectionPath, "GET");
          await validateCollection(raced);
          return;
        }
        if (!created.ok) throw unavailable();
        // A successful PUT establishes the requested vector configuration.
        await json(created);
      })().catch((error: unknown) => {
        initialization = undefined;
        if (error instanceof PagesError) throw error;
        throw unavailable();
      });
    }
    return initialization;
  }

  return {
    async upsert(vectors) {
      if (vectors.length === 0) return;
      if (
        vectors.some(
          (vector) =>
            typeof vector.id !== "string" ||
            vector.id.length === 0 ||
            typeof vector.namespace !== "string" ||
            vector.namespace.length === 0 ||
            !isVector(vector.values) ||
            typeof vector.metadata?.pageId !== "string" ||
            !Number.isInteger(vector.metadata.version),
        )
      )
        throw unavailable();
      await ensureCollection();
      const points = await Promise.all(
        vectors.map(async (vector) => ({
          id: await qdrantId(vector.id),
          vector: vector.values,
          payload: {
            pageVectorId: vector.id,
            namespace: vector.namespace,
            pageId: vector.metadata.pageId,
            version: vector.metadata.version,
          },
        })),
      );
      const result = await request(
        `${collectionPath}/points?wait=true`,
        "PUT",
        { points },
      );
      if (!result.ok) throw unavailable();
    },

    async query(vector, options) {
      if (
        !isVector(vector) ||
        typeof options.namespace !== "string" ||
        options.namespace.length === 0 ||
        !Number.isInteger(options.topK) ||
        options.topK < 1
      )
        throw unavailable();
      await ensureCollection();
      const response = await request(`${collectionPath}/points/query`, "POST", {
        query: vector,
        filter: {
          must: [{ key: "namespace", match: { value: options.namespace } }],
        },
        limit: options.topK,
        with_payload: true,
      });
      if (!response.ok) throw unavailable();
      const value = (await json(response)) as {
        result?: { points?: unknown };
      };
      const points = value?.result?.points;
      if (!Array.isArray(points)) throw unavailable();
      const matches = points.map((point: unknown) => {
        if (!point || typeof point !== "object") throw unavailable();
        const item = point as {
          score?: unknown;
          payload?: {
            pageVectorId?: unknown;
            namespace?: unknown;
            pageId?: unknown;
            version?: unknown;
          };
        };
        if (
          typeof item.score !== "number" ||
          !Number.isFinite(item.score) ||
          typeof item.payload?.pageVectorId !== "string" ||
          typeof item.payload.namespace !== "string" ||
          item.payload.namespace !== options.namespace ||
          typeof item.payload.pageId !== "string" ||
          !Number.isInteger(item.payload.version)
        )
          throw unavailable();
        return {
          id: item.payload.pageVectorId,
          score: item.score,
          metadata: {
            pageId: item.payload.pageId,
            version: item.payload.version,
          },
        };
      });
      return { matches };
    },

    async deleteByIds(ids) {
      if (ids.length === 0) return;
      if (ids.some((id) => typeof id !== "string" || id.length === 0))
        throw unavailable();
      await ensureCollection();
      const pointIds = await Promise.all(ids.map(qdrantId));
      const response = await request(
        `${collectionPath}/points/delete?wait=true`,
        "POST",
        {
          points: pointIds,
        },
      );
      if (!response.ok) throw unavailable();
    },
  };
}
