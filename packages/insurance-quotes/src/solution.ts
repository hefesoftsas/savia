import { solutionPackageSchema } from "@savia/studio-shared/solution-package";
import manifest from "../../../solutions/insurance/manifest.json";
import quoterManifest from "../../../solutions/insurance-quoter/manifest.json";
import managementManifest from "../../../solutions/insurance-management/manifest.json";

/** Historical all-in-one package retained for existing installations. */
export const insuranceSolution = solutionPackageSchema.parse(manifest);
export const insuranceQuoterSolution =
  solutionPackageSchema.parse(quoterManifest);
export const insuranceManagementSolution =
  solutionPackageSchema.parse(managementManifest);
