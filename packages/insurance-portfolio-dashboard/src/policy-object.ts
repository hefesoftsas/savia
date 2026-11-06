import type { ExtensionObjectRequirement } from "@savia/studio-shared/extension-package";

export const insurancePortfolioPolicyRequirement = {
  id: "insurance.portfolio-dashboard",
  object: {
    name: "polizas",
    label: "Pólizas",
    description: "Vigencias y condiciones de las pólizas del espacio.",
    config: {
      version: 2,
      fields: {
        name: {
          type: "Textbox",
          label: "Póliza",
          labels: {},
          required: true,
        },
        inicio: {
          type: "DateControl",
          label: "Inicio",
          labels: {},
        },
        fin: {
          type: "DateControl",
          label: "Fin",
          labels: {},
        },
        prima: {
          type: "Number",
          label: "Prima",
          labels: {},
        },
        estado: {
          type: "Dropdown",
          label: "Estado",
          labels: {},
          options: [
            { label: "Vigente", value: "Vigente" },
            { label: "Vencida", value: "Vencida" },
            { label: "Cancelada", value: "Cancelada" },
          ],
        },
      },
      fieldOrder: ["name", "inicio", "fin", "prima", "estado"],
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
} satisfies ExtensionObjectRequirement;
