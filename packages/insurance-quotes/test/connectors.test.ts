import { describe, expect, it, vi } from "vitest";
import type { ExtensionActionContext } from "@savia/crm-shared/extension-runtime";
import { createInsuranceQuotes, insuranceQuotes } from "../src/connectors";
import { insuranceQuotesExtension } from "../src/manifest";

const context: ExtensionActionContext = {
  tenantId: "tenant:acme",
  principalId: "user:ana",
  extensionId: "insurance.quotes",
  actionId: "quote",
  connectionId: "sura-main",
  runId: "run:quote-1",
};

describe("insurance.quotes connector", () => {
  it("declares quote execution optional only for simulation", () => {
    expect(
      insuranceQuotesExtension.runtime.actions?.find(
        (action) => action.actionId === "quote",
      ),
    ).toMatchObject({ connectionOptional: true });
  });

  it("returns a deterministic simulated quote without invoking a provider", async () => {
    const executeProviderQuote = vi.fn();
    const quotes = createInsuranceQuotes({ executeProviderQuote });

    const result = await quotes.execute(
      { ...context, connectionId: "simulation" },
      {
        mode: "mock",
        operationId: "sbs-product-8-quote",
        vehicle: { plate: "TESTCAR" },
      },
    );

    expect(result.output).toMatchObject({
      type: "quote",
      provider: "simulation",
      status: "success",
      data: {
        quoteNumber: "SIM-TESTCAR-sbs-product-8-quote",
        premiumTotal: 1200000,
        simulated: true,
      },
    });
    expect(executeProviderQuote).not.toHaveBeenCalled();
  });

  it("normalizes an insurer response without leaking connector configuration", async () => {
    const quotes = createInsuranceQuotes({
      executeProviderQuote: async () => ({
        status: 200,
        data: {
          quoteNumber: "Q-100",
          premiumTotal: 245000,
          apiKey: "provider-echo",
        },
      }),
    });

    const result = await quotes.execute(
      context,
      { operationId: "sura-auto-quote", vehicle: { plate: "TESTCAR" } },
      {
        provider: "sura",
        credentials: { apiKey: "tenant-secret" },
      },
    );

    expect(result.output).toMatchObject({
      type: "quote",
      provider: "sura",
      status: "success",
    });
    expect(JSON.stringify(result.output)).not.toContain("apiKey");
    expect(JSON.stringify(result.output)).not.toContain("tenant-secret");
  });

  it("rejects a quote action with a connector from another extension", () => {
    expect(() => insuranceQuotes.action("quote", "inventory.sync")).toThrow(
      "insurance.quotes.provider",
    );
  });

  it("executes a configured provider operation with the tenant connection", async () => {
    const quotes = createInsuranceQuotes({
      fetcher: async (request) => {
        const providerRequest = new Request(request);
        expect(providerRequest.url).toBe(
          "https://apisura.segurossura.com/apimovilidad/v1/vehiculo/placa/TESTCAR",
        );
        expect(providerRequest.headers.get("x-apikey")).toBe("tenant-secret");
        return Response.json({ plate: "TESTCAR", apiKey: "provider-echo" });
      },
    });

    const result = await quotes.execute(
      context,
      { operationId: "sura-vehicle-by-plate", sura_test_plate: "TESTCAR" },
      {
        provider: "sura",
        credentials: { sura_api_key: "tenant-secret" },
      },
    );

    expect(result.output).toMatchObject({
      type: "vehicle_lookup",
      provider: "sura",
      data: { vehicle: { plate: "TESTCAR" } },
    });
    expect(JSON.stringify(result.output)).not.toContain("apiKey");
  });
});
