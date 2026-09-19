import type {
  TrustedExtension,
  ExtensionManifest,
} from "@savia/crm-shared/extension-package";
import { runtime } from "@savia/insurance-communications/gateway";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.calendar",
  version: "1.0.0",
  label: "Calendario",
  description: "Eventos, exportación y sincronización de agenda.",
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
export const extension = {
  manifest,
  runtime: runtime(manifest.id, ["sync"]),
} satisfies TrustedExtension;
