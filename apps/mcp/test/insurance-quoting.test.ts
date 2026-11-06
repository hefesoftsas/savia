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
      if (path === "/v1/assistant/active-tenant")
        return Response.json({ activeTenantId: 0, tenants: [] });
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
  expect(
    calls.find((call) => call.path.endsWith("/actions/quote"))?.body,
  ).toEqual({
    input: {
      mode: "live",
      flowId: "sura-autos-provider",
      quoteInput: { vehicle: { plate: "TESTCAR" } },
    },
  });
});

it("resolves and uses the caller's active tenant for plate lookup", async () => {
  const paths: string[] = [];
  let activeTenantId = 4;
  const client = new SaviaApiClient(
    "https://api.test",
    "caller",
    async (url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path === "/v1/assistant/active-tenant")
        return Response.json({
          activeTenantId,
          tenants: [{ id: activeTenantId }],
        });
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
            data: { vehicle: { plate: "TESTCAR", productionYear: 2011 } },
          },
        },
      });
    },
  );

  await client.lookupQuoteVehicle("TESTCAR");
  activeTenantId = 8;
  await client.lookupQuoteVehicle("TESTCAR");

  expect(paths).toEqual([
    "/v1/assistant/active-tenant",
    "/v1/studio/4/api/extensions/insurance.quotes/settings",
    "/v1/studio/4/api/extensions/insurance.quotes/actions/quote",
    "/v1/assistant/active-tenant",
    "/v1/studio/8/api/extensions/insurance.quotes/settings",
    "/v1/studio/8/api/extensions/insurance.quotes/actions/quote",
  ]);
});

it("does not fall back to tenant zero when active-tenant resolution fails", async () => {
  const paths: string[] = [];
  const client = new SaviaApiClient(
    "https://api.test",
    "caller",
    async (url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      return path === "/v1/assistant/active-tenant"
        ? Response.json(
            {
              error: {
                code: "AUTHENTICATION_REQUIRED",
                message: "Sign in again",
              },
            },
            { status: 401 },
          )
        : Response.json({ data: {} });
    },
  );

  await expect(client.lookupQuoteVehicle("TESTCAR")).rejects.toThrow(
    "401 AUTHENTICATION_REQUIRED: Sign in again",
  );
  expect(paths).toEqual(["/v1/assistant/active-tenant"]);
});

it("keeps quote records, provider actions, and the returned link in one tenant", async () => {
  const paths: string[] = [];
  const client = new SaviaApiClient(
    "https://api.test",
    "caller",
    async (url, init) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path === "/v1/assistant/active-tenant")
        return Response.json({ activeTenantId: 4, tenants: [{ id: 4 }] });
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
              ],
            },
          },
        });
      if (path.endsWith("/actions/quote"))
        return Response.json({
          data: {
            run: { runId: "run-1" },
            output: { data: { premiumTotal: 1000 } },
          },
        });
      if (init?.method === "POST")
        return Response.json({
          data: {
            id: path.endsWith("/cotizaciones") ? "master-4" : "detail-4",
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

  expect(paths.filter((path) => path.startsWith("/v1/studio/"))).toEqual(
    expect.arrayContaining([
      "/v1/studio/4/api/objects",
      "/v1/studio/4/api/extensions/insurance.quotes/settings",
      "/v1/studio/4/api/records/cotizaciones",
      "/v1/studio/4/api/records/cotizaciones_detalle",
      "/v1/studio/4/api/extensions/insurance.quotes/actions/quote",
    ]),
  );
  expect(paths.some((path) => path.startsWith("/v1/studio/0/"))).toBe(false);
  expect(result.url).toContain("tenantId=4");
});

it("reads quote summary records and linked details from the active tenant", async () => {
  const paths: string[] = [];
  const client = new SaviaApiClient(
    "https://api.test",
    "caller",
    async (url) => {
      const parsed = new URL(String(url));
      const path = parsed.pathname + parsed.search;
      paths.push(path);
      if (parsed.pathname === "/v1/assistant/active-tenant")
        return Response.json({ activeTenantId: 4, tenants: [{ id: 4 }] });
      if (parsed.pathname.endsWith("/objects"))
        return Response.json({
          data: [{ name: "cotizaciones" }, { name: "cotizaciones_detalle" }],
        });
      if (parsed.pathname.endsWith("/records/cotizaciones"))
        return Response.json({
          data: [{ id: "q-4", name: "COT-4", estado: "Recibida" }],
          total: 1,
        });
      return Response.json({
        data: [{ estado: "Recibida", prima: 1000 }],
        total: 1,
      });
    },
  );

  await client.getQuoteSummary("COT-4");

  expect(
    paths
      .filter((path) => path.startsWith("/v1/studio/"))
      .map((path) => path.split("?")[0]),
  ).toEqual([
    "/v1/studio/4/api/objects",
    "/v1/studio/4/api/records/cotizaciones",
    "/v1/studio/4/api/records/cotizaciones_detalle",
  ]);
});

it("preserves tenant-zero compatibility when no active tenant is selected", async () => {
  const paths: string[] = [];
  const client = new SaviaApiClient(
    "https://api.test",
    "platform-admin",
    async (url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path === "/v1/assistant/active-tenant")
        return Response.json({ tenants: [{ id: 4, name: "Savia Team" }] });
      return Response.json({
        data: { value: { vehicleLookup: { enabled: false, flowId: "" } } },
      });
    },
  );

  await expect(client.lookupQuoteVehicle("TESTCAR")).rejects.toThrow(
    "La consulta de placa no está habilitada.",
  );
  expect(paths).toEqual([
    "/v1/assistant/active-tenant",
    "/v1/studio/0/api/extensions/insurance.quotes/settings",
  ]);
});

it("scopes CRM and extension requests to the fresh active tenant", async () => {
  const paths: string[] = [];
  const client = new SaviaApiClient(
    "https://api.test",
    "caller",
    async (url) => {
      const parsed = new URL(String(url));
      const path = parsed.pathname + parsed.search;
      paths.push(path);
      if (parsed.pathname === "/v1/assistant/active-tenant")
        return Response.json({ activeTenantId: 4, tenants: [{ id: 4 }] });
      if (parsed.pathname.endsWith("/objects"))
        return Response.json({ data: [{ name: "cotizaciones" }] });
      if (parsed.pathname.endsWith("/extensions"))
        return Response.json({
          data: [
            {
              manifest: { id: "insurance.quotes" },
              installed: { enabled: true },
            },
          ],
        });
      return Response.json({ data: { id: "q-4" } });
    },
  );

  await client.listStudioCollections({ all: true });
  await client.listStudioRecords("cotizaciones", { allowAny: true });
  await client.extensionStatus("insurance.quotes");
  await client.getExtensionSummary("insurance.quotes");
  await client.getStudioRecordLinks("cotizaciones", "q-4");

  expect(paths.filter((path) => path.startsWith("/v1/studio/"))).toEqual([
    "/v1/studio/4/api/objects",
    "/v1/studio/4/api/objects",
    "/v1/studio/4/api/records/cotizaciones?page=1&perPage=25",
    "/v1/studio/4/api/extensions",
    "/v1/studio/4/api/extensions/insurance.quotes/summary",
    "/v1/studio/4/api/objects",
    "/v1/studio/4/api/record-links/cotizaciones/q-4",
  ]);
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
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toBe("/api/lookups/dane");
      expect(requestUrl.searchParams.get("city")).toBe("Bogotá");
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
