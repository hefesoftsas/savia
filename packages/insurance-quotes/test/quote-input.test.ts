import { describe, expect, it } from "vitest";
import {
  applyVehicleLookup,
  defaultQuoteFormValues,
  updateQuoteValue,
  validateQuoteStep,
} from "../src/screens/quote-input";

describe("insurance quote form input", () => {
  it("normalizes the plate and blocks an incomplete vehicle step", () => {
    const values = updateQuoteValue(
      defaultQuoteFormValues,
      "vehicle.plate",
      " testcar ",
    );

    expect(values.vehicle.plate).toBe("TESTCAR");
    expect(validateQuoteStep(values, "vehicle")).toEqual({
      "vehicle.fasecoldaCode": "Ingresa el código Fasecolda.",
      "vehicle.productionYear": "Ingresa un año válido.",
      "vehicle.circulationCity": "Ingresa la ciudad de circulación.",
      "vehicle.declaredValue": "Ingresa un valor asegurado válido.",
    });
  });

  it("clears values filled by a lookup when the plate changes", () => {
    const lookedUp = applyVehicleLookup(
      updateQuoteValue(
        defaultQuoteFormValues,
        "vehicle.plate",
        "TESTCAR",
      ),
      {
        plate: "TESTCAR",
        fasecoldaCode: "123456",
        productionYear: 2024,
        declaredValue: 50000000,
        accessoriesValue: 0,
      },
    );

    const changed = updateQuoteValue(lookedUp, "vehicle.plate", "TESTALT");

    expect(changed.vehicle).toMatchObject({
      plate: "TESTALT",
      fasecoldaCode: "",
      productionYear: "",
      declaredValue: "",
      accessoriesValue: "0",
    });
  });
});
