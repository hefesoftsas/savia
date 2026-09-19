import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.reports",
  version: "1.0.0",
  label: "Reportes y cliente 360",
  description:
    "Consulta indicadores operativos y el expediente relacionado del cliente.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
