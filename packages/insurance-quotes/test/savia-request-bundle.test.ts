import { describe, expect, it } from "vitest";
import * as bundle from "../src/savia-request-bundle";

type QuoteInput = {
  vehicle: {
    accessoriesValue: number;
    circulationCity: string;
    declaredValue: number;
    fasecoldaCode: string;
    isNew: boolean;
    plate: string;
    productionYear: number;
  };
  applicant: {
    address: string;
    birthDate: string;
    city: string;
    documentNumber: string;
    documentType: string;
    email: string;
    firstName: string;
    gender: string;
    phone: string;
    secondSurname?: string;
    surname: string;
  };
};

const quoteInput: QuoteInput = {
  vehicle: {
    accessoriesValue: 0,
    circulationCity: "11001",
    declaredValue: 50000000,
    fasecoldaCode: "04408010",
    isNew: false,
    plate: "TESTCAR",
    productionYear: 2024,
  },
  applicant: {
    address: "Calle 1",
    birthDate: "1990-01-01",
    city: "11001",
    documentNumber: "12345678",
    documentType: "CC",
    email: "ana@example.test",
    firstName: "Ana",
    gender: "F",
    phone: "3001234567",
    surname: "Pérez",
  },
};

const toSaviaRequestInput = (
  bundle as unknown as {
    toSaviaRequestInput?: (
      flowId: string,
      input: QuoteInput,
    ) => Record<string, string>;
  }
).toSaviaRequestInput;

describe("insurance Savia Request bundle", () => {
  it("maps the Sura plate lookup to its only declared input", () => {
    expect(toSaviaRequestInput).toEqual(expect.any(Function));
    expect(toSaviaRequestInput?.("sura-autos-provider", quoteInput)).toEqual({
      sura_test_plate: "TESTCAR",
    });
  });

  it("flattens the canonical form only for providers with first-class quote payloads", () => {
    expect(toSaviaRequestInput).toEqual(expect.any(Function));
    expect(toSaviaRequestInput?.("sbs-producto-8", quoteInput)).toMatchObject({
      "auto_light.applicant.documentNumber": "12345678",
      "auto_light.vehicle.isNew": "false",
      "auto_light.vehicle.plate": "TESTCAR",
    });
    expect(toSaviaRequestInput?.("previsora-clasica-quote", quoteInput)).toEqual(
      {},
    );
  });

  it("rejects a flow outside the package allowlist", () => {
    expect(toSaviaRequestInput).toEqual(expect.any(Function));
    expect(() => toSaviaRequestInput?.("other-flow", quoteInput)).toThrow(
      "Flow de Seguros no permitido",
    );
  });
});
