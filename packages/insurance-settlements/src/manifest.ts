import type {
  ExtensionManifest,
  TrustedExtension,
} from "@savia/crm-shared/extension-package";
import { stateSchema, defaults } from "./domain";
export const manifest = {
  format: "savia.extension",
  formatVersion: 1,
  id: "insurance.settlements",
  version: "1.0.0",
  label: "Liquidaciones",
  description: "Calcula participaciones y estados de liquidación.",
  labels: {"en": "Settlements", "pt": "Liquidações"},
  descriptions: {"en": "Calculate shares and settlement statements.", "pt": "Calcule participações e demonstrativos de liquidação."},
  requires: [],
  apiVersion: 1,
} satisfies ExtensionManifest;
export const extension = {
  manifest,
  runtime: {
    settings: { extensionId: manifest.id, schema: stateSchema, defaults },
  },
} satisfies TrustedExtension;
