import type { ExtensionManifest } from "@savia/crm-shared/extension-package";

export const insurancePortfolioExtensionManifest: ExtensionManifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.portfolio-dashboard",
  version: "1.0.0",
  label: "Cartera de pólizas",
  description:
    "Resumen de pólizas vigentes, próximas a vencer y prima total para este espacio.",
  requires: [],
  apiVersion: 1,
};
