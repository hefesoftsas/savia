import { describe, expect, it, vi } from "vitest";
import { createInsuranceSaviaRequestConnectorAction } from "../src/savia-request-adapter";

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

const context = {
  tenantId: "tenant-a",
  principalId: "user-a",
  extensionId: "insurance.quotes",
  actionId: "quote",
  connectionId: "simulation",
  runId: "run-a",
};

describe("insurance Savia Request connector action", () => {
  it("normalizes the Sura lookup through its declared private flow", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        "https://savia-request.internal/api/flows/sura-autos-provider/runs?tenant=tenant-a",
      );
      expect(request.headers.get("x-savia-tenant")).toBe("tenant-a");
      expect(await request.json()).toEqual({
        mode: "mock",
        input: { sura_test_plate: "TESTCAR" },
      });
      return Response.json({
        status: "success",
        result: {
          response: {
            placa: "TESTCAR",
            modelo: "2024",
            fasecolda: "04408010",
            valorAsegurado: 65000000,
          },
        },
      });
    });
    const action = createInsuranceSaviaRequestConnectorAction({ fetch });

    const result = await action.execute({
      context,
      connection: {},
      input: { mode: "mock", flowId: "sura-autos-provider", quoteInput },
    });

    expect(result).toMatchObject({
      type: "vehicle_lookup",
      provider: "Sura",
      data: { vehicle: { plate: "TESTCAR", productionYear: 2024 } },
    });
    expect(JSON.stringify(result)).not.toContain("apiKey");
  });

  it("rejects an arbitrary flow before making a service request", async () => {
    const fetch = vi.fn();
    const action = createInsuranceSaviaRequestConnectorAction({ fetch });

    await expect(
      action.execute({
        context,
        connection: {},
        input: {
          mode: "mock",
          flowId: "https://evil.invalid",
          quoteInput,
        },
      }),
    ).rejects.toThrow("Flow de Seguros no permitido");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails the action when Savia Request is unavailable instead of returning an empty quote", async () => {
    const action = createInsuranceSaviaRequestConnectorAction(undefined);

    await expect(
      action.execute({
        context,
        connection: {},
        input: {
          mode: "live",
          flowId: "sbs-producto-8",
          quoteInput,
        },
      }),
    ).rejects.toThrow("Savia Request no está disponible");
  });
});
