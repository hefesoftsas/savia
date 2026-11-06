import { objectRequirement } from "@savia/insurance-workbench/schema";
import { manifest } from "./manifest";
export const requirement = objectRequirement(manifest, "insurance_accounting", [
  { key: "name", label: "Referencia", required: true },
]);
