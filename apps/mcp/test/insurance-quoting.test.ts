import { describe, it, expect } from "vitest";
import { SaviaApiClient } from "../src/savia-api";

describe("assistant insurance quoting", () => {
  it("rejects incomplete input before making provider calls", async () => {
    const client = new SaviaApiClient(
      "https://api.test",
      "caller",
      async () => {
        throw new Error("Unexpected request");
      },
    );
    await expect(
      client.createInsuranceQuote({ vehicle: { plate: "TESTCAR" } }),
    ).rejects.toThrow();
  });
  it("saves successful and failed offers and returns the saved quote link", async () => {
    const writes: Array<{ path: string; body: any }> = [];
    const client = new SaviaApiClient(
      "https://api.test",
      "caller",
      async (url, init) => {
        const path = new URL(String(url)).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (body) writes.push({ path, body });
        if (path.endsWith("/objects"))
          return Response.json({
            data: [{ name: "cotizaciones" }, { name: "cotizaciones_detalle" }],
          });
        if (path.endsWith("/settings"))
          return Response.json({
            data: {
              value: {
                products: [
                  {
                    id: "liberty-full-quote",
                    label: "Liberty · Full",
                    enabled: true,
                  },
                  { id: "sbs-producto-8", label: "SBS · Autos", enabled: true },
                ],
              },
            },
          });
        if (path.endsWith("/actions/quote"))
          return body.input.flowId === "sbs-producto-8"
            ? Response.json({ error: "failed" }, { status: 502 })
            : Response.json({
                data: {
                  run: { runId: "run-1" },
                  output: { data: { quoteNumber: "123", premiumTotal: 1000 } },
                },
              });
        if (init?.method === "POST")
          return Response.json({
            data: {
              id: path.endsWith("/cotizaciones")
                ? "master-1"
                : `detail-${writes.length}`,
              _version: 1,
            },
          });
        return Response.json({ data: { id: "saved", _version: 2 } });
      },
    );
    const result = await client.createInsuranceQuote({
      vehicle: {
        plate: "TESTCAR",
        fasecoldaCode: "12345678",
        productionYear: 2020,
        isNew: false,
        circulationCity: "11001",
        accessoriesValue: 0,
        declaredValue: 50000000,
      },
      applicant: {
        documentType: "CC",
        documentNumber: "123456789",
        firstName: "Test",
        surname: "User",
        gender: "F",
        birthDate: "1990-01-01",
        city: "11001",
        address: "Calle 1",
        phone: "3001234567",
        email: "test@example.test",
      },
    });
    expect(result).toMatchObject({
      quoteId: "master-1",
      failedOffers: 1,
      pricedOffers: 1,
      lowestPremium: 1000,
    });
    expect(result.url).toContain("quote=master-1");
    expect(
      writes.filter((w) => w.path.endsWith("/actions/quote")),
    ).toHaveLength(2);
    expect(writes.filter((w) => w.body.estado === "Recibida")).toHaveLength(2);
    expect(writes.some((w) => w.body.estado === "Error")).toBe(true);
  });
});

it("looks up only the configured vehicle lookup flow and returns normalized vehicle data", async () => {
  const calls: Array<{ path: string; body: any }> = [];
  const client = new SaviaApiClient(
    "https://api.test",
    "caller",
    async (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ path, body });
      if (path.endsWith("/settings"))
        return Response.json({
          data: {
            value: {
              vehicleLookup: { enabled: true, flowId: "sura-autos-provider" },
            },
          },
        });
      return Response.json({
        data: {
          output: {
            data: {
              vehicle: {
                plate: "TESTCAR",
                fasecoldaCode: "11101009",
                productionYear: 2011,
                declaredValue: 16000000,
                accessoriesValue: 0,
              },
            },
          },
        },
      });
    },
  );
  expect(await client.lookupQuoteVehicle("testcar")).toMatchObject({
    vehicle: {
      plate: "TESTCAR",
      fasecoldaCode: "11101009",
      productionYear: 2011,
    },
  });
  expect(calls[1].body).toEqual({
    input: {
      mode: "live",
      flowId: "sura-autos-provider",
      quoteInput: { vehicle: { plate: "TESTCAR" } },
    },
  });
});
it("rejects a quote flow masquerading as vehicle lookup", async () => {
  const client = new SaviaApiClient("https://api.test", "caller", async () =>
    Response.json({
      data: {
        value: {
          vehicleLookup: { enabled: true, flowId: "liberty-full-quote" },
        },
      },
    }),
  );
  await expect(client.lookupQuoteVehicle("TESTCAR")).rejects.toThrow();
});
it("uses the named DANE service rather than domain discovery", async () => {
  const client = new SaviaApiClient(
    "https://api.test",
    "caller",
    async (url) => {
      expect(String(url)).toContain(
        "/v1/savia-request/api/lookups/dane?city=Bogot",
      );
      return Response.json({
        status: "matched",
        matches: [{ code: "11001", city: "BOGOTÁ, D.C." }],
      });
    },
  );
  expect(await client.lookupDaneCity("Bogotá")).toMatchObject({
    status: "matched",
  });
});

it("does not use lookup details for a different plate", async () => {
  const client = new SaviaApiClient(
    "https://api.test",
    "caller",
    async (url) =>
      String(url).endsWith("/settings")
        ? Response.json({
            data: {
              value: {
                vehicleLookup: { enabled: true, flowId: "sura-autos-provider" },
              },
            },
          })
        : Response.json({
            data: {
              output: {
                data: { vehicle: { plate: "OTHER1", fasecoldaCode: "123" } },
              },
            },
          }),
  );
  await expect(client.lookupQuoteVehicle("TESTCAR")).rejects.toThrow(
    "No se encontraron datos verificados",
  );
});
