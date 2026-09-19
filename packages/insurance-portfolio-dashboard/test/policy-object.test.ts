import { describe, expect, it } from "vitest";
import { insurancePortfolioPolicyRequirement } from "../src/policy-object";

describe("insurance portfolio policy requirement", () => {
  it("declares the minimum independent policy collection", () => {
    expect(insurancePortfolioPolicyRequirement).toMatchObject({
      id: "insurance.portfolio-dashboard",
      object: {
        name: "polizas",
        label: "Pólizas",
        config: {
          fieldOrder: ["name", "inicio", "fin", "prima", "estado"],
          fields: {
            name: { type: "Textbox", required: true },
            inicio: { type: "DateControl" },
            fin: { type: "DateControl" },
            prima: { type: "Number" },
            estado: {
              type: "Dropdown",
              options: [
                { value: "Vigente" },
                { value: "Vencida" },
                { value: "Cancelada" },
              ],
            },
          },
        },
      },
      requiredFields: {
        name: { types: ["Textbox"], required: true },
        inicio: { types: ["DateControl"] },
        fin: { types: ["DateControl"] },
        prima: { types: ["Number"] },
        estado: {
          types: ["Dropdown"],
          optionValues: ["Vigente", "Vencida", "Cancelada"],
        },
      },
    });
  });
});
