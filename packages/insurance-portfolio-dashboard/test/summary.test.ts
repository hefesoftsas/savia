import { describe, expect, it } from "vitest";
import { insurancePortfolioExtensionManifest } from "../src/manifest";
import { summarizeInsurancePortfolio } from "../src/summary";

const asOf = "2026-09-14T00:00:00.000Z";

describe("insurance portfolio dashboard extension", () => {
  it("keeps the portfolio extension independent from quote execution", () => {
    expect(insurancePortfolioExtensionManifest).toMatchObject({
      format: "savia.extension",
      id: "insurance.portfolio-dashboard",
      requires: [],
      apiVersion: 1,
    });
  });

  it("returns an empty portfolio with the host reference timestamp", () => {
    expect(summarizeInsurancePortfolio([], asOf)).toEqual({
      total: 0,
      active: 0,
      expiring: 0,
      premiumTotal: null,
      asOf,
    });
  });

  it("counts active policies, near expirations, and recognized premiums", () => {
    expect(
      summarizeInsurancePortfolio(
        [
          {
            estado: "Vigente",
            fin: "2026-09-20",
            prima: "1000",
          },
          {
            status: "active",
            expirationDate: "2026-10-15",
            premium: 2500,
          },
          {
            estado: "Vencida",
            fecha_vencimiento: "2026-09-18",
            prima: 9000,
          },
          { estado: "borrador", prima: "not-a-number" },
        ],
        asOf,
      ),
    ).toEqual({
      total: 4,
      active: 2,
      expiring: 1,
      premiumTotal: 3500,
      asOf,
    });
  });

  it("returns a null premium when active policies have no recognized amount", () => {
    expect(
      summarizeInsurancePortfolio(
        [{ estado: "activa", valor: 800 }, { status: "active" }],
        asOf,
      ),
    ).toMatchObject({ premiumTotal: null });
  });
});
