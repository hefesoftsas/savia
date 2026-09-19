import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.renewals",
  version: "1.0.0",
  label: "Renovaciones",
  description: "Vencimientos, negociación y cierre de renovaciones de pólizas.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
