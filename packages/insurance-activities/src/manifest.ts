import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.activities",
  version: "1.0.0",
  label: "Actividades",
  description: "Agenda operativa, responsables y seguimiento de compromisos.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
