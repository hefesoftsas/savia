import type {
  TrustedExtension,
  ExtensionManifest,
} from "@savia/crm-shared/extension-package";
import { runtime } from "@savia/insurance-communications/gateway";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.carriers",
  version: "1.0.0",
  label: "Aseguradoras",
  description: "Solicitudes y consultas mediante una conexión autorizada.",
  labels: {"en": "Insurers", "pt": "Seguradoras"},
  descriptions: {"en": "Requests and queries through an authorized connection.", "pt": "Solicitações e consultas por uma conexão autorizada."},
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
export const extension = {
  manifest,
  runtime: runtime(manifest.id, [
    "policy-status",
    "documents",
    "request-issuance",
  ]),
} satisfies TrustedExtension;
