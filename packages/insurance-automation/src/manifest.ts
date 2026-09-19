import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.automation",
  version: "1.0.0",
  label: "Operación conectada",
  description:
    "Relaciones reales y plantillas de automatización para los plugins de seguros.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
