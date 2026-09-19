import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.issuance",
  version: "1.0.0",
  label: "Emisiones",
  description: "Seguimiento de expedición, revisión y entrega de pólizas.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
