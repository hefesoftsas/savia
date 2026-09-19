import { solutionPackageSchema } from "@savia/crm-shared/solution-package";
import manifest from "../../../solutions/insurance/manifest.json";

export const insuranceSolution = solutionPackageSchema.parse(manifest);
