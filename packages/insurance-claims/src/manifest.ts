import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.claims",
  version: "1.0.0",
  label: "Siniestros",
  description:
    "Avisos, documentación y seguimiento de reclamaciones de seguros.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
