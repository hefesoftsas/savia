import { describe, expect, it, vi } from "vitest";
import { PagesError } from "../../api/src/pages/service";
import { createPagesVectorIndex } from "../src/pages-vector-index";

function response(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function configuredFetch(...results: Response[]) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const result of results) fetchImpl.mockResolvedValueOnce(result);
  return fetchImpl;
}

describe("Qdrant Pages vector index", () => {
  it("provisions a missing collection and sends authenticated requests", async () => {
    const fetchImpl = configuredFetch(
      response(404, { status: { error: "Not found" } }),
      response(200, { result: true }),
      response(200, { result: { operation_id: 1, status: "completed" } }),
    );
    const index = createPagesVectorIndex(
      {
        url: "http://qdrant:6333",
        collection: "pages",
        apiKey: "secret-token",
      },
      fetchImpl,
    );

    await index.upsert([
      {
        id: "a".repeat(48) + ":0",
        values: Array(1024).fill(0.25),
        namespace: "pages-tenant-17",
        metadata: { pageId: "page-1", version: 3 },
      },
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(
      fetchImpl.mock.calls.map(([url, options]) => [
        String(url),
        options?.method,
      ]),
    ).toEqual([
      ["http://qdrant:6333/collections/pages", "GET"],
      ["http://qdrant:6333/collections/pages", "PUT"],
      ["http://qdrant:6333/collections/pages/points?wait=true", "PUT"],
    ]);
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "api-key": "secret-token" }),
      body: JSON.stringify({ vectors: { size: 1024, distance: "Cosine" } }),
    });
    const pointRequest = fetchImpl.mock.calls[2]?.[1];
    const pointBody = JSON.parse(String(pointRequest?.body));
    expect(pointBody.points[0]).toMatchObject({
      payload: {
        pageVectorId: "a".repeat(48) + ":0",
        namespace: "pages-tenant-17",
        pageId: "page-1",
        version: 3,
      },
      vector: Array(1024).fill(0.25),
    });
    expect(pointBody.points[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("queries by tenant and restores original vector ids and page metadata", async () => {
    const fetchImpl = configuredFetch(
      response(200, {
        result: {
          config: { params: { vectors: { size: 1024, distance: "Cosine" } } },
        },
      }),
      response(200, {
        result: {
          points: [
            {
              id: "internal-qdrant-id",
              score: 0.91,
              payload: {
                pageVectorId: "b".repeat(48) + ":2",
                namespace: "pages-tenant-17",
                pageId: "page-2",
                version: 4,
              },
            },
          ],
        },
      }),
    );
    const index = createPagesVectorIndex(
      { url: "http://qdrant:6333", collection: "pages" },
      fetchImpl,
    );

    await expect(
      index.query(Array(1024).fill(0.5), {
        namespace: "pages-tenant-17",
        topK: 12,
        returnMetadata: "all",
      }),
    ).resolves.toEqual({
      matches: [
        {
          id: "b".repeat(48) + ":2",
          score: 0.91,
          metadata: { pageId: "page-2", version: 4 },
        },
      ],
    });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      "http://qdrant:6333/collections/pages/points/query",
    );
    expect(
      JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      query: Array(1024).fill(0.5),
      filter: {
        must: [{ key: "namespace", match: { value: "pages-tenant-17" } }],
      },
      limit: 12,
      with_payload: true,
    });
  });

  it("deletes points using stable UUIDs derived from original ids", async () => {
    const fetchImpl = configuredFetch(
      response(404, {}),
      response(200, {}),
      response(200, { result: { status: "completed" } }),
      response(200, { result: { status: "completed" } }),
    );
    const index = createPagesVectorIndex(
      { url: "http://qdrant:6333", collection: "pages" },
      fetchImpl,
    );
    const originalIds = ["c".repeat(48) + ":0", "d".repeat(48) + ":1"];

    await index.deleteByIds(originalIds);
    await index.deleteByIds(originalIds);

    expect(fetchImpl.mock.calls[2]?.[0]).toBe(
      "http://qdrant:6333/collections/pages/points/delete?wait=true",
    );
    const deleted = JSON.parse(
      String(fetchImpl.mock.calls[2]?.[1]?.body),
    ).points;
    const deletedAgain = JSON.parse(
      String(fetchImpl.mock.calls[3]?.[1]?.body),
    ).points;
    expect(deleted).toHaveLength(2);
    expect(deletedAgain).toEqual(deleted);
    expect(deleted.every((id: string) => /^[0-9a-f-]{36}$/.test(id))).toBe(
      true,
    );
  });

  it("rejects collections with incompatible vector configuration", async () => {
    const fetchImpl = configuredFetch(
      response(200, {
        result: {
          config: { params: { vectors: { size: 768, distance: "Cosine" } } },
        },
      }),
    );
    const index = createPagesVectorIndex(
      { url: "http://qdrant:6333", collection: "pages" },
      fetchImpl,
    );

    await expect(
      index.query(Array(1024).fill(0.1), {
        namespace: "pages-tenant-1",
        topK: 5,
        returnMetadata: "all",
      }),
    ).rejects.toMatchObject({ status: 503, code: "SEARCH_UNAVAILABLE" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries provisioning after a transient initialization failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(response(404, {}))
      .mockResolvedValueOnce(response(200, {}))
      .mockResolvedValueOnce(response(200, {}));
    const index = createPagesVectorIndex(
      { url: "http://qdrant:6333", collection: "pages" },
      fetchImpl,
    );

    await expect(
      index.deleteByIds(["e".repeat(48) + ":0"]),
    ).rejects.toMatchObject({
      status: 503,
      code: "SEARCH_UNAVAILABLE",
    });
    await expect(
      index.deleteByIds(["e".repeat(48) + ":0"]),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("sanitizes malformed responses and transport errors", async () => {
    const badResult = configuredFetch(
      response(404, {}),
      response(200, {}),
      response(200, {
        result: { points: [{ id: "unsafe", score: Infinity, payload: {} }] },
      }),
    );
    const index = createPagesVectorIndex(
      {
        url: "http://qdrant:6333",
        collection: "pages",
        apiKey: "secret-token",
      },
      badResult,
    );
    await expect(
      index.query(Array(1024).fill(0.1), {
        namespace: "pages-tenant-1",
        topK: 5,
        returnMetadata: "all",
      }),
    ).rejects.toMatchObject({ status: 503, code: "SEARCH_UNAVAILABLE" });

    const rejectedFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("secret-token leaked"));
    const rejected = createPagesVectorIndex(
      {
        url: "http://qdrant:6333",
        collection: "pages",
        apiKey: "secret-token",
      },
      rejectedFetch,
    );
    let failure: unknown;
    try {
      await rejected.deleteByIds(["f".repeat(48) + ":0"]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PagesError);
    expect(String(failure)).not.toContain("secret-token");
    expect(String(failure)).not.toContain("leaked");
  });

  it("cancels an in-flight provider request without exposing the shutdown reason", async () => {
    const lifecycle = new AbortController();
    let requestStarted!: (signal: AbortSignal) => void;
    const started = new Promise<AbortSignal>((resolve) => {
      requestStarted = resolve;
    });
    let cancellationObserved = false;
    const fetchImpl: typeof fetch = async (_input, init) => {
      const signal = init?.signal as AbortSignal;
      requestStarted(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            cancellationObserved = true;
            reject(signal.reason);
          },
          { once: true },
        );
        setTimeout(() => reject(new Error("provider stayed active")), 100);
      });
    };
    const index = createPagesVectorIndex(
      {
        url: "http://qdrant:6333",
        collection: "pages",
        signal: lifecycle.signal,
      },
      fetchImpl,
    );

    const deletion = index.deleteByIds(["9".repeat(48) + ":0"]);
    const requestSignal = await started;
    lifecycle.abort(new Error("private shutdown reason"));

    let failure: unknown;
    try {
      await deletion;
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      status: 503,
      code: "SEARCH_UNAVAILABLE",
      message: "Semantic search is unavailable",
    });
    expect(requestSignal.aborted).toBe(true);
    expect(cancellationObserved).toBe(true);
    expect(String(failure)).not.toContain("private shutdown reason");
  });

  it("rejects invalid service URLs and malformed vector inputs", async () => {
    expect(() =>
      createPagesVectorIndex({
        url: "https://user:pass@qdrant:6333",
        collection: "pages",
      }),
    ).toThrow(PagesError);
    expect(() =>
      createPagesVectorIndex({
        url: "http://qdrant:6333/?token=x",
        collection: "pages",
      }),
    ).toThrow(PagesError);
    const fetchImpl = vi.fn<typeof fetch>();
    const index = createPagesVectorIndex(
      { url: "http://qdrant:6333", collection: "pages" },
      fetchImpl,
    );
    await expect(
      index.query([1], {
        namespace: "pages-tenant-1",
        topK: 5,
        returnMetadata: "all",
      }),
    ).rejects.toMatchObject({ status: 503, code: "SEARCH_UNAVAILABLE" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
