import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import type { Env } from "./env";
import {
  cacheRequest,
  validateRequestCachePolicy,
  type RequestCachePolicy,
} from "./request-cache";

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
const policy: RequestCachePolicy = {
  enabled: true,
  ttlSeconds: 60,
  scope: "tenant",
};
const context: {
  tenant: string;
  revision: string;
  connectionId?: string;
} = { tenant: "tenant:101", revision: "revision-1" };

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const migration of readdirSync("migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    const statements = readFileSync("migrations/" + migration, "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements)
      await platform.env.DB.prepare(statement).run();
  }
});

beforeEach(async () => {
  await platform.env.DB.prepare("DELETE FROM savia_request_cache").run();
  vi.useRealTimers();
});

afterAll(async () => {
  await platform?.dispose();
});

async function cacheKeyFor(
  url: string,
  requestPolicy: RequestCachePolicy = policy,
  requestContext = context,
) {
  const cacheKey = JSON.stringify({
    url: new URL(url).toString(),
    method: "GET",
    headers: [],
    revision: requestContext.revision,
    scope: requestPolicy.scope,
    tenant: requestPolicy.scope === "public" ? null : requestContext.tenant,
    connectionId:
      requestPolicy.scope === "connection" ? requestContext.connectionId : null,
    ttlSeconds: requestPolicy.ttlSeconds,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(cacheKey),
  );
  const key = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return key;
}

async function seedActiveLease(url: string) {
  const key = await cacheKeyFor(url);
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 35_000).toISOString();
  await platform.env.DB.prepare(
    `INSERT INTO savia_request_cache(cache_key,state,created_at,lease_token,lease_until)
     VALUES(?,'loading',?,'other-worker',?)`,
  )
    .bind(key, now, leaseUntil)
    .run();
  return key;
}

it("shares a successful bounded response across canonical query order", async () => {
  const fetcher = vi.fn(async () => Response.json({ value: "cached" }));
  const first = await cacheRequest(
    { DB: platform.env.DB },
    new Request("https://provider.test/catalog?z=2&a=1"),
    policy,
    context,
    fetcher,
  );
  const second = await cacheRequest(
    { DB: platform.env.DB },
    new Request("https://provider.test/catalog?a=1&z=2"),
    policy,
    context,
    fetcher,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(first.headers.get("x-savia-cache")).toBe("miss");
  expect(second.headers.get("x-savia-cache")).toBe("hit");
  expect(second.headers.get("x-savia-cache-age-ms")).toMatch(/^\d+$/);
  await expect(second.json()).resolves.toEqual({ value: "cached" });
  const stored = await platform.env.DB.prepare(
    "SELECT cache_key,response_body FROM savia_request_cache WHERE state='ready'",
  ).first<{ cache_key: string; response_body: string }>();
  expect(stored?.cache_key).toMatch(/^[a-f0-9]{64}$/);
  expect(stored?.response_body).toBeTruthy();
  expect(stored?.response_body).not.toContain("provider.test");
});

it("scopes entries by tenant, revision, and connection identity", async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  const call = (
    tenant: string,
    revision: string,
    connectionId?: string,
    ttlSeconds = policy.ttlSeconds,
  ) =>
    cacheRequest(
      { DB: platform.env.DB },
      new Request("https://provider.test/resource"),
      {
        ...policy,
        scope: connectionId ? "connection" : "tenant",
        ttlSeconds,
      },
      { tenant, revision, ...(connectionId ? { connectionId } : {}) },
      fetcher,
    );

  await call("tenant:101", "revision-1");
  await call("tenant:202", "revision-1");
  await call("tenant:101", "revision-2");
  await call("tenant:101", "revision-1", "connection-a");
  await call("tenant:101", "revision-1", "connection-b");
  await call("x:connection:y", "revision-1");
  await call("x", "revision-1", "y");
  await call("tenant:101", "revision-1", undefined, 30);

  expect(fetcher).toHaveBeenCalledTimes(8);
});

it("canonicalizes query key order without reordering repeated values or request headers", async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  const request = (query: string, accept: string) =>
    cacheRequest(
      { DB: platform.env.DB },
      new Request(`https://provider.test/list?${query}`, {
        headers: { accept },
      }),
      policy,
      context,
      fetcher,
    );

  const first = await request("z=2&sort=price&sort=rating", "application/json");
  const same = await request("sort=price&z=2&sort=rating", "application/json");
  const reversedValues = await request(
    "sort=rating&sort=price&z=2",
    "application/json",
  );
  const otherHeader = await request("sort=price&z=2&sort=rating", "text/plain");

  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(first.headers.get("x-savia-cache")).toBe("miss");
  expect(same.headers.get("x-savia-cache")).toBe("hit");
  expect(reversedValues.headers.get("x-savia-cache")).toBe("miss");
  expect(otherHeader.headers.get("x-savia-cache")).toBe("miss");
});

it("bypasses disabled, unsupported-method, sensitive-public, and unscoped requests", async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  const call = (
    request: Request,
    requestPolicy: RequestCachePolicy | undefined,
    requestContext = context,
  ) =>
    cacheRequest(
      { DB: platform.env.DB },
      request,
      requestPolicy,
      requestContext,
      fetcher,
    );

  const disabled = await call(new Request("https://provider.test/a"), {
    ...policy,
    enabled: false,
  });
  const post = await call(
    new Request("https://provider.test/a", { method: "POST" }),
    policy,
  );
  const publicQuery = await call(
    new Request("https://provider.test/a?api_key=secret"),
    { ...policy, scope: "public" },
  );
  const publicHeader = await call(
    new Request("https://provider.test/a", {
      headers: { authorization: "Bearer secret" },
    }),
    { ...policy, scope: "public" },
  );
  const noConnection = await call(
    new Request("https://provider.test/a"),
    { ...policy, scope: "connection" },
    { tenant: "tenant:101", revision: "revision-1" },
  );

  expect(fetcher).toHaveBeenCalledTimes(5);
  for (const response of [
    disabled,
    post,
    publicQuery,
    publicHeader,
    noConnection,
  ])
    expect(response.headers.get("x-savia-cache")).toBe("bypass");
  expect(
    await platform.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM savia_request_cache",
    ).first("count"),
  ).toBe(0);
});

it("does not persist failures or responses rejected by consumer validation", async () => {
  const failure = await cacheRequest(
    { DB: platform.env.DB },
    new Request("https://provider.test/failure"),
    policy,
    context,
    async () => Response.json({ error: true }, { status: 503 }),
  );
  const invalid = await cacheRequest(
    { DB: platform.env.DB },
    new Request("https://provider.test/semantic"),
    policy,
    {
      ...context,
      validateResponse: async (response) =>
        ((await response.json()) as { valid?: boolean }).valid === true,
    },
    async () => Response.json({ valid: false }),
  );

  expect(failure.status).toBe(503);
  expect(invalid.headers.get("x-savia-cache")).toBe("bypass");
  expect(
    await platform.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM savia_request_cache WHERE state='ready'",
    ).first("count"),
  ).toBe(0);
});

it("bypasses uncacheable response headers and responses larger than the body cap", async () => {
  const fetcher = vi.fn(async (request: Request) =>
    request.url.endsWith("/cookie")
      ? new Response("private", {
          headers: { "set-cookie": "session=secret" },
        })
      : request.url.endsWith("/no-cache")
        ? new Response("revalidate", {
            headers: { "cache-control": 'no-cache="etag"' },
          })
        : new Response("x".repeat(1_048_577)),
  );
  const cookie = await cacheRequest(
    { DB: platform.env.DB },
    new Request("https://provider.test/cookie"),
    policy,
    context,
    fetcher,
  );
  const large = await cacheRequest(
    { DB: platform.env.DB },
    new Request("https://provider.test/large"),
    policy,
    context,
    fetcher,
  );
  const noCache = await cacheRequest(
    { DB: platform.env.DB },
    new Request("https://provider.test/no-cache"),
    policy,
    context,
    fetcher,
  );

  expect(cookie.headers.get("x-savia-cache")).toBe("bypass");
  expect(large.headers.get("x-savia-cache")).toBe("bypass");
  expect(noCache.headers.get("x-savia-cache")).toBe("bypass");
  expect(
    await platform.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM savia_request_cache WHERE state='ready'",
    ).first("count"),
  ).toBe(0);
});

it("coalesces concurrent local requests and preserves independent response bodies", async () => {
  let resolveResponse!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
  );
  const request = () =>
    cacheRequest(
      { DB: platform.env.DB },
      new Request("https://provider.test/slow"),
      policy,
      context,
      fetcher,
    );
  const firstPromise = request();
  const secondPromise = request();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  resolveResponse(Response.json({ value: 42 }));
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  expect(
    [
      first.headers.get("x-savia-cache"),
      second.headers.get("x-savia-cache"),
    ].sort(),
  ).toEqual(["coalesced", "miss"]);
  await expect(first.json()).resolves.toEqual({ value: 42 });
  await expect(second.json()).resolves.toEqual({ value: 42 });
});

it("stops waiting when another worker releases its cache lease", async () => {
  const url = "https://provider.test/released-lease";
  const key = await seedActiveLease(url);
  const fetcher = vi.fn(async () => Response.json({ recovered: true }));
  const startedAt = Date.now();
  const pending = cacheRequest(
    { DB: platform.env.DB },
    new Request(url),
    policy,
    context,
    fetcher,
  );
  setTimeout(() => {
    void platform.env.DB.prepare(
      "DELETE FROM savia_request_cache WHERE cache_key=?",
    )
      .bind(key)
      .run();
  }, 100);

  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1), {
    timeout: 1_000,
  });
  const response = await pending;
  expect(Date.now() - startedAt).toBeLessThan(1_000);
  expect(response.headers.get("x-savia-cache")).toBe("miss");
});

it("waits past five seconds for the active lease owner instead of duplicating its fetch", async () => {
  const url = "https://provider.test/slow-distributed-owner";
  const key = await seedActiveLease(url);
  const fetcher = vi.fn(async () => Response.json({ duplicate: true }));
  const pending = cacheRequest(
    { DB: platform.env.DB },
    new Request(url),
    policy,
    context,
    fetcher,
  );

  await new Promise((resolve) => setTimeout(resolve, 5_200));
  expect(fetcher).not.toHaveBeenCalled();
  const retrievedAt = new Date().toISOString();
  await platform.env.DB.prepare(
    `UPDATE savia_request_cache
     SET state='ready',response_status=200,response_status_text='OK',response_headers='[]',
         response_body=?,retrieved_at=?,expires_at=?,lease_token=NULL,lease_until=NULL
     WHERE cache_key=?`,
  )
    .bind(
      btoa("owner response"),
      retrievedAt,
      new Date(Date.now() + 60_000).toISOString(),
      key,
    )
    .run();
  const response = await pending;
  expect(fetcher).not.toHaveBeenCalled();
  expect(response.headers.get("x-savia-cache")).toBe("coalesced");
  await expect(response.text()).resolves.toBe("owner response");
}, 15_000);

it("does not start a fallback fetch when a distributed cache waiter aborts", async () => {
  const url = "https://provider.test/aborted-lease";
  await seedActiveLease(url);
  const controller = new AbortController();
  const fetcher = vi.fn(async () => Response.json({ shouldNotFetch: true }));
  const pending = cacheRequest(
    { DB: platform.env.DB },
    new Request(url, { signal: controller.signal }),
    policy,
    context,
    fetcher,
  );
  setTimeout(() => controller.abort(), 20);

  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps a local waiter on the safe lease path when its leader aborts", async () => {
  const url = "https://provider.test/leader-aborts";
  const key = await seedActiveLease(url);
  const leaderController = new AbortController();
  const leaderFetcher = vi.fn(async () =>
    Response.json({ duplicate: "leader" }),
  );
  const waiterFetcher = vi.fn(async () =>
    Response.json({ duplicate: "waiter" }),
  );
  const leader = cacheRequest(
    { DB: platform.env.DB },
    new Request(url, { signal: leaderController.signal }),
    policy,
    context,
    leaderFetcher,
  );
  await new Promise((resolve) => setTimeout(resolve, 75));
  const waiter = cacheRequest(
    { DB: platform.env.DB },
    new Request(url),
    policy,
    context,
    waiterFetcher,
  );
  await new Promise((resolve) => setTimeout(resolve, 75));
  leaderController.abort();
  await expect(leader).rejects.toMatchObject({ name: "AbortError" });
  await new Promise((resolve) => setTimeout(resolve, 100));

  const retrievedAt = new Date().toISOString();
  await platform.env.DB.prepare(
    `UPDATE savia_request_cache
     SET state='ready',response_status=200,response_status_text='OK',response_headers='[]',
         response_body=?,retrieved_at=?,expires_at=?,lease_token=NULL,lease_until=NULL
     WHERE cache_key=?`,
  )
    .bind(
      btoa("long-lived waiter"),
      retrievedAt,
      new Date(Date.now() + 60_000).toISOString(),
      key,
    )
    .run();

  const response = await waiter;
  expect(response.headers.get("x-savia-cache")).toBe("coalesced");
  expect(leaderFetcher).not.toHaveBeenCalled();
  expect(waiterFetcher).not.toHaveBeenCalled();
  await expect(response.text()).resolves.toBe("long-lived waiter");
});

it("bounds retries for an unusable ready row without making an unclaimed fetch", async () => {
  const url = "https://provider.test/corrupt-ready-row";
  const key = await cacheKeyFor(url);
  const now = new Date().toISOString();
  await platform.env.DB.prepare(
    `INSERT INTO savia_request_cache(
       cache_key,state,response_status,response_status_text,response_headers,response_body,
       created_at,retrieved_at,expires_at
     ) VALUES(?,'ready',200,'OK','[1]',?,?,?,?)`,
  )
    .bind(
      key,
      btoa("invalid headers"),
      now,
      now,
      new Date(Date.now() + 60_000).toISOString(),
    )
    .run();
  const fetcher = vi.fn(async () => Response.json({ shouldNotFetch: true }));
  const startedAt = Date.now();

  await expect(
    cacheRequest(
      { DB: platform.env.DB },
      new Request(url),
      policy,
      context,
      fetcher,
    ),
  ).rejects.toMatchObject({ name: "TimeoutError" });
  expect(Date.now() - startedAt).toBeLessThan(1_000);
  expect(fetcher).not.toHaveBeenCalled();
});

it("validates cache policy bounds", () => {
  expect(validateRequestCachePolicy(undefined)).toBe(false);
  expect(validateRequestCachePolicy({ ...policy, enabled: false })).toBe(true);
  expect(validateRequestCachePolicy({ ...policy, ttlSeconds: 0 })).toBe(false);
  expect(
    validateRequestCachePolicy({ ...policy, ttlSeconds: 7 * 24 * 60 * 60 + 1 }),
  ).toBe(false);
  expect(validateRequestCachePolicy({ ...policy, enabled: "yes" } as any)).toBe(
    false,
  );
  expect(validateRequestCachePolicy(policy)).toBe(true);
});

it("expires entries at the configured TTL", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () =>
    Response.json({ version: fetcher.mock.calls.length }),
  );
  const call = () =>
    cacheRequest(
      { DB: platform.env.DB },
      new Request("https://provider.test/ttl"),
      { ...policy, ttlSeconds: 1 },
      context,
      fetcher,
    );
  await call();
  await vi.advanceTimersByTimeAsync(1001);
  const expired = await call();
  vi.useRealTimers();

  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(expired.headers.get("x-savia-cache")).toBe("miss");
});

it("lets a coalesced caller abort without cancelling the leader", async () => {
  let resolveResponse!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
  );
  const first = cacheRequest(
    { DB: platform.env.DB },
    new Request("https://provider.test/abort"),
    policy,
    context,
    fetcher,
  );
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const controller = new AbortController();
  const waiting = cacheRequest(
    { DB: platform.env.DB },
    new Request("https://provider.test/abort", { signal: controller.signal }),
    policy,
    context,
    fetcher,
  );
  controller.abort();

  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  resolveResponse(Response.json({ leader: true }));
  await expect(first).resolves.toMatchObject({ status: 200 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("does not share local flights across distinct D1 databases", async () => {
  const other = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  try {
    for (const migration of readdirSync("migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      const statements = readFileSync("migrations/" + migration, "utf8")
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements)
        await (other.env.DB as D1Database).prepare(statement).run();
    }
    const firstFetcher = vi.fn(async () => Response.json({ source: "first" }));
    const otherFetcher = vi.fn(async () => Response.json({ source: "other" }));
    const request = () => new Request("https://provider.test/isolation");
    const first = await cacheRequest(
      { DB: platform.env.DB },
      request(),
      policy,
      context,
      firstFetcher,
    );
    const second = await cacheRequest(
      { DB: other.env.DB as D1Database },
      request(),
      policy,
      context,
      otherFetcher,
    );

    expect(first.headers.get("x-savia-cache")).toBe("miss");
    expect(second.headers.get("x-savia-cache")).toBe("miss");
    expect(firstFetcher).toHaveBeenCalledTimes(1);
    expect(otherFetcher).toHaveBeenCalledTimes(1);
  } finally {
    await other.dispose();
  }
});
