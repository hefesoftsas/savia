import { objectRequirement } from "@savia/insurance-workbench/schema";
import { manifest } from "./manifest";
import { fields } from "./fields";
export const requirement = objectRequirement(
  manifest,
  "insurance_compliance",
  fields,
);
requirement.object.config.fields.dossier_key = {
  type: "Textbox",
  label: "Clave de requisito",
  labels: {},
  config: { unique: true, maxLength: 200 },
};
requirement.object.config.fields.customer_id = {
  type: "Textbox",
  label: "Identificador del cliente",
  labels: {},
  config: { maxLength: 200 },
};
requirement.object.config.fieldOrder = [
  ...(requirement.object.config.fieldOrder ?? []),
  "dossier_key",
  "customer_id",
];
