import { objectRequirement } from "@savia/insurance-workbench/schema";
import { manifest } from "./manifest";
export const requirement = objectRequirement(
  manifest,
  "insurance_communications",
  [
    { key: "title", label: "Nombre", required: true },
    { key: "payload", label: "Contenido", type: "textarea", maxLength: 10000 },
    { key: "stage", label: "Estado" },
  ],
);
