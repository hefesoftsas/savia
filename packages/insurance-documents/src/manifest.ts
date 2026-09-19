import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.documents",
  version: "1.0.0",
  label: "Requisitos documentales",
  description:
    "Solicita, recibe y revisa los documentos necesarios para cada caso.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
