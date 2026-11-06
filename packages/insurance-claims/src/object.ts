import { objectRequirement } from "@savia/insurance-workbench/schema";
import { manifest } from "./manifest";
import { fields } from "./fields";
export const requirement = objectRequirement(
  manifest,
  "insurance_claims",
  fields,
);
