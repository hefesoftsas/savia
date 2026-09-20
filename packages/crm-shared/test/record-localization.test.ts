import { expect, it } from "vitest";
import { validateRecord, type CrmObject } from "../src/metadata";
const object = {
  name: "items",
  label: "Items",
  config: {
    fields: {
      name: {
        type: "Textbox",
        label: "Nombre",
        labels: { en: "Name", pt: "Nome" },
        required: true,
      },
      rate: {
        type: "Percentage",
        label: "Tasa",
        labels: { en: "Rate", pt: "Taxa" },
      },
    },
    fieldOrder: ["name", "rate"],
  },
} as CrmObject;
it("localizes validation with translated labels without changing validation or stored values", () => {
  expect(validateRecord(object, { name: "", rate: 200 }, "en").errors).toEqual({
    name: "Name: required",
    rate: "Rate: enter a number between 0 and 100",
  });
  expect(validateRecord(object, { name: "", rate: 200 }, "pt").errors).toEqual({
    name: "Nome: obrigatório",
    rate: "Taxa: informe um número entre 0 e 100",
  });
  expect(validateRecord(object, { name: "Custom", rate: 25 }, "pt")).toEqual({
    errors: {},
    data: { name: "Custom", rate: 25 },
  });
});
