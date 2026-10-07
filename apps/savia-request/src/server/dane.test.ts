import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import type { Env } from "./env";
import { lookupDaneCity } from "./dane";
let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: "wrangler.jsonc",
    persist: false,
  });
  for (const file of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync("migrations/" + file, "utf8")
      .split(";")
      .filter((sql) => sql.trim()))
      await platform.env.DB.prepare(statement).run();
  }
});
afterAll(async () => {
  await platform?.dispose();
});
const rows = [
  { cod_mpio: "11001", nom_mpio: "BOGOTÁ, D.C.", dpto: "BOGOTÁ, D.C." },
  { cod_mpio: "05001", nom_mpio: "MEDELLÍN", dpto: "ANTIOQUIA" },
  { cod_mpio: "05101", nom_mpio: "BOLÍVAR", dpto: "ANTIOQUIA" },
  { cod_mpio: "19100", nom_mpio: "BOLÍVAR", dpto: "CAUCA" },
];
it("resolves accents and Bogotá aliases using official returned rows", async () => {
  const fetcher = vi.fn(async () => Response.json(rows));
  expect(await lookupDaneCity("bogota", undefined, fetcher)).toMatchObject({
    status: "matched",
    matches: [{ code: "11001", city: "BOGOTÁ, D.C." }],
  });
  expect(await lookupDaneCity("Medellin", undefined, fetcher)).toMatchObject({
    status: "matched",
    matches: [{ code: "05001" }],
  });
});
it("does not pick a municipality when the name is ambiguous", async () => {
  const fetcher = async () => Response.json(rows);
  expect(await lookupDaneCity("bolivar", undefined, fetcher)).toMatchObject({
    status: "ambiguous",
  });
  expect(await lookupDaneCity("bolivar", "cauca", fetcher)).toMatchObject({
    status: "matched",
    matches: [{ code: "19100" }],
  });
});
it("never invents a code for missing cities or upstream errors", async () => {
  expect(
    await lookupDaneCity("Atlantis", undefined, async () =>
      Response.json(rows),
    ),
  ).toMatchObject({ status: "not_found", matches: [] });
  await expect(
    lookupDaneCity(
      "Bogota",
      undefined,
      async () => new Response("failed", { status: 503 }),
    ),
  ).rejects.toThrow();
});

it("exposes a private read-only lookup endpoint with input validation", async () => {
  const { default: app } = await import("./index");
  expect(
    (await app.request("https://public.example/api/lookups/dane?city=Bogota"))
      .status,
  ).toBe(403);
  expect(
    (await app.request("https://savia-request.internal/api/lookups/dane?city="))
      .status,
  ).toBe(400);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(rows)),
  );
  try {
    const response = await app.request(
      "https://savia-request.internal/api/lookups/dane?city=Bogota",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "matched",
      matches: [{ code: "11001" }],
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("reuses the persisted public catalog across cities and fresh module instances", async () => {
  const fetcher = vi.fn(async () => Response.json(rows));
  const first = await lookupDaneCity(
    "Bogota",
    undefined,
    fetcher,
    platform.env,
  );
  vi.resetModules();
  const fresh = await import("./dane");
  const second = await fresh.lookupDaneCity(
    "Medellin",
    undefined,
    fetcher,
    platform.env,
  );
  expect(second).toMatchObject({ matches: [{ code: "05001" }] });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(Date.parse(second.retrievedAt)).toBeLessThanOrEqual(
    Date.parse(first.retrievedAt) + 100,
  );
});

it("does not retain an invalid HTTP 200 catalog and accepts a subsequent corrected response", async () => {
  await platform.env.DB.prepare("DELETE FROM savia_request_cache").run();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json([{ cod_mpio: "invalid", nom_mpio: "City", dpto: "Dept" }]),
    )
    .mockResolvedValueOnce(Response.json(rows));
  await expect(
    lookupDaneCity("Bogota", undefined, fetcher, platform.env),
  ).rejects.toThrow();
  await expect(
    lookupDaneCity("Bogota", undefined, fetcher, platform.env),
  ).resolves.toMatchObject({ status: "matched" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("allows the catalog cache to be disabled through its operation policy", async () => {
  const fetcher = vi.fn(async () => Response.json(rows));
  const policy = {
    enabled: false,
    ttlSeconds: 86400,
    scope: "public" as const,
  };
  await lookupDaneCity("Bogota", undefined, fetcher, platform.env, policy);
  await lookupDaneCity("Bogota", undefined, fetcher, platform.env, policy);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([
  { ttl: 0, scope: "public", enabled: true, method: "GET", status: 400 },
  { ttl: 60, scope: "connection", enabled: true, method: "GET", status: 400 },
  { ttl: 60, scope: "public", enabled: true, method: "POST", status: 400 },
  { ttl: 60, scope: "public", enabled: false, method: "GET", status: 200 },
  { ttl: 60, scope: "tenant", enabled: true, method: "GET", status: 200 },
])(
  "validates a saved flow cache policy: $method $scope $enabled $ttl",
  async ({ ttl, scope, enabled, method, status }) => {
    const { default: app } = await import("./index");
    const response = await app.request(
      "https://savia-request.internal/api/flows/cache-config",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "cache-config",
          name: "Reference data",
          description: "",
          variables: [],
          input: {},
          steps: [
            {
              id: "catalog",
              name: "Catalog",
              url: "https://public.example/catalog",
              method,
              headers: {},
              body: "",
              pre: "",
              post: "",
              cache: { enabled, ttlSeconds: ttl, scope },
            },
          ],
        }),
      },
      platform.env,
    );
    expect(response.status).toBe(status);
  },
);
