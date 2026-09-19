import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.commissions",
  version: "1.0.0",
  label: "Comisiones",
  description: "Comisiones esperadas, recaudo y participación del vendedor.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
