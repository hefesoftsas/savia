import { expect, it, vi } from "vitest";
import { lookupDaneCity } from "./dane";
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
