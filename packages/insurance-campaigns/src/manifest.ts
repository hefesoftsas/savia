import type {
  TrustedExtension,
  ExtensionManifest,
} from "@savia/studio-shared/extension-package";
import { runtime } from "@savia/insurance-communications/gateway";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.campaigns",
  version: "1.0.0",
  label: "Campañas",
  description: "Segmentación y ejecución con consentimiento verificable.",
  labels: {"en": "Campaigns", "pt": "Campanhas"},
  descriptions: {"en": "Segmentation and execution with verifiable consent.", "pt": "Segmentação e execução com consentimento verificável."},
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
export const extension = {
  manifest,
  runtime: runtime(manifest.id, ["send"]),
} satisfies TrustedExtension;
