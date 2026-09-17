import { describe, expect, it, vi } from "vitest";
import { createRuntimeConnectorApp } from "../src/index";

const quoteInput = {
  vehicle: {
    plate: "TESTCAR",
    fasecoldaCode: "04408010",
    productionYear: 2024,
    isNew: false,
    circulationCity: "11001",
    accessoriesValue: 0,
    declaredValue: 50000000,
  },
  applicant: {
    documentType: "CC",
    documentNumber: "12345678",
    firstName: "Ana",
    surname: "Pérez",
    gender: "F",
    birthDate: "1990-01-01",
    city: "11001",
    address: "Calle 1",
    phone: "3001234567",
    email: "ana@example.test",
  },
};

describe("insurance Savia Request action", () => {
  it("binds only the private Savia Request service for an optional action", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        status: "success",
        result: { response: { placa: "TESTCAR", modelo: "2024" } },
      }),
    );
    const app = createRuntimeConnectorApp({
      database: {} as D1Database,
      SAVIA_REQUEST: { fetch },
    });

    const response = await app.request(
      "https://savia-connectors.internal/internal/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: "tenant-a",
          principalId: "user-a",
          extensionId: "insurance.quotes",
          actionId: "quote",
          connectionId: "simulation",
          runId: "run-a",
          input: { mode: "mock", flowId: "sura-autos-provider", quoteInput },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "succeeded",
      output: {
        type: "vehicle_lookup",
        data: { vehicle: { plate: "TESTCAR" } },
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
