import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.collections",
  version: "1.0.0",
  label: "Cartera",
  description: "Cobros, saldos y seguimiento de cuentas por cobrar.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
