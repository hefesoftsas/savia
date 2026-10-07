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

function quoteOperations(
  products: Array<{ id: string; label: string; enabled: boolean }>,
  quoteRequest: (flowId: string, init?: RequestInit) => Promise<unknown>,
  persisted: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }>,
  persistenceRequest?: (
    path: string,
    init?: RequestInit,
  ) => Promise<unknown> | undefined,
) {
  return new InsuranceAssistantOperations({
    resolveStudioTenantId: async () => 7,
    listStudioCollectionsForTenant: async () => ({
      data: [{ name: "cotizaciones" }, { name: "cotizaciones_detalle" }],
    }),
    studioPath: (_tenant, path) => path,
    request: async (path, init) => {
      if (path.endsWith("settings"))
        return { data: { value: { products } } } as any;
      if (path.endsWith("actions/quote")) {
        const body = JSON.parse(String(init?.body)) as {
          input: { mode: string; flowId: string };
        };
        return quoteRequest(body.input.flowId, init) as any;
      }
      const customPersistence = persistenceRequest?.(path, init);
      if (customPersistence) return customPersistence as any;
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      persisted.push({
        path,
        method: init?.method ?? "GET",
        body,
      });
      if (init?.method === "POST")
        return {
          data: {
            id: path.endsWith("cotizaciones")
              ? "master"
              : `detail-${persisted.length}`,
            _version: 1,
          },
        } as any;
      return { data: {} } as any;
    },
  });
}

it("returns priced peer results when an execution provider ignores abort and times out", async () => {
  let resolveLate!: (value: unknown) => void;
  const late = new Promise((resolve) => {
    resolveLate = resolve;
  });
  const persisted: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  const operations = quoteOperations(
    [
      { id: "hang", label: "Carrier A · Product", enabled: true },
      { id: "priced", label: "Carrier B · Product", enabled: true },
    ],
    async (flowId) => {
      if (flowId === "hang") return late;
      return {
        data: {
          run: { runId: "run-priced" },
          output: { data: { premiumTotal: 123456 } },
        },
      };
    },
    persisted,
  );
  const result = await operations.createInsuranceQuote(input, {
    executionKey: "timeout-test",
    executionTimeouts: { requestMs: 25, budgetMs: 100 },
  });

  expect(result).toMatchObject({
    pricedOffers: 1,
    uncertainOffers: 1,
    lowestPremium: 123456,
  });
  expect(
    persisted.find(
      (entry) =>
        entry.path.includes("cotizaciones_detalle/") &&
        entry.method === "PATCH" &&
        entry.body.estado === "Error",
    ),
  ).toBeTruthy();

  resolveLate({
    data: {
      run: { runId: "late-run" },
      output: { data: { premiumTotal: 1 } },
    },
  });
  await Promise.resolve();
  expect(
    persisted.filter(
      (entry) =>
        entry.path.includes("cotizaciones_detalle/") &&
        entry.method === "PATCH",
    ),
  ).toHaveLength(2);
  expect(
    persisted.some(
      (entry) =>
        entry.path.includes("cotizaciones_detalle/") && entry.body.prima === 1,
    ),
  ).toBe(false);
});

it("does not dispatch products once the WhatsApp quote request budget expires", async () => {
  const persisted: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  const products = Array.from({ length: 28 }, (_, index) => ({
    id: `hang-${index}`,
    label: `Carrier ${index} · Product`,
    enabled: true,
  }));
  let dispatches = 0;
  const operations = quoteOperations(
    products,
    async () => {
      dispatches++;
      return new Promise(() => undefined);
    },
    persisted,
  );
  const result = await operations.createInsuranceQuote(input, {
    executionKey: "budget-test",
    executionTimeouts: { requestMs: 15, budgetMs: 75 },
  });

  expect(dispatches).toBeLessThan(products.length);
  expect(result).toMatchObject({
    totalOffers: products.length,
    undispatchedOffers: expect.any(Number),
    pricedOffers: 0,
  });
  expect(result.undispatchedOffers).toBeGreaterThan(0);
  expect(result.uncertainOffers).toBe(dispatches);
});

it("bounds stalled detail persistence without dispatching the provider", async () => {
  let providerDispatches = 0;
  const persisted: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  const operations = quoteOperations(
    [{ id: "stalled-detail", label: "Carrier · Product", enabled: true }],
    async () => {
      providerDispatches++;
      return {};
    },
    persisted,
    (path, init) => {
      if (path.endsWith("cotizaciones_detalle") && init?.method === "POST")
        return new Promise(() => undefined);
      return undefined;
    },
  );

  const result = await operations.createInsuranceQuote(input, {
    executionKey: "persistence-timeout-test",
    executionTimeouts: { requestMs: 15, budgetMs: 100 },
  });

  expect(providerDispatches).toBe(0);
  expect(result).toMatchObject({
    totalOffers: 1,
    undispatchedOffers: 1,
    uncertainOffers: 0,
    persistenceWarnings: [expect.stringContaining("no se envió")],
  });
});

it("does not start a provider when a dispatch claim resolves after the budget", async () => {
  let providerDispatches = 0;
  const persisted: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  const operations = quoteOperations(
    [{ id: "late-claim", label: "Carrier · Product", enabled: true }],
    async () => {
      providerDispatches++;
      return {};
    },
    persisted,
  );

  const result = await operations.createInsuranceQuote(input, {
    executionKey: "late-claim-test",
    executionTimeouts: { requestMs: 100, budgetMs: 20 },
    claimDispatch: async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return true;
    },
  });

  expect(providerDispatches).toBe(0);
  expect(result).toMatchObject({
    totalOffers: 1,
    undispatchedOffers: 1,
    uncertainOffers: 0,
  });
});

it("keeps interactive quote requests unbounded by the WhatsApp timeout", async () => {
  let resolveProvider!: (value: unknown) => void;
  const providerResponse = new Promise((resolve) => {
    resolveProvider = resolve;
  });
  const persisted: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  const operations = quoteOperations(
    [{ id: "interactive", label: "Carrier · Product", enabled: true }],
    async () => providerResponse,
    persisted,
  );
  let settled = false;
  const resultPromise = operations
    .createInsuranceQuote(input)
    .then((result) => {
      settled = true;
      return result;
    });

  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(settled).toBe(false);
  resolveProvider({
    data: {
      run: { runId: "interactive-run" },
      output: { data: { premiumTotal: 1234 } },
    },
  });
  await expect(resultPromise).resolves.toMatchObject({ pricedOffers: 1 });
});

it("preserves the interactive offer count when detail persistence fails", async () => {
  const persisted: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  const operations = quoteOperations(
    [
      { id: "unpersisted", label: "Carrier A · Product", enabled: true },
      { id: "received", label: "Carrier B · Product", enabled: true },
    ],
    async () => ({
      data: {
        run: { runId: "interactive-run" },
        output: { data: { premiumTotal: 1234 } },
      },
    }),
    persisted,
    (path, init) => {
      if (
        path.endsWith("cotizaciones_detalle") &&
        init?.method === "POST" &&
        String(init.body).includes("Carrier A")
      )
        return Promise.reject(new Error("detail write failed"));
      return undefined;
    },
  );

  const result = await operations.createInsuranceQuote(input);

  expect(result).toMatchObject({ totalOffers: 1, pricedOffers: 1 });
});

it("rejects a changed confirmed product set before quote writes or dispatch", async () => {
  let providerDispatches = 0;
  const persisted: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  const operations = quoteOperations(
    [{ id: "current-product", label: "Carrier · Product", enabled: true }],
    async () => {
      providerDispatches++;
      return {};
    },
    persisted,
  );

  await expect(
    operations.createInsuranceQuote(input, {
      executionKey: "product-snapshot-mismatch",
      expectedProductIds: ["confirmed-product"],
    }),
  ).rejects.toThrow("Confirmed quote products changed");

  expect(persisted).toEqual([]);
  expect(providerDispatches).toBe(0);
});

it("runs a confirmed quote when enabled products still match the snapshot", async () => {
  const persisted: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  const operations = quoteOperations(
    [{ id: "confirmed-product", label: "Carrier · Product", enabled: true }],
    async () => ({
      data: {
        run: { runId: "matching-product" },
        output: { data: { premiumTotal: 9876 } },
      },
    }),
    persisted,
  );

  const result = await operations.createInsuranceQuote(input, {
    executionKey: "product-snapshot-match",
    expectedProductIds: ["confirmed-product"],
  });

  expect(result).toMatchObject({
    totalOffers: 1,
    pricedOffers: 1,
    lowestPremium: 9876,
  });
  expect(
    persisted.some(
      (entry) => entry.path.endsWith("cotizaciones") && entry.method === "POST",
    ),
  ).toBe(true);
});
