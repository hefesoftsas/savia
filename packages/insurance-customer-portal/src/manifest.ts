import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.customer-portal",
  version: "1.0.0",
  label: "Portal del cliente",
  description:
    "Comparte información y recibe solicitudes mediante accesos limitados.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
