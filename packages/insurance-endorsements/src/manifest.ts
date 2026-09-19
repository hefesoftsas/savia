import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.endorsements",
  version: "1.0.0",
  label: "Movimientos de póliza",
  description: "Solicitudes de modificación, anexos y novedades de pólizas.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
