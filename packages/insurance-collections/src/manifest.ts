import type { ExtensionManifest } from "@savia/studio-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.collections",
  version: "1.0.0",
  label: "Cartera",
  description: "Cobros, saldos y seguimiento de cuentas por cobrar.",
  labels: {"en": "Receivables", "pt": "Contas a receber"},
  descriptions: {"en": "Collections, balances and accounts receivable tracking.", "pt": "Cobranças, saldos e acompanhamento de contas a receber."},
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
