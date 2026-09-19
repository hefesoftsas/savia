import type {
  TrustedExtension,
  ExtensionManifest,
} from "@savia/crm-shared/extension-package";
import { runtime } from "./gateway";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.communications",
  version: "1.0.0",
  label: "Comunicaciones",
  description: "Plantillas, envíos y seguimiento de entrega.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
export const extension = {
  manifest,
  runtime: runtime(manifest.id, ["send", "status"]),
} satisfies TrustedExtension;
