import type { ExtensionManifest } from "@savia/studio-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.endorsements",
  version: "1.0.0",
  label: "Movimientos de póliza",
  description: "Solicitudes de modificación, anexos y novedades de pólizas.",
  labels: {"en": "Policy changes", "pt": "Alterações de apólice"},
  descriptions: {"en": "Policy change requests, endorsements and updates.", "pt": "Solicitações de alteração, endossos e atualizações de apólices."},
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
