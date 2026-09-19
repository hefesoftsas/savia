import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.service",
  version: "1.0.0",
  label: "Solicitudes de servicio",
  description:
    "Organiza consultas, reclamos y solicitudes de tus clientes hasta su respuesta.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
