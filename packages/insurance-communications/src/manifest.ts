import type {
  TrustedExtension,
  ExtensionManifest,
} from "@savia/studio-shared/extension-package";
import { runtime } from "./gateway";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.communications",
  version: "1.0.0",
  label: "Comunicaciones",
  description: "Plantillas, envíos y seguimiento de entrega.",
  labels: {"en": "Communications", "pt": "Comunicações"},
  descriptions: {"en": "Templates, sending and delivery tracking.", "pt": "Modelos, envios e acompanhamento de entrega."},
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
export const extension = {
  manifest,
  runtime: runtime(manifest.id, ["send", "status"]),
} satisfies TrustedExtension;
