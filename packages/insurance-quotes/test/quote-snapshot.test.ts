import { describe, expect, it } from "vitest";
import {
  buildResultSnapshot,
  parseResultSnapshot,
  serializeSnapshot,
} from "../src/quote-snapshot";

const coverages = {
  rce: "$3.000.000.000 COP",
  partialLossDeductible: "10% mín. 1 SMMLV",
  totalLossDeductible: "10% deducible",
  replacementCar: "10 días continuos",
  craneAssistance: "Hasta 150 km / evento",
  designatedDriver: "8 servicios / año",
  medicalExpenses: "Hasta $60M COP",
  legalAssistance: "Abogado presencial / Ilimitada",
  workshop: "Red de talleres",
};

describe("quote result snapshot", () => {
  it("builds an allowlisted snapshot without raw payloads", () => {
    const snapshot = buildResultSnapshot({
      provider: "SBS Seguros",
      productName: "Plan Gold",
      premium: 1250000,
      quoteNumber: "SIM-123",
      monthlyInstallment: 104167,
      score: 9.6,
      badges: ["Todo Riesgo"],
      coverages,
      highlights: ["RCE $3.000M"],
    });
    expect(snapshot).toMatchObject({
      provider: "SBS Seguros",
      productName: "Plan Gold",
      premium: 1250000,
      quoteNumber: "SIM-123",
    });
    expect(snapshot?.coverages).toEqual(coverages);
  });

  it("round-trips through serialization", () => {
    const snapshot = buildResultSnapshot({
      provider: "Liberty",
      productName: "Full",
      premium: 1448081,
      coverages,
      badges: [],
      highlights: [],
    });
    expect(snapshot).not.toBeNull();
    const parsed = parseResultSnapshot(serializeSnapshot(snapshot!));
    expect(parsed).toEqual(snapshot);
  });

  it("rejects snapshots with missing coverages or corrupt JSON", () => {
    expect(
      buildResultSnapshot({ provider: "SBS", productName: "Gold", premium: 1, coverages: { rce: "x" } }),
    ).toBeNull();
    expect(parseResultSnapshot("not-json")).toBeNull();
    expect(parseResultSnapshot("")).toBeNull();
    expect(parseResultSnapshot(JSON.stringify({ provider: "x" }))).toBeNull();
  });

  it("ignores extra fields instead of persisting raw payloads", () => {
    const parsed = parseResultSnapshot(
      JSON.stringify({
        provider: "SBS Seguros",
        productName: "Gold",
        premium: 1000000,
        coverages,
        badges: [],
        highlights: [],
        response: { secret: "token-123", raw: [1, 2, 3] },
        applicant: { documentNumber: "123" },
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("response");
    expect(parsed).not.toHaveProperty("applicant");
  });
});
