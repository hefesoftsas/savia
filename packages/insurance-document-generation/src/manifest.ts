import { runtime } from "@savia/insurance-communications/gateway";
import type { ExtensionManifest } from "@savia/crm-shared/extension-package";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.document-generation",
  version: "1.0.0",
  label: "Documentos y firma",
  description:
    "Genera documentos desde plantillas y gestiona solicitudes de firma.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;

export const extension = {
  manifest,
  runtime: runtime(manifest.id, ["request-signature", "signature-status"]),
};
