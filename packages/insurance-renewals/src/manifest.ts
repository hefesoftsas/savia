import type { ExtensionManifest } from "@savia/studio-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.renewals",
  version: "1.0.0",
  label: "Renovaciones",
  description: "Vencimientos, negociación y cierre de renovaciones de pólizas.",
  labels: {"en": "Renewals", "pt": "Renovações"},
  descriptions: {"en": "Policy expirations, negotiations and renewal completion.", "pt": "Vencimentos, negociações e conclusão de renovações de apólices."},
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
