import { expect, it } from "vitest";
import { InsuranceAssistantOperations } from "../src/assistant-operations";
const input = {
  vehicle: {
    plate: "TESTCAR",
    fasecoldaCode: "12345678",
    productionYear: 2011,
    isNew: false,
    circulationCity: "11001",
    accessoriesValue: 0,
    declaredValue: 16000000,
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
};
it("preserves an uncertain dispatched quote and never replays a claimed product", async () => {
  let owned = false,
    calls = 0,
    claimed = false;
  const operations = new InsuranceAssistantOperations({
    resolveStudioTenantId: async () => 7,
    listStudioCollectionsForTenant: async () => ({
      data: [{ name: "cotizaciones" }, { name: "cotizaciones_detalle" }],
    }),
    studioPath: (_tenant, path) => path,
    request: async (path, init) => {
      if (path.endsWith("settings"))
        return {
          data: {
            value: {
              products: [
                { id: "enabled", label: "Carrier · Product", enabled: true },
                { id: "disabled", label: "Disabled", enabled: false },
              ],
            },
          },
        } as any;
      if (path.endsWith("actions/quote")) {
        expect(owned).toBe(true);
        calls++;
        throw new Error("Lost acknowledgement");
      }
      if (init?.method === "POST") {
        expect(new Headers(init.headers).get("Idempotency-Key")).toContain(
          "execution-test",
        );
        return {
          data: {
            id: path.endsWith("cotizaciones") ? "master" : "detail",
            _version: 1,
          },
        } as any;
      }
      return { data: {} } as any;
    },
  });
  const options = {
    executionKey: "execution-test",
    linkOwnership: async () => {
      owned = true;
    },
    claimDispatch: async () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
  };
  const result = await operations.createInsuranceQuote(input, options);
  expect(result.totalOffers).toBe(1);
  expect(result).toMatchObject({ uncertainOffers: 1 });
  expect(calls).toBe(1);
  expect(await operations.createInsuranceQuote(input, options)).toMatchObject({
    uncertainOffers: 1,
  });
  expect(calls).toBe(1);
});
