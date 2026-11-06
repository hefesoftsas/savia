import { describe, expect, it } from "vitest";
import { createPagesSearchBindings } from "../src/pages-search";

const environment = {
  SAVIA_PAGES_SEARCH_ENABLED: "true",
  SAVIA_PAGES_OLLAMA_URL: "http://ollama:11434",
  SAVIA_PAGES_QDRANT_URL: "http://qdrant:6333",
};

describe("Docker Pages embeddings", () => {
  it.each(["0", "NaN", "60001"])(
    "rejects an invalid embedding timeout (%s)",
    (timeout) => {
      expect(() =>
        createPagesSearchBindings({
          ...environment,
          SAVIA_PAGES_EMBEDDING_TIMEOUT_MS: timeout,
        }),
      ).toThrow(/SAVIA_PAGES_EMBEDDING_TIMEOUT_MS/);
    },
  );

  it("cancels pending embeddings on shutdown without exposing the abort reason", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetchImpl: typeof fetch = async (_input, init) => {
      started();
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => reject(init!.signal!.reason),
          { once: true },
        );
      });
    };
    const bindings = createPagesSearchBindings(
      environment,
      fetchImpl,
      controller.signal,
    );
    const result = bindings.AI!.run("ignored", { text: ["query"] });
    const failure = expect(result).rejects.toMatchObject({
      status: 503,
      code: "SEARCH_UNAVAILABLE",
      message: "Semantic search is unavailable",
    });
    await requestStarted;
    controller.abort(new Error("private shutdown diagnostic"));
    await failure;
  });
  it("keeps semantic search opt-in and rejects incomplete configuration", () => {
    expect(createPagesSearchBindings({})).toEqual({});
    expect(
      createPagesSearchBindings({
        ...environment,
        SAVIA_PAGES_SEARCH_ENABLED: "false",
      }),
    ).toEqual({});
    expect(() =>
      createPagesSearchBindings({ SAVIA_PAGES_SEARCH_ENABLED: "true" }),
    ).toThrow(/SAVIA_PAGES_OLLAMA_URL/);
    expect(() =>
      createPagesSearchBindings({
        ...environment,
        SAVIA_PAGES_OLLAMA_URL: "http://user:secret@ollama",
      }),
    ).toThrow(/SAVIA_PAGES_OLLAMA_URL/);
    expect(() =>
      createPagesSearchBindings({
        ...environment,
        SAVIA_PAGES_QDRANT_URL: "file:///data",
      }),
    ).toThrow(/SAVIA_PAGES_QDRANT_URL/);
  });

  it("embeds each input locally with the fixed 1024-dimensional model", async () => {
    const vector = Array(1024).fill(0.5);
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("http://ollama:11434/api/embed");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "bge-m3",
        input: ["contracts", "renewals"],
        truncate: false,
      });
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ embeddings: [vector, vector] });
    };
    const bindings = createPagesSearchBindings(environment, fetchImpl);
    expect(
      await bindings.AI!.run("@cf/baai/bge-m3", {
        text: ["contracts", "renewals"],
      }),
    ).toEqual({ data: [vector, vector] });
    expect(bindings.PAGES_VECTORIZE).toBeDefined();
    for (let i = 0; i < 30; i++)
      expect(
        await bindings.PAGES_SEARCH_RATE_LIMITER!.limit({ key: "tenant-1" }),
      ).toEqual({ success: true });
    expect(
      await bindings.PAGES_SEARCH_RATE_LIMITER!.limit({ key: "tenant-1" }),
    ).toEqual({ success: false });
    expect(
      await bindings.PAGES_SEARCH_RATE_LIMITER!.limit({ key: "tenant-2" }),
    ).toEqual({ success: true });
  });

  it.each([
    { embeddings: [Array(3).fill(1)] },
    { embeddings: [] },
    { embeddings: [Array(1024).fill("invalid")] },
    {},
  ])("reports malformed embeddings as unavailable", async (response) => {
    const bindings = createPagesSearchBindings(environment, async () =>
      Response.json(response),
    );
    await expect(
      bindings.AI!.run("ignored", { text: ["query"] }),
    ).rejects.toMatchObject({ status: 503, code: "SEARCH_UNAVAILABLE" });
  });

  it("does not expose provider errors or credentials", async () => {
    const bindings = createPagesSearchBindings(
      environment,
      async () => new Response("secret provider diagnostic", { status: 500 }),
    );
    await expect(
      bindings.AI!.run("ignored", { text: ["query"] }),
    ).rejects.toThrow("Semantic search is unavailable");
    const offline = createPagesSearchBindings(environment, async () => {
      throw new Error("private network diagnostic");
    });
    await expect(
      offline.AI!.run("ignored", { text: ["query"] }),
    ).rejects.toMatchObject({ status: 503, code: "SEARCH_UNAVAILABLE" });
  });
});
