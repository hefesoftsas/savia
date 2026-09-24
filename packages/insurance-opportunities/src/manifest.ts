import type { ExtensionManifest } from "@savia/studio-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.opportunities",
  version: "1.0.0",
  label: "Oportunidades",
  description: "Prospectos, negociación y seguimiento comercial de seguros.",
  labels: {"en": "Opportunities", "pt": "Oportunidades"},
  descriptions: {"en": "Insurance prospects, negotiations and sales follow-up.", "pt": "Prospectos, negociações e acompanhamento comercial de seguros."},
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
