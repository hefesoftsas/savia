import { objectRequirement } from "@savia/insurance-workbench/schema";
import { manifest } from "./manifest";
export const requirement = objectRequirement(manifest, "insurance_reports", [
  { key: "name", label: "Nombre", required: true, maxLength: 160 },
  { key: "details", label: "Detalle", type: "textarea", maxLength: 10000 },
  {
    key: "stage",
    label: "Estado",
    type: "select",
    options: [
      { value: "draft", label: "Borrador" },
      { value: "completed", label: "Completado" },
      { value: "failed", label: "Con errores" },
    ],
  },
]);
