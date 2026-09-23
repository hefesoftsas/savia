import { describe, expect, it, vi } from "vitest";
import {
  executeJsonApi,
  JsonApiAdapterError,
  validateJsonApiBaseUrl,
} from "../src/studio/jsonapi-adapter";

const source = {
  baseUrl: "https://catalog.savia.dev/api",
  token: "private-token",
};
function fixture(
  response: Response | (() => Response),
  dnsAddress = "8.8.8.8",
) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      calls.push({ url, init });
      if (url.hostname === "cloudflare-dns.com")
        return Response.json({
          Status: 0,
          Answer:
            url.searchParams.get("type") === "A"
              ? [{ type: 1, data: dnsAddress }]
              : [],
        });
      return typeof response === "function" ? response() : response;
    },
  ) as unknown as typeof fetch;
  return { fetcher, calls };
}
const document = (data: unknown, extra = {}) =>
  new Response(JSON.stringify({ data, ...extra }), {
    headers: { "content-type": "application/vnd.api+json" },
  });

describe("isolated JSON:API adapter", () => {
  it("flattens records and typed linkage; uses explicit pagination, filters, sort and total", async () => {
    const f = fixture(
      document(
        [
          {
            type: "articles",
            id: "a1",
            attributes: { title: "Hola" },
            relationships: {
              author: { data: { type: "people", id: "p1" } },
              tags: { data: [{ type: "tags", id: "t1" }] },
            },
          },
        ],
        { meta: { total: 4 }, links: { next: "/api/articles?page[number]=2" } },
      ),
    );
    const result = await executeJsonApi(
      {
        source: {
          ...source,
          supportsSort: true,
          supportsFilters: true,
          totalPointer: "/meta/total",
        },
        resource: "articles",
        operation: "list",
        query: {
          page: 1,
          perPage: 2,
          sort: "-title",
          filters: [{ field: "title", op: "eq", value: "A & B" }],
        },
      },
      f.fetcher,
    );
    expect(result).toMatchObject({
      total: 4,
      hasNext: true,
      page: 1,
      perPage: 2,
      data: [
        {
          id: "a1",
          type: "articles",
          title: "Hola",
          author: "p1",
          tags: ["t1"],
          _relationships: { author: { type: "people", id: "p1" } },
        },
      ],
    });
    const request = f.calls.find(
      (c) => c.url.hostname !== "cloudflare-dns.com",
    )!;
    expect(request.url.searchParams.get("page[number]")).toBe("1");
    expect(request.url.searchParams.get("filter[title]")).toBe("A & B");
    expect(new Headers(request.init?.headers).get("authorization")).toBe(
      "Bearer private-token",
    );
    expect(request.init?.redirect).toBe("manual");
    for (const dns of f.calls.filter(
      (c) => c.url.hostname === "cloudflare-dns.com",
    ))
      expect(new Headers(dns.init?.headers).has("authorization")).toBe(false);
  });
  it("never invents total or completion when links and configured totals are absent", async () => {
    const f = fixture(document([], { meta: { total: 999 } }));
    const result = await executeJsonApi(
      { source, resource: "articles", operation: "list" },
      f.fetcher,
    );
    expect(result.total).toBeUndefined();
    expect(result.hasNext).toBeNull();
  });
  it("wraps create and update attributes/relationships and accepts empty deletion", async () => {
    for (const operation of ["create", "update"] as const) {
      const f = fixture(
        document({ type: "articles", id: "9", attributes: { title: "Hola" } }),
      );
      await executeJsonApi(
        {
          source,
          resource: "articles",
          operation,
          ...(operation === "update" ? { id: "9" } : {}),
          data: { title: "Hola", author: "person/7", tags: ["t1"] },
          relationships: {
            author: { type: "people" },
            tags: { type: "tags", multiple: true },
          },
        },
        f.fetcher,
      );
      const request = f.calls.find(
        (c) => c.url.hostname !== "cloudflare-dns.com",
      )!;
      expect(request.init?.method).toBe(
        operation === "create" ? "POST" : "PATCH",
      );
      expect(new Headers(request.init?.headers).get("content-type")).toBe(
        "application/vnd.api+json",
      );
      expect(JSON.parse(request.init!.body as string)).toEqual({
        data: {
          type: "articles",
          ...(operation === "update" ? { id: "9" } : {}),
          attributes: { title: "Hola" },
          relationships: {
            author: { data: { type: "people", id: "person/7" } },
            tags: { data: [{ type: "tags", id: "t1" }] },
          },
        },
      });
    }
    const f = fixture(new Response(null, { status: 204 }));
    expect(
      await executeJsonApi(
        { source, resource: "articles", id: "9", operation: "delete" },
        f.fetcher,
      ),
    ).toEqual({ data: null });
  });
  it("rejects unsafe hosts, resource traversal, IDs, unsupported queries before egress", async () => {
    for (const url of [
      "http://public.org",
      "https://localhost/",
      "https://127.0.0.1",
      "https://2130706433",
      "https://[::1]",
      "https://internal.local",
      "https://user:pass@public.org",
      "https://public.org:8443",
      "https://public.org/api?token=secret",
      "https://public.org/a/../b",
    ])
      expect(() => validateJsonApiBaseUrl(url)).toThrow(JsonApiAdapterError);
    for (const resource of [
      "../secret",
      "/articles",
      "https://other.org",
      "articles?x=1",
      "%2e%2e/secret",
      "a\\b",
    ]) {
      const f = fixture(document([]));
      await expect(
        executeJsonApi({ source, resource, operation: "list" }, f.fetcher),
      ).rejects.toMatchObject({ code: "JSONAPI_INVALID_RESOURCE" });
      expect(f.calls).toHaveLength(0);
    }
    const f = fixture(document([]));
    await expect(
      executeJsonApi(
        {
          source,
          resource: "articles",
          operation: "list",
          query: { sort: "title" },
        },
        f.fetcher,
      ),
    ).rejects.toMatchObject({ code: "JSONAPI_QUERY_UNSUPPORTED" });
    expect(f.calls).toHaveLength(0);
  });
  it("rejects private DNS answers and redirects without exposing upstream error text", async () => {
    const privateDns = fixture(document([]), "10.1.2.3");
    await expect(
      executeJsonApi(
        { source, resource: "articles", operation: "list" },
        privateDns.fetcher,
      ),
    ).rejects.toMatchObject({ code: "JSONAPI_INVALID_URL" });
    expect(
      privateDns.calls.filter((c) => c.url.hostname !== "cloudflare-dns.com"),
    ).toHaveLength(0);
    const redirect = fixture(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.org" },
      }),
    );
    await expect(
      executeJsonApi(
        { source, resource: "articles", operation: "list" },
        redirect.fetcher,
      ),
    ).rejects.toMatchObject({ code: "JSONAPI_REDIRECT" });
    const error = fixture(
      new Response("private-token\nupstream-secret", { status: 401 }),
    );
    await expect(
      executeJsonApi(
        { source, resource: "articles", operation: "read", id: "9" },
        error.fetcher,
      ),
    ).rejects.toMatchObject({
      code: "JSONAPI_UPSTREAM_ERROR",
      message: "El servicio JSON:API rechazó la operación.",
    });
  });
  it("bounds streamed responses and request bodies; validates document shape", async () => {
    const f = fixture(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1_048_577));
            controller.close();
          },
        }),
        { headers: { "content-type": "application/vnd.api+json" } },
      ),
    );
    await expect(
      executeJsonApi(
        { source, resource: "articles", operation: "list" },
        f.fetcher,
      ),
    ).rejects.toMatchObject({ code: "JSONAPI_RESPONSE_TOO_LARGE" });
    const large = fixture(document({ type: "articles", id: "1" }));
    await expect(
      executeJsonApi(
        {
          source,
          resource: "articles",
          operation: "create",
          data: { title: "x".repeat(1_048_577) },
        },
        large.fetcher,
      ),
    ).rejects.toMatchObject({ code: "JSONAPI_REQUEST_TOO_LARGE" });
    expect(large.calls).toHaveLength(0);
    const malformed = fixture(
      document([{ id: "1", attributes: { name: "No type" } }]),
    );
    await expect(
      executeJsonApi(
        { source, resource: "articles", operation: "list" },
        malformed.fetcher,
      ),
    ).rejects.toMatchObject({ code: "JSONAPI_INVALID_RESPONSE" });
  });
  it("reads the persisted representation after a successful PATCH without content", async () => {
    let writes = 0;
    const f = fixture(() =>
      ++writes === 1
        ? new Response(null, { status: 204 })
        : document({
            type: "articles",
            id: "9",
            attributes: { title: "Persisted" },
          }),
    );
    const result = await executeJsonApi(
      {
        source,
        resource: "articles",
        operation: "update",
        id: "9",
        data: { title: "Persisted" },
      },
      f.fetcher,
    );
    expect(result.data).toMatchObject({ id: "9", title: "Persisted" });
    expect(
      f.calls
        .filter((c) => c.url.hostname !== "cloudflare-dns.com")
        .map((c) => c.init?.method),
    ).toEqual(["PATCH", "GET"]);
  });
  it("times out and aborts a stalled remote request without retrying", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(document([]));
      let remoteSignal: AbortSignal | undefined;
      const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("cloudflare-dns.com"))
          return f.fetcher(input, init);
        remoteSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }) as typeof fetch;
      const assertion = expect(
        executeJsonApi(
          { source, resource: "articles", operation: "list" },
          fetcher,
        ),
      ).rejects.toMatchObject({ code: "JSONAPI_TIMEOUT", status: 504 });
      await vi.advanceTimersByTimeAsync(10_001);
      await assertion;
      expect(remoteSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects malformed next links and response attributes that collide with identity", async () => {
    const links = fixture(document([], { links: { next: false } }));
    await expect(
      executeJsonApi(
        { source, resource: "articles", operation: "list" },
        links.fetcher,
      ),
    ).rejects.toMatchObject({ code: "JSONAPI_INVALID_RESPONSE" });
    const collision = fixture(
      document({
        id: "9",
        type: "articles",
        attributes: { id: "overwritten" },
      }),
    );
    await expect(
      executeJsonApi(
        { source, resource: "articles", operation: "read", id: "9" },
        collision.fetcher,
      ),
    ).rejects.toMatchObject({ code: "JSONAPI_INVALID_RESPONSE" });
  });
});

it("executes a configured POST update with mapped JSON request and response", async () => {
  const { endpointSchema } =
    await import("@savia/studio-shared/collection-operations");
  const f = fixture(Response.json({ result: { key: 17, fullName: "Ana" } }));
  const endpoint = endpointSchema.parse({
    method: "POST",
    path: "people/save",
    format: "json",
    requestFields: { name: "fullName" },
    dataPointer: "/result",
    idPointer: "/key",
    responseFields: { name: "/fullName" },
  });
  const result = await executeJsonApi(
    {
      source,
      resource: "contacts",
      operation: "update",
      id: "17",
      data: { name: "Ana" },
      operations: {
        list: null,
        read: null,
        create: null,
        update: endpoint,
        delete: null,
      },
    },
    f.fetcher,
  );
  expect(result.data).toEqual({ id: "17", name: "Ana" });
  const sent = f.calls.find((c) => c.url.hostname === "catalog.savia.dev")!;
  expect(sent.url.pathname).toBe("/api/people/save");
  expect(sent.init?.method).toBe("POST");
  expect(JSON.parse(String(sent.init?.body))).toEqual({
    fullName: "Ana",
    id: "17",
  });
});
it("uses configured pagination, search and data/total pointers", async () => {
  const { endpointSchema } =
    await import("@savia/studio-shared/collection-operations");
  const f = fixture(
    Response.json({ items: [{ key: "1", title: "Uno" }], count: 4 }),
  );
  const endpoint = endpointSchema.parse({
    method: "GET",
    path: "people",
    format: "json",
    dataPointer: "/items",
    idPointer: "/key",
    totalPointer: "/count",
    pageParameter: "page",
    sizeParameter: "limit",
    searchParameter: "q",
    responseFields: { name: "/title" },
  });
  const result = await executeJsonApi(
    {
      source,
      resource: "contacts",
      operation: "list",
      query: { page: 2, perPage: 1, q: "Uno" },
      operations: {
        list: endpoint,
        read: null,
        create: null,
        update: null,
        delete: null,
      },
    },
    f.fetcher,
  );
  expect(result).toMatchObject({
    data: [{ id: "1", name: "Uno" }],
    total: 4,
    hasNext: true,
  });
  const sent = f.calls.find((c) => c.url.hostname === "catalog.savia.dev")!;
  expect(sent.url.search).toBe("?page=2&limit=1&q=Uno");
});
